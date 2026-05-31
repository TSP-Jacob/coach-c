from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


class ConversationCreate(BaseModel):
    title: str = "New conversation"


class ConversationRename(BaseModel):
    title: str


@router.get("/")
def list_conversations(
    agent_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    return (
        db.table("conversations")
        .select("*")
        .eq("agent_id", effective_agent_id)
        .order("updated_at", desc=True)
        .execute()
        .data
    )


@router.post("/")
def create_conversation(
    body: ConversationCreate,
    agent_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    result = db.table("conversations").insert({
        "agent_id": effective_agent_id,
        "title": body.title,
    }).execute()
    return result.data[0]


@router.patch("/{conversation_id}")
def rename_conversation(conversation_id: str, body: ConversationRename):
    db = get_supabase()
    result = db.table("conversations").update({"title": body.title}).eq("id", conversation_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result.data[0]


@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: str):
    db = get_supabase()
    db.table("conversations").delete().eq("id", conversation_id).execute()
    return {"deleted": True}
