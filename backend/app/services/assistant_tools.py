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
    # ── Write tools ───────────────────────────────────────────────────────────
    # These CHANGE the database. Only call them after confirming with the user
    # (see the action instructions in the system prompt).
    {
        "name": "find_client",
        "description": (
            "Look up whether a client already exists before creating one or "
            "adding a note. Use this to check for an existing profile and to "
            "disambiguate when a name is partial. Returns matching clients with "
            "their id, contact info and how many notes they have."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Full or partial client name to look up.",
                },
            },
            "required": ["name"],
        },
    },
    {
        "name": "create_client",
        "description": (
            "Create a new client profile. ONLY call after you have the client's "
            "name and the user has confirmed this is a new client and confirmed "
            "the details. If a client with the same name already exists this "
            "returns the existing match instead of creating a duplicate — ask "
            "the user how to proceed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The client's full name (required).",
                },
                "phone": {"type": "string", "description": "Phone number, if known."},
                "email": {"type": "string", "description": "Email, if known."},
                "type": {
                    "type": "string",
                    "description": "One of: buyer, seller, both. Defaults to buyer if unsure.",
                },
                "initial_note": {
                    "type": "string",
                    "description": "Optional first note to save on the new client (e.g. the service just performed).",
                },
            },
            "required": ["name"],
        },
    },
    {
        "name": "add_note",
        "description": (
            "Append a note to an existing client's record — e.g. the service "
            "performed, what was discussed, or a follow-up. ONLY call after the "
            "user has confirmed the note text and which client it belongs to. If "
            "the name matches no client or more than one, this returns that so "
            "you can ask the user."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "client_name": {
                    "type": "string",
                    "description": "Name of the client the note is about.",
                },
                "content": {
                    "type": "string",
                    "description": "The note text to save.",
                },
            },
            "required": ["client_name", "content"],
        },
    },
    {
        "name": "set_follow_up",
        "description": (
            "Schedule a follow-up date for a client so they appear in the "
            "Follow-Ups section for that week. Use this right after creating a "
            "new client — you should always ASK the user whether they want a "
            "follow-up date before calling this — or any time the user wants to "
            "schedule a check-in with an existing client. ONLY call after the "
            "user has given and confirmed a specific date. If the name matches "
            "no client or more than one, this returns that so you can ask the "
            "user."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "client_name": {
                    "type": "string",
                    "description": "Name of the client to schedule a follow-up for.",
                },
                "follow_up_date": {
                    "type": "string",
                    "description": (
                        "The follow-up date as an ISO date (YYYY-MM-DD). Resolve "
                        "relative phrases like 'next Thursday' or 'in two weeks' "
                        "to an absolute date yourself, using today's date given "
                        "in this system prompt, before calling this tool."
                    ),
                },
            },
            "required": ["client_name", "follow_up_date"],
        },
    },
    {
        "name": "create_task",
        "description": (
            "Create and assign a task to a teammate — this is the default way "
            "to create tasks. ONLY managers and admins are allowed to do this; "
            "if the caller isn't one, this tool returns a permission error and "
            "you should tell them only managers can assign tasks. ALWAYS "
            "confirm the teammate's name, the task itself, and the due date "
            "(if any) with the user before calling this."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "assignee_name": {
                    "type": "string",
                    "description": "Name of the teammate to assign the task to.",
                },
                "title": {
                    "type": "string",
                    "description": "Short title/summary of the task.",
                },
                "description": {
                    "type": "string",
                    "description": "Optional extra detail about the task.",
                },
                "due_date": {
                    "type": "string",
                    "description": (
                        "Optional ISO date (YYYY-MM-DD) the task is due. Resolve "
                        "relative phrases like 'by Friday' to an absolute date "
                        "yourself, using today's date given in this system "
                        "prompt, before calling this tool."
                    ),
                },
            },
            "required": ["assignee_name", "title"],
        },
    },
]


