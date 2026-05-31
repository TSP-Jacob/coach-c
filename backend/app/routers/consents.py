"""Consents router.

GET /api/consents/?client_id=xxx  — list consents for a client
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


@router.get("/")
def list_consents(
    client_id: str | None = Query(None),
    lead_id: str | None = Query(None),
    agent_id: str = Depends(get_jwt_agent_id),
):
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not client_id and not lead_id:
        raise HTTPException(status_code=400, detail="client_id or lead_id required")

    db = get_supabase()
    q = db.table("consents").select("*")
    if client_id:
        q = q.eq("client_id", client_id)
    if lead_id:
        q = q.eq("lead_id", lead_id)
    return q.order("created_at", desc=True).execute().data
