"""Organization Profile router.

GET  /api/organization/          — get the brokerage profile for the authenticated agent
PATCH /api/organization/         — update it (manager or admin)
GET  /api/organization/all       — list all brokerage profiles (admin only)
PATCH /api/organization/{id}     — update any brokerage by id (admin only)
"""
from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from app.database import get_supabase
from app.config import settings
from app.middleware.auth import get_jwt_agent_id
from app.services.industry import INDUSTRY_MODES
from app.routers.calls import _twilio_callback_url

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


# ─── Onboarding / call-routing setup checklist ─────────────────────────────────
# Admin-only. Two call pipelines an org can be wired into:
#   1. Human-forward — a phone_numbers row whose Twilio number's Voice webhook
#      should point at this backend's /api/calls/webhook/twilio/voice.
#   2. AI phone agent — a separate deployment (e.g. Twilio+Gemini bridge on
#      Railway) registered in phone_agent_deployments, which Coach-C otherwise
#      has no visibility into at all.
# This section live-checks both against the real world (Twilio's API, the
# deployment's /health) rather than just trusting what's in our own tables.

def _require_admin_caller(agent_id: str | None) -> dict:
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    caller = _get_agent_with_brokerage(agent_id)
    if caller.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return caller


async def _twilio_number_status(number_last10: str) -> dict:
    """How this number's Voice webhook is actually configured in Twilio right
    now. Assumes NANP (+1) — matches the last-10-digit convention normalize_number
    uses everywhere else in this codebase."""
    sid, token = settings.twilio_account_sid, settings.twilio_auth_token
    if not (sid and token):
        return {"checked": False, "reason": "Twilio credentials not configured on the backend"}
    e164 = f"+1{number_last10}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/IncomingPhoneNumbers.json",
                params={"PhoneNumber": e164},
                auth=(sid, token),
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return {"checked": False, "reason": f"Twilio lookup failed: {exc}"}
    rows = data.get("incoming_phone_numbers") or []
    if not rows:
        return {"checked": True, "found_in_twilio": False, "voice_url": None}
    return {"checked": True, "found_in_twilio": True, "voice_url": rows[0].get("voice_url")}


async def _ping_health(base_url: str) -> dict:
    url = base_url.rstrip("/") + "/health"
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.get(url)
            return {"reachable": resp.status_code == 200, "status_code": resp.status_code}
    except Exception as exc:
        return {"reachable": False, "error": str(exc)}


@router.get("/{brokerage_id}/setup-status")
async def org_setup_status(brokerage_id: str, request: Request, agent_id: str = Depends(get_jwt_agent_id)):
    """Admin only — live checklist of what's wired up for this org's call
    pipelines. Hits Twilio's API and each registered phone agent's /health,
    so this reflects reality, not just what's recorded in our own tables."""
    _require_admin_caller(agent_id)

    db = get_supabase()
    brokerage = db.table("brokerages").select("*").eq("id", brokerage_id).maybe_single().execute()
    if not brokerage or not brokerage.data:
        raise HTTPException(status_code=404, detail="Organization not found")

    agents = db.table("agents").select("id, role").eq("brokerage_id", brokerage_id).execute().data or []
    admin_or_manager_count = sum(1 for a in agents if a.get("role") in ("admin", "manager"))
    agent_ids_in_org = {a["id"] for a in agents}

    expected_voice_webhook = _twilio_callback_url(request, "/api/calls/webhook/twilio/voice")
    phone_rows = db.table("phone_numbers").select("*").eq("brokerage_id", brokerage_id).execute().data or []
    phone_numbers_status = []
    for p in phone_rows:
        twilio_check = await _twilio_number_status(p["number"])
        voice_url = twilio_check.get("voice_url")
        matches = bool(voice_url) and voice_url.split("?")[0] == expected_voice_webhook.split("?")[0]
        phone_numbers_status.append({
            **p,
            "expected_webhook": expected_voice_webhook,
            "twilio_checked": twilio_check.get("checked", False),
            "twilio_found": twilio_check.get("found_in_twilio"),
            "twilio_voice_url": voice_url,
            "twilio_matches": matches,
            "twilio_error": twilio_check.get("reason"),
        })

    deployments = (db.table("phone_agent_deployments").select("*, agents(name)")
                   .eq("brokerage_id", brokerage_id).execute().data or [])
    phone_agents_status = []
    for d in deployments:
        health = await _ping_health(d["base_url"])
        phone_agents_status.append({
            **d,
            "agent_valid": d.get("agent_id") in agent_ids_in_org,
            "reachable": health.get("reachable"),
            "health_error": health.get("error"),
        })

    return {
        "brokerage": {
            "id": brokerage.data["id"],
            "name": brokerage.data["name"],
            "industry_mode_set": bool(brokerage.data.get("industry_mode")),
        },
        "team": {
            "total_agents": len(agents),
            "admin_or_manager_count": admin_or_manager_count,
            "ok": admin_or_manager_count > 0,
        },
        "phone_numbers": phone_numbers_status,
        "phone_agents": phone_agents_status,
    }


class PhoneAgentCreate(BaseModel):
    agent_id: str
    name: str
    base_url: str


class PhoneAgentUpdate(BaseModel):
    agent_id: str | None = None
    name: str | None = None
    base_url: str | None = None


@router.post("/{brokerage_id}/phone-agents")
def create_phone_agent(brokerage_id: str, body: PhoneAgentCreate, agent_id: str = Depends(get_jwt_agent_id)):
    _require_admin_caller(agent_id)
    name = body.name.strip()
    base_url = body.base_url.strip().rstrip("/")
    if not name or not base_url:
        raise HTTPException(status_code=400, detail="name and base_url are required")
    db = get_supabase()
    result = db.table("phone_agent_deployments").insert({
        "brokerage_id": brokerage_id,
        "agent_id": body.agent_id,
        "name": name,
        "base_url": base_url,
    }).execute()
    return result.data[0]


@router.patch("/{brokerage_id}/phone-agents/{deployment_id}")
def update_phone_agent(
    brokerage_id: str, deployment_id: str, body: PhoneAgentUpdate,
    agent_id: str = Depends(get_jwt_agent_id),
):
    _require_admin_caller(agent_id)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "base_url" in updates:
        updates["base_url"] = updates["base_url"].strip().rstrip("/")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    db = get_supabase()
    result = (db.table("phone_agent_deployments").update(updates)
              .eq("id", deployment_id).eq("brokerage_id", brokerage_id).execute())
    if not result.data:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return result.data[0]


@router.delete("/{brokerage_id}/phone-agents/{deployment_id}")
def delete_phone_agent(brokerage_id: str, deployment_id: str, agent_id: str = Depends(get_jwt_agent_id)):
    _require_admin_caller(agent_id)
    db = get_supabase()
    result = (db.table("phone_agent_deployments").delete()
              .eq("id", deployment_id).eq("brokerage_id", brokerage_id).execute())
    if not result.data:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return {"deleted": True}
