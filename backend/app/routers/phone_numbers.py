"""
Phone Numbers router (admin only).

Lets an admin map a phone number (e.g. a Twilio number) to an organization
(brokerage). Inbound calls on that number are recorded + coached and tagged
with the org via brokerage_id, so the resulting leads/clients/calls show up
under that organization in the portal.

Numbers are stored normalized to their last-10 digits so matching against an
inbound dialed number is consistent regardless of formatting / country code.
"""
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


def normalize_number(raw: str | None) -> str:
    """Last 10 digits — the stable key we match inbound calls against."""
    return re.sub(r"\D", "", raw or "")[-10:]


def _require_admin(agent_id: str | None):
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    res = db.table("agents").select("id, role").eq("id", agent_id).single().execute()
    if not res.data or res.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return res.data


def ensure_org_inbound_agent(db, brokerage_id: str) -> str:
    """
    Return the agent that should own inbound calls for this org. Inbound calls
    need an agent_id (calls/leads/clients are agent-scoped); for an org with no
    real users yet we create a placeholder "inbound" agent once and reuse it.
    """
    existing = (db.table("agents")
                .select("id, role")
                .eq("brokerage_id", brokerage_id)
                .execute().data or [])
    if existing:
        # Prefer a manager/admin, else any agent in the org.
        for role in ("manager", "admin", "employee"):
            for a in existing:
                if a.get("role") == role:
                    return a["id"]
        return existing[0]["id"]

    org = db.table("brokerages").select("name").eq("id", brokerage_id).single().execute().data or {}
    org_name = org.get("name") or "Organization"
    created = db.table("agents").insert({
        "brokerage_id": brokerage_id,
        "name": f"{org_name} (Inbound)",
        "email": f"inbound+{brokerage_id}@coachc.local",
        "role": "manager",
    }).execute().data
    if not created:
        raise HTTPException(status_code=500, detail="Could not create inbound agent for org")
    return created[0]["id"]


class PhoneNumberCreate(BaseModel):
    number: str
    brokerage_id: str
    label: str | None = None
    forward_to: str | None = None
    provider: str = "twilio"


@router.get("/")
def list_phone_numbers(agent_id: str | None = Depends(get_jwt_agent_id)):
    _require_admin(agent_id)
    db = get_supabase()
    return (db.table("phone_numbers")
            .select("*, brokerages(name), agents(name)")
            .order("created_at", desc=True)
            .execute().data)


@router.post("/")
def create_phone_number(body: PhoneNumberCreate, agent_id: str | None = Depends(get_jwt_agent_id)):
    _require_admin(agent_id)
    db = get_supabase()

    number = normalize_number(body.number)
    if len(number) < 10:
        raise HTTPException(status_code=400, detail="A full phone number is required")

    # Verify org exists
    org = db.table("brokerages").select("id").eq("id", body.brokerage_id).single().execute()
    if not org.data:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Reject duplicates with a clear message rather than a raw DB error
    dupe = db.table("phone_numbers").select("id").eq("number", number).execute().data
    if dupe:
        raise HTTPException(status_code=409, detail="That number is already associated with an organization")

    owner_agent_id = ensure_org_inbound_agent(db, body.brokerage_id)

    row = db.table("phone_numbers").insert({
        "number": number,
        "brokerage_id": body.brokerage_id,
        "agent_id": owner_agent_id,
        "label": body.label,
        "forward_to": normalize_number(body.forward_to) or None if body.forward_to else None,
        "provider": body.provider,
    }).execute().data[0]
    return row


@router.delete("/{phone_id}")
def delete_phone_number(phone_id: str, agent_id: str | None = Depends(get_jwt_agent_id)):
    _require_admin(agent_id)
    db = get_supabase()
    db.table("phone_numbers").delete().eq("id", phone_id).execute()
    return {"deleted": True}
