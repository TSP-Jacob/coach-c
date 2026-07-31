from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.database import get_supabase
from app.services.coaching import CoachingService
from app.services.rag import retrieve_context
from app.services.history import load_recent, save_messages
from app.services.assistant_tools import anthropic_tools, execute_tool
from app.services.industry import domain as industry_domain
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()
coaching_svc = CoachingService()


class ChatRequest(BaseModel):
    agent_id: str | None = None
    message: str
    client_id: str | None = None
    timezone: str | None = None
    conversation_id: str | None = None


def _build_calls_context(db, agent_id: str, tz_name: str | None = None) -> str:
    """Build a compact call history block to ground the chat in real data."""
    rows = db.table("calls").select(
        "id, call_date, call_type, overall_score, duration_seconds, "
        "coaching_report, created_at, clients(name)"
    ).eq("agent_id", agent_id).eq("status", "complete") \
     .order("created_at", desc=True).limit(20).execute().data

    if not rows:
        return "No completed calls on record yet."

    lines = []
    for c in rows:
        client_name = (c.get("clients") or {}).get("name") or "Unknown client"
        date_str = c.get("call_date") or c.get("created_at", "")
        try:
            tz = ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
        except ZoneInfoNotFoundError:
            tz = ZoneInfo("UTC")
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00")).astimezone(tz)
            date_str = dt.strftime("%b %d, %Y at %I:%M %p")
        except Exception:
            pass
        duration = f"{round(c['duration_seconds'] / 60)} min" if c.get("duration_seconds") else "?"
        call_type = (c.get("call_type") or "unknown").replace("_", " ")
        score = c.get("overall_score", "?")
        summary = ""
        if c.get("coaching_report"):
            summary = c["coaching_report"].get("summary", "")
            if summary:
                summary = f"\n   Summary: {summary}"
        lines.append(
            f"- {client_name} | {date_str} | {call_type} | {duration} | Score: {score}/100{summary}"
        )

    return "\n".join(lines)


@router.post("/")
def chat(body: ChatRequest, jwt_agent_id: str | None = Depends(get_jwt_agent_id)):
    db = get_supabase()
    agent_id = jwt_agent_id or body.agent_id
    if not agent_id:
        return {"reply": "Authentication required."}

    # One rolling history per agent, shared with the voice assistant.
    history = load_recent(db, agent_id, limit=40)

    calls_context = _build_calls_context(db, agent_id, body.timezone)

    client_notes = ""
    try:
        client_notes = retrieve_context(agent_id, body.message)
    except Exception:
        pass

    # Tolerate the industry_mode column not existing yet (migration 008).
    try:
        agent = db.table("agents").select("name, brokerages(industry_mode)").eq("id", agent_id).single().execute()
        industry_mode = (agent.data.get("brokerages") or {}).get("industry_mode") if agent.data else None
    except Exception:
        agent = db.table("agents").select("name").eq("id", agent_id).single().execute()
        industry_mode = None
    agent_name = agent.data["name"] if agent.data else "the realtor"

    # Let the assistant not just answer but record work — create client profiles
    # and save notes — through the same tools the voice assistant uses. The
    # executor closes over this request's db/agent/timezone so coaching stays
    # DB-agnostic.
    def tool_executor(name: str, args: dict) -> dict:
        return execute_tool(db, agent_id, name, args, body.timezone)

    reply = coaching_svc.chat(
        message=body.message,
        history=[{"role": m["role"], "content": m["content"]} for m in history],
        client_notes=client_notes,
        calls_context=calls_context,
        agent_name=agent_name,
        tools=anthropic_tools(),
        tool_executor=tool_executor,
        industry=industry_domain(industry_mode),
        tz_name=body.timezone,
    )

    save_messages(db, agent_id, [
        {"role": "user", "content": body.message, "source": "text"},
        {"role": "assistant", "content": reply, "source": "text"},
    ])

    return {"reply": reply}


@router.get("/history/{agent_id}")
def get_history(agent_id: str, limit: int = 100):
    db = get_supabase()
    return load_recent(db, agent_id, limit=limit)


@router.delete("/history/{agent_id}")
def clear_history(agent_id: str):
    db = get_supabase()
    db.table("chat_messages").delete().eq("agent_id", agent_id).execute()
    return {"cleared": True}