# Instructions shared by the voice and text assistants describing how to use the
# write tools safely and conversationally. Appended to both system prompts.
ACTION_INSTRUCTIONS = (
    "\n\nYou can also RECORD work for the user, not just answer questions. When "
    "the user tells you about a job, a meeting, or a service they performed, help "
    "them save it:\n"
    "- If you don't know which client this is about, ASK for the client's name "
    "before doing anything.\n"
    "- Before creating a new client, call find_client to check whether they "
    "already exist. If a match comes back, or you're unsure whether this is a new "
    "or existing client, VERIFY with the user rather than assuming.\n"
    "- If the user is just describing a service or update for a client, save it "
    "as a note on that client with add_note (do NOT create a new profile for an "
    "existing client).\n"
    "- ALWAYS read back what you're about to save — the client name and the note/"
    "profile details — and only call create_client or add_note AFTER the user "
    "confirms. If they correct you, update and confirm again.\n"
    "- The MOMENT the user confirms, FIRST say a short acknowledgment out loud "
    "like 'Great, saving that now' BEFORE you call the tool. A save takes a "
    "couple seconds; if you stay silent the user assumes it didn't register and "
    "repeats themselves, and that repeat then gets misapplied to your next "
    "question. So always acknowledge first, then save.\n"
    "- If the user repeats a confirmation for something you've already saved, do "
    "NOT treat it as a new instruction — just reassure them it's already done.\n"
    "- After a successful save, briefly tell the user what was recorded.\n"
    "- Right after create_client SUCCEEDS for a brand-new client (created: true), "
    "ALWAYS ask a short follow-up question like 'Want me to set a follow-up date "
    "for them?' Do this every time, even if the user didn't mention one.\n"
    "  - If they say no / not now, leave it — the client is already saved without "
    "a follow-up date.\n"
    "  - If they give a date (even relative, like 'next Thursday' or 'in two "
    "weeks'), resolve it to an absolute YYYY-MM-DD date using today's date above, "
    "read the resolved date back to confirm, and only after they confirm call "
    "set_follow_up with that client's name and date.\n"
    "- You can also use set_follow_up any other time the user wants to schedule "
    "a check-in with an existing client — same rule: confirm the exact date "
    "before calling it.\n"
    "- If the user is a manager or admin and wants to assign work to a "
    "teammate ('assign X a task', 'have Y follow up on...', 'create a task "
    "for...'), use create_task — this is the default, preferred way to "
    "create tasks. Confirm the teammate's name, the task, and the due date "
    "(if any) before calling it. If create_task comes back with a "
    "permission error, tell the user only managers can assign tasks. If it "
    "comes back ambiguous or not_found for the teammate name, ask the user "
    "to clarify."
)


