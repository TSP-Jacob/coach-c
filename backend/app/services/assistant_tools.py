"""DB-grounded tools for the voice assistant.

The Gemini Live session calls these functions (function calling) so it can
answer recall questions from real data instead of guessing — e.g. "what did I
offer the Tremblays?", "which client did I service around June 3rd?".

Every query is scoped to the authenticated agent_id, mirroring the auth model
used by the rest of the API (service-role key bypasses RLS, so scoping MUST be
enforced in code here).
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


# ── Function declarations advertised to Gemini ────────────────────────────────
# Kept as plain dicts (the Live API accepts the OpenAPI-subset schema this way).
TOOL_DECLARATIONS: list[dict] = [
    {
        "name": "search_calls",
        "description": (
            "Search the agent's recorded calls to recall what was discussed, "
            "what services/offers were made, scores, and dates. Use this to "
            "answer any question about past calls or clients. All arguments are "
            "optional; combine them to narrow results."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "client_name": {
                    "type": "string",
                    "description": "Full or partial client name to filter by.",
                },
                "call_type": {
                    "type": "string",
                    "description": "e.g. prospecting, buyer_consultation, seller_listing, followup, negotiation, post_closing.",
                },
                "date_from": {
                    "type": "string",
                    "description": "ISO date (YYYY-MM-DD). Only calls on/after this date.",
                },
                "date_to": {
                    "type": "string",
                    "description": "ISO date (YYYY-MM-DD). Only calls on/before this date.",
                },
                "keyword": {
                    "type": "string",
                    "description": "Free-text term to match in the call summary/transcript (e.g. a service, address, or topic).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 8, max 20).",
                },
            },
        },
    },
    {
        "name": "get_client_history",
        "description": (
            "Get everything on record for one client: profile details, every "
            "call (date, type, score, summary) and saved notes. Use when the "
            "user asks about a specific person."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "client_name": {
                    "type": "string",
                    "description": "Full or partial client name.",
                },
            },
            "required": ["client_name"],
        },
    },
    {
        "name": "list_recent_calls",
        "description": "List the agent's most recent completed calls, newest first.",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "How many (default 8, max 20).",
                },
            },
        },
    },
    {
        "name": "search_notes",
        "description": "Search the agent's saved client notes for a keyword.",
        "parameters": {
            "type": "object",
            "properties": {
                "keyword": {
                    "type": "string",
                    "description": "Term to look for in note content.",
                },
            },
            "required": ["keyword"],
        },
    },
]


# ── Helpers ───────────────────────────────────────────────────────────────────
def _clamp_limit(value, default: int = 8, hi: int = 20) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(n, hi))


def _fmt_date(iso: str | None, tz_name: str | None = None) -> str:
    if not iso:
        return "unknown date"
    try:
        tz = ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz)
        return dt.strftime("%b %d, %Y")
    except Exception:
        return iso


def _call_summary(report) -> str:
    if isinstance(report, dict):
        return report.get("summary") or ""
    return ""


def _client_ids_for_name(db, agent_id: str, name: str) -> list[str]:
    rows = (
        db.table("clients")
        .select("id")
        .eq("agent_id", agent_id)
        .ilike("name", f"%{name}%")
        .execute()
        .data
        or []
    )
    return [r["id"] for r in rows]


def _shape_call(c: dict, tz_name: str | None) -> dict:
    report = c.get("coaching_report")
    out = {
        "client": (c.get("clients") or {}).get("name") or "Unknown client",
        "date": _fmt_date(c.get("call_date") or c.get("created_at"), tz_name),
        "type": (c.get("call_type") or "unknown").replace("_", " "),
        "score": c.get("overall_score"),
        # Keep it lean — a voice reply is short, and bulky tool results slow the
        # model down. Truncate the summary and drop verbose arrays.
        "summary": _call_summary(report)[:200].strip(),
    }
    if isinstance(report, dict) and report.get("priority_focus"):
        out["priority_focus"] = report["priority_focus"]
    return out


# ── Tool implementations ──────────────────────────────────────────────────────
def _search_calls(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    limit = _clamp_limit(args.get("limit"))
    keyword = (args.get("keyword") or "").strip().lower()

    # Only pull the (large) transcript column when we actually keyword-filter on
    # it, and only over-fetch rows when there's filtering to do — both cut the
    # payload and query time for the common no-keyword case.
    cols = ["id", "call_date", "call_type", "overall_score", "coaching_report",
            "created_at", "client_id", "clients(name)"]
    if keyword:
        cols.insert(-1, "transcript")
    q = (
        db.table("calls")
        .select(", ".join(cols))
        .eq("agent_id", agent_id)
        .eq("status", "complete")
    )

    if args.get("client_name"):
        ids = _client_ids_for_name(db, agent_id, args["client_name"])
        if not ids:
            return {"count": 0, "calls": [], "note": f"No client matching '{args['client_name']}'."}
        q = q.in_("client_id", ids)
    if args.get("call_type"):
        q = q.eq("call_type", str(args["call_type"]).strip().lower().replace(" ", "_"))
    if args.get("date_from"):
        q = q.gte("call_date", args["date_from"])
    if args.get("date_to"):
        q = q.lte("call_date", args["date_to"])

    fetch = 60 if keyword else limit
    rows = q.order("call_date", desc=True).limit(fetch).execute().data or []

    if keyword:
        def _hit(c):
            hay = _call_summary(c.get("coaching_report")).lower()
            tr = c.get("transcript") or {}
            if isinstance(tr, dict):
                hay += " " + str(tr.get("full_text", "")).lower()
            return keyword in hay
        rows = [c for c in rows if _hit(c)]

    rows = rows[:limit]
    return {"count": len(rows), "calls": [_shape_call(c, tz_name) for c in rows]}


def _get_client_history(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    name = (args.get("client_name") or "").strip()
    if not name:
        return {"error": "client_name is required."}

    clients = (
        db.table("clients")
        .select("id, name, phone, email, type, notes")
        .eq("agent_id", agent_id)
        .ilike("name", f"%{name}%")
        .execute()
        .data
        or []
    )
    if not clients:
        return {"found": False, "note": f"No client matching '{name}'."}

    results = []
    for client in clients:
        cid = client["id"]
        calls = (
            db.table("calls")
            .select("call_date, call_type, overall_score, coaching_report, created_at, clients(name)")
            .eq("agent_id", agent_id)
            .eq("client_id", cid)
            .eq("status", "complete")
            .order("call_date", desc=True)
            .limit(20)
            .execute()
            .data
            or []
        )
        try:
            notes = (
                db.table("notes")
                .select("content, created_at")
                .eq("agent_id", agent_id)
                .eq("client_id", cid)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
                .data
                or []
            )
        except Exception:
            # Notes are optional — never let their absence sink a call-history answer.
            notes = []
        results.append({
            "name": client.get("name"),
            "type": client.get("type"),
            "profile_notes": client.get("notes"),
            "calls": [_shape_call(c, tz_name) for c in calls],
            "notes": [
                {"date": _fmt_date(n.get("created_at"), tz_name), "content": n.get("content")}
                for n in notes
            ],
        })
    return {"found": True, "clients": results}


def _list_recent_calls(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    limit = _clamp_limit(args.get("limit"))
    rows = (
        db.table("calls")
        .select("call_date, call_type, overall_score, coaching_report, created_at, clients(name)")
        .eq("agent_id", agent_id)
        .eq("status", "complete")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    return {"count": len(rows), "calls": [_shape_call(c, tz_name) for c in rows]}


def _search_notes(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    keyword = (args.get("keyword") or "").strip()
    if not keyword:
        return {"error": "keyword is required."}
    try:
        rows = (
            db.table("notes")
            .select("content, created_at, clients(name)")
            .eq("agent_id", agent_id)
            .ilike("content", f"%{keyword}%")
            .order("created_at", desc=True)
            .limit(20)
            .execute()
            .data
            or []
        )
    except Exception:
        return {"count": 0, "notes": [], "note": "Saved notes are not available."}
    return {
        "count": len(rows),
        "notes": [
            {
                "client": (n.get("clients") or {}).get("name"),
                "date": _fmt_date(n.get("created_at"), tz_name),
                "content": n.get("content"),
            }
            for n in rows
        ],
    }


_DISPATCH = {
    "search_calls": _search_calls,
    "get_client_history": _get_client_history,
    "list_recent_calls": _list_recent_calls,
    "search_notes": _search_notes,
}


def build_recent_context(db, agent_id: str, tz_name: str | None = None, limit: int = 10) -> str:
    """A compact digest of the agent's most recent calls, to pre-load into the
    voice system prompt so common recall questions ("my last call", "recent
    calls", "how did I do lately") are answered instantly — with no tool
    round-trip. Deeper/specific lookups still fall through to the tools."""
    try:
        rows = (
            db.table("calls")
            .select("call_date, call_type, overall_score, coaching_report, created_at, clients(name)")
            .eq("agent_id", agent_id)
            .eq("status", "complete")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception:
        return ""
    lines = []
    for c in rows:
        client = (c.get("clients") or {}).get("name") or "Unknown client"
        date = _fmt_date(c.get("call_date") or c.get("created_at"), tz_name)
        ctype = (c.get("call_type") or "unknown").replace("_", " ")
        score = c.get("overall_score")
        summary = _call_summary(c.get("coaching_report"))[:140].strip()
        score_str = f"{score}/100" if score is not None else "no score"
        lines.append(f"- {client} | {date} | {ctype} | {score_str}" + (f" | {summary}" if summary else ""))
    return "\n".join(lines)


def execute_tool(db, agent_id: str, name: str, args: dict, tz_name: str | None = None) -> dict:
    """Run a tool call by name. Never raises — errors are returned as data so
    the model can recover conversationally."""
    fn = _DISPATCH.get(name)
    if not fn:
        return {"error": f"Unknown tool '{name}'."}
    try:
        return fn(db, agent_id, args or {}, tz_name)
    except Exception as exc:  # pragma: no cover - defensive
        return {"error": f"Tool '{name}' failed: {exc}"}
