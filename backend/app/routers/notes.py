from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


class NoteCreate(BaseModel):
    content: str
    client_id: str | None = None


@router.get("/")
def list_notes(
    agent_id: str | None = Query(None),
    client_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    q = db.table("notes").select("*, clients(name)").eq("agent_id", effective_agent_id)
    if client_id:
        q = q.eq("client_id", client_id)
    return q.order("created_at", desc=True).execute().data


@router.post("/")
def create_note(
    body: NoteCreate,
    agent_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    result = db.table("notes").insert({
        "agent_id": effective_agent_id,
        "client_id": body.client_id or None,
        "content": body.content,
    }).execute()
    return result.data[0]


@router.delete("/{note_id}")
def delete_note(note_id: str):
    db = get_supabase()
    db.table("notes").delete().eq("id", note_id).execute()
    return {"deleted": True}