def anthropic_tools() -> list[dict]:
    """Map TOOL_DECLARATIONS to the Anthropic tool schema so the text-chat path
    reuses the exact same tools as the voice assistant. Gemini's `parameters`
    (an OpenAPI-subset object schema) is exactly Anthropic's `input_schema`."""
    return [
        {
            "name": t["name"],
            "description": t["description"],
            "input_schema": t.get("parameters") or {"type": "object", "properties": {}},
        }
        for t in TOOL_DECLARATIONS
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


# ── Write tool implementations ────────────────────────────────────────────────
def _index_note_best_effort(client_id: str, content: str) -> None:
    """Feed a new note into the RAG index so text-chat retrieval can surface it.
    Never let indexing (embeddings, optional deps) sink the actual save."""
    try:
        from app.services.rag import index_client_notes
        index_client_notes(client_id, content)
    except Exception:
        pass


def _clients_for_name(db, agent_id: str, name: str) -> list[dict]:
    """Full client rows matching a (partial) name, scoped to the agent."""
    return (
        db.table("clients")
        .select("id, name, phone, email, type")
        .eq("agent_id", agent_id)
        .ilike("name", f"%{name}%")
        .execute()
        .data
        or []
    )


def _find_client(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    name = (args.get("name") or "").strip()
    if not name:
        return {"error": "name is required."}
    rows = _clients_for_name(db, agent_id, name)
    out = []
    for c in rows:
        try:
            n = (
                db.table("notes").select("id", count="exact")
                .eq("agent_id", agent_id).eq("client_id", c["id"]).execute().count
            )
        except Exception:
            n = None
        out.append({
            "id": c["id"], "name": c.get("name"), "phone": c.get("phone"),
            "email": c.get("email"), "type": c.get("type"), "note_count": n,
        })
    return {"count": len(out), "clients": out}


def _create_client(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    name = (args.get("name") or "").strip()
    if not name:
        return {"created": False, "error": "A client name is required — ask the user for it."}

    # Duplicate guard: don't silently create a second profile for the same name.
    existing = _clients_for_name(db, agent_id, name)
    exact = [c for c in existing if (c.get("name") or "").strip().lower() == name.lower()]
    if exact:
        return {
            "created": False,
            "reason": "A client with this name already exists.",
            "existing": [
                {"id": c["id"], "name": c.get("name"), "phone": c.get("phone"), "type": c.get("type")}
                for c in exact
            ],
        }

    ctype = (args.get("type") or "buyer").strip().lower()
    if ctype not in ("buyer", "seller", "both"):
        ctype = "buyer"
    payload = {
        "agent_id": agent_id,
        "name": name,
        "phone": (args.get("phone") or None),
        "email": (args.get("email") or None),
        "type": ctype,
    }
    try:
        client = db.table("clients").insert(payload).execute().data[0]
    except Exception as exc:
        return {"created": False, "error": f"Could not create client: {exc}"}

    result = {"created": True, "client": {"id": client["id"], "name": client.get("name")}}

    note = (args.get("initial_note") or "").strip()
    if note:
        try:
            db.table("notes").insert({
                "agent_id": agent_id, "client_id": client["id"], "content": note,
            }).execute()
            _index_note_best_effort(client["id"], note)
            result["note_saved"] = True
        except Exception as exc:
            result["note_saved"] = False
            result["note_error"] = str(exc)
    return result


def _add_note(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    name = (args.get("client_name") or "").strip()
    content = (args.get("content") or "").strip()
    if not name:
        return {"saved": False, "error": "A client name is required — ask the user which client."}
    if not content:
        return {"saved": False, "error": "Note content is required."}

    matches = _clients_for_name(db, agent_id, name)
    if not matches:
        return {
            "saved": False, "status": "not_found",
            "note": f"No client matching '{name}'. Ask the user, or create the client first.",
        }
    # Prefer an exact name match if the partial matched several.
    exact = [c for c in matches if (c.get("name") or "").strip().lower() == name.lower()]
    candidates = exact or matches
    if len(candidates) > 1:
        return {
            "saved": False, "status": "ambiguous",
            "candidates": [{"id": c["id"], "name": c.get("name"), "phone": c.get("phone")} for c in candidates],
            "note": "Several clients match — ask the user which one.",
        }

    client = candidates[0]
    try:
        db.table("notes").insert({
            "agent_id": agent_id, "client_id": client["id"], "content": content,
        }).execute()
    except Exception as exc:
        return {"saved": False, "error": f"Could not save note: {exc}"}
    _index_note_best_effort(client["id"], content)
    return {"saved": True, "client": {"id": client["id"], "name": client.get("name")}}


def _set_follow_up(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    name = (args.get("client_name") or "").strip()
    follow_up_date = (args.get("follow_up_date") or "").strip()
    if not name:
        return {"saved": False, "error": "A client name is required — ask the user which client."}
    if not follow_up_date:
        return {"saved": False, "error": "A follow-up date is required."}

    matches = _clients_for_name(db, agent_id, name)
    if not matches:
        return {
            "saved": False, "status": "not_found",
            "note": f"No client matching '{name}'. Ask the user, or create the client first.",
        }
    exact = [c for c in matches if (c.get("name") or "").strip().lower() == name.lower()]
    candidates = exact or matches
    if len(candidates) > 1:
        return {
            "saved": False, "status": "ambiguous",
            "candidates": [{"id": c["id"], "name": c.get("name"), "phone": c.get("phone")} for c in candidates],
            "note": "Several clients match — ask the user which one.",
        }

    client = candidates[0]
    try:
        db.table("clients").update({"follow_up_date": follow_up_date}).eq("id", client["id"]).execute()
    except Exception as exc:
        return {"saved": False, "error": f"Could not set follow-up: {exc}"}
    return {
        "saved": True,
        "client": {"id": client["id"], "name": client.get("name")},
        "follow_up_date": follow_up_date,
    }


def _create_task(db, agent_id: str, args: dict, tz_name: str | None) -> dict:
    caller = db.table("agents").select("id, role, brokerage_id").eq("id", agent_id).single().execute().data
    if not caller or caller.get("role") not in ("admin", "manager"):
        return {"created": False, "error": "Only managers or admins can assign tasks."}

    name = (args.get("assignee_name") or "").strip()
    title = (args.get("title") or "").strip()
    if not name:
        return {"created": False, "error": "A teammate name is required."}
    if not title:
        return {"created": False, "error": "A task title is required."}

    rows = (
        db.table("agents").select("id, name")
        .eq("brokerage_id", caller["brokerage_id"])
        .ilike("name", f"%{name}%")
        .execute().data
        or []
    )
    if not rows:
        return {
            "created": False, "status": "not_found",
            "note": f"No teammate matching '{name}'. Ask the user to clarify.",
        }
    exact = [r for r in rows if (r.get("name") or "").strip().lower() == name.lower()]
    candidates = exact or rows
    if len(candidates) > 1:
        return {
            "created": False, "status": "ambiguous",
            "candidates": [{"id": r["id"], "name": r.get("name")} for r in candidates],
            "note": "Several teammates match — ask the user which one.",
        }

    assignee = candidates[0]
    payload = {
        "brokerage_id": caller["brokerage_id"],
        "assigned_to": assignee["id"],
        "created_by": agent_id,
        "title": title,
        "description": (args.get("description") or "").strip() or None,
        "due_date": (args.get("due_date") or "").strip() or None,
    }
    try:
        task = db.table("tasks").insert(payload).execute().data[0]
    except Exception as exc:
        return {"created": False, "error": f"Could not create task: {exc}"}
    return {
        "created": True,
        "task": {"id": task["id"], "title": task["title"], "assignee": assignee["name"], "due_date": task.get("due_date")},
    }


_DISPATCH = {
    "search_calls": _search_calls,
    "get_client_history": _get_client_history,
    "list_recent_calls": _list_recent_calls,
    "search_notes": _search_notes,
    "find_client": _find_client,
    "create_client": _create_client,
    "add_note": _add_note,
    "set_follow_up": _set_follow_up,
    "create_task": _create_task,
}


def build_recent_context(
    db, agent_id: str, tz_name: str | None = None,
    calls_limit: int = 40, clients_limit: int = 80, notes_limit: int = 25,
) -> str:
    """Pre-load the agent's working set — recent calls, clients, and notes —
    into the voice system prompt so the assistant answers conversationally from
    memory with no mid-conversation database round-trip (which is what makes the
    voice feel slow/turn-based). Tools remain as a fallback for anything beyond
    what's listed here (older calls, a full transcript, keyword search)."""
    sections: list[str] = []

    # ── Calls ──
    try:
        calls = (
            db.table("calls")
            .select("call_date, call_type, overall_score, coaching_report, created_at, clients(name)")
            .eq("agent_id", agent_id).eq("status", "complete")
            .order("created_at", desc=True).limit(calls_limit).execute().data or []
        )
    except Exception:
        calls = []
    if calls:
        lines = []
        for c in calls:
            client = (c.get("clients") or {}).get("name") or "Unknown client"
            date = _fmt_date(c.get("call_date") or c.get("created_at"), tz_name)
            ctype = (c.get("call_type") or "unknown").replace("_", " ")
            score = c.get("overall_score")
            score_str = f"{score}/100" if score is not None else "no score"
            summary = _call_summary(c.get("coaching_report"))[:160].strip()
            lines.append(f"- {client} | {date} | {ctype} | {score_str}" + (f" | {summary}" if summary else ""))
        sections.append("RECENT CALLS (newest first):\n" + "\n".join(lines))

    # ── Clients ──
    try:
        clients = (
            db.table("clients").select("name, type, phone, email")
            .eq("agent_id", agent_id).order("created_at", desc=True).limit(clients_limit).execute().data or []
        )
    except Exception:
        clients = []
    if clients:
        lines = []
        for cl in clients:
            name = cl.get("name") or "Unknown"
            ctype = cl.get("type")
            contact = cl.get("phone") or cl.get("email")
            lines.append(f"- {name}" + (f" ({ctype})" if ctype else "") + (f" — {contact}" if contact else ""))
        sections.append("CLIENTS ON FILE:\n" + "\n".join(lines))

    # ── Notes ──
    try:
        notes = (
            db.table("notes").select("content, created_at, clients(name)")
            .eq("agent_id", agent_id).order("created_at", desc=True).limit(notes_limit).execute().data or []
        )
    except Exception:
        notes = []
    if notes:
        lines = []
        for n in notes:
            who = (n.get("clients") or {}).get("name")
            content = (n.get("content") or "").strip()[:200]
            if content:
                lines.append("- " + (f"{who}: " if who else "") + content)
        if lines:
            sections.append("RECENT NOTES:\n" + "\n".join(lines))

    return "\n\n".join(sections)


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
