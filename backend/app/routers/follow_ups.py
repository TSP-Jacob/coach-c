from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


class FollowUpSet(BaseModel):
    follow_up_date: str  # YYYY-MM-DD
    follow_up_note: str | None = None


@router.get("/")
def list_follow_ups(
    agent_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    caller_id = jwt_agent_id or agent_id
    if not caller_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_supabase()

    # Resolve the caller's role — gracefully defaults to 'employee' if column absent
    role = "employee"
    try:
        res = db.table("agents").select("role").eq("id", caller_id).single().execute()
        role = (res.data or {}).get("role", "employee")
    except Exception:
        pass

    q = db.table("clients").select("*").not_.is_("follow_up_date", "null")

    if role not in ("admin", "manager"):
        # Employees see only clients assigned to them or still unassigned
        q = q.or_(f"agent_id.eq.{caller_id},agent_id.is.null")

    return q.order("follow_up_date").execute().data


@router.patch("/{client_id}")
def set_follow_up(client_id: str, body: FollowUpSet):
    db = get_supabase()
    updates = {"follow_up_date": body.follow_up_date}
    if body.follow_up_note is not None:
        updates["follow_up_note"] = body.follow_up_note
    result = db.table("clients").update(updates).eq("id", client_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Client not found")
    return result.data[0]


@router.delete("/{client_id}")
def complete_follow_up(client_id: str):
    """Mark the follow-up done — clears the scheduled date so the client
    drops off the Follow-Ups list until a new date is set."""
    db = get_supabase()
    result = db.table("clients").update(
        {"follow_up_date": None, "follow_up_note": None}
    ).eq("id", client_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"completed": True}
