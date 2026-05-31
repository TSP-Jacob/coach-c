"""Organization Profile router.

GET  /api/organization/          — get the brokerage profile for the authenticated agent
PATCH /api/organization/         — update it (manager or admin)
GET  /api/organization/all       — list all brokerage profiles (admin only)
PATCH /api/organization/{id}     — update any brokerage by id (admin only)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


class OrgProfileUpdate(BaseModel):
    name: str | None = None
    primary_contact: str | None = None
    industry: str | None = None
    email: str | None = None


def _get_agent_with_brokerage(agent_id: str):
    db = get_supabase()
    result = (
        db.table("agents")
        .select("id, role, brokerage_id, brokerages(id, name, primary_contact, industry, email)")
        .eq("id", agent_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Agent not found")
    return result.data


@router.get("/")
def get_my_org(agent_id: str = Depends(get_jwt_agent_id)):
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    agent = _get_agent_with_brokerage(agent_id)
    brokerage = agent.get("brokerages") or {}
    return {**brokerage, "agent_role": agent.get("role", "agent")}


@router.patch("/")
def update_my_org(body: OrgProfileUpdate, agent_id: str = Depends(get_jwt_agent_id)):
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    agent = _get_agent_with_brokerage(agent_id)
    role = agent.get("role", "agent")
    if role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin role required")

    brokerage_id = agent.get("brokerage_id")
    if not brokerage_id:
        raise HTTPException(status_code=404, detail="No brokerage linked to this agent")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    db = get_supabase()
    result = db.table("brokerages").update(updates).eq("id", brokerage_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Brokerage not found")
    return result.data[0]


@router.get("/all")
def list_all_orgs(agent_id: str = Depends(get_jwt_agent_id)):
    """Admin only — view all brokerage profiles."""
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    agent = _get_agent_with_brokerage(agent_id)
    if agent.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    db = get_supabase()
    return db.table("brokerages").select("*").order("name").execute().data


@router.patch("/{brokerage_id}")
def update_any_org(
    brokerage_id: str,
    body: OrgProfileUpdate,
    agent_id: str = Depends(get_jwt_agent_id),
):
    """Admin only — update any brokerage profile."""
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    agent = _get_agent_with_brokerage(agent_id)
    if agent.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    db = get_supabase()
    result = db.table("brokerages").update(updates).eq("id", brokerage_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Brokerage not found")
    return result.data[0]
