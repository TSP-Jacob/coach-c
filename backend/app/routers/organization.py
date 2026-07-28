"""Organization Profile router.

GET  /api/organization/          — get the brokerage profile for the authenticated agent
PATCH /api/organization/         — update it (manager or admin)
GET  /api/organization/all       — list all brokerage profiles (admin only)
PATCH /api/organization/{id}     — update any brokerage by id (admin only)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id
from app.services.industry import INDUSTRY_MODES

router = APIRouter()


class OrgProfileUpdate(BaseModel):
    name: str | None = None
    primary_contact: str | None = None
    industry_mode: str | None = None
    email: str | None = None

    @field_validator("industry_mode")
    @classmethod
    def _valid_mode(cls, v):
        if v is not None and v not in INDUSTRY_MODES:
            raise ValueError(f"industry_mode must be one of {INDUSTRY_MODES}")
        return v


class OrgCreate(BaseModel):
    name: str


@router.post("/")
def create_org(body: OrgCreate, agent_id: str = Depends(get_jwt_agent_id)):
    """Admin only — create a new organization (brokerage)."""
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    me = db.table("agents").select("role").eq("id", agent_id).single().execute()
    if not me.data or me.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Organization name is required")
    row = db.table("brokerages").insert({"name": name}).execute().data
    if not row:
        raise HTTPException(status_code=500, detail="Could not create organization")
    return row[0]


def _get_agent_with_brokerage(agent_id: str):
    db = get_supabase()
    # Tolerate the industry_mode column not existing yet (migration 008 not
    # applied): fall back to a select without it so the profile still loads.
    base = "id, role, brokerage_id, brokerages(id, name, primary_contact, {cols}email)"
    try:
        result = (
            db.table("agents")
            .select(base.format(cols="industry_mode, "))
            .eq("id", agent_id).single().execute()
        )
    except Exception:
        result = (
            db.table("agents")
            .select(base.format(cols=""))
            .eq("id", agent_id).single().execute()
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
    return {**brokerage, "agent_role": agent.get("role", "employee")}


def _apply_brokerage_update(db, brokerage_id: str, updates: dict):
    """Update a brokerage, tolerating the industry_mode column not existing yet
    (migration 008 not applied): retry without it rather than 500 the save."""
    try:
        return db.table("brokerages").update(updates).eq("id", brokerage_id).execute()
    except Exception:
        if "industry_mode" not in updates:
            raise
        trimmed = {k: v for k, v in updates.items() if k != "industry_mode"}
        if not trimmed:
            raise HTTPException(status_code=400, detail="No fields to update")
        return db.table("brokerages").update(trimmed).eq("id", brokerage_id).execute()


@router.patch("/")
def update_my_org(body: OrgProfileUpdate, agent_id: str = Depends(get_jwt_agent_id)):
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    agent = _get_agent_with_brokerage(agent_id)
    role = agent.get("role", "employee")
    if role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin role required")

    brokerage_id = agent.get("brokerage_id")
    if not brokerage_id:
        raise HTTPException(status_code=404, detail="No brokerage linked to this agent")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    db = get_supabase()
    result = _apply_brokerage_update(db, brokerage_id, updates)
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
    result = _apply_brokerage_update(db, brokerage_id, updates)
    if not result.data:
        raise HTTPException(status_code=404, detail="Brokerage not found")
    return result.data[0]
