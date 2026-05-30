import hashlib
import hmac
import os
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


class LeadUpdate(BaseModel):
    status: str | None = None
    agent_id: str | None = None


class HomeValuePayload(BaseModel):
    owner_name: str
    owner_email: str | None = None
    owner_phone: str | None = None
    address: str | None = None
    city: str | None = None
    province: str | None = None
    property_type: str | None = None
    estimated_value: float | None = None
    timeline_to_sell: str | None = None
    consent_given: bool = False


@router.get("/")
def list_leads(
    source: str | None = Query(None),
    status: str | None = Query(None),
    agent_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    q = db.table("leads").select("*").eq("agent_id", effective_agent_id)
    if source:
        q = q.eq("source", source)
    if status:
        q = q.eq("status", status)
    return q.order("created_at", desc=True).execute().data


@router.patch("/{lead_id}")
def update_lead(
    lead_id: str,
    body: LeadUpdate,
    agent_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = db.table("leads").update(updates).eq("id", lead_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    return result.data[0]


@router.post("/webhook/homevalue")
async def homevalue_webhook(request: Request):
    secret = os.environ.get("HOMEVALUE_WEBHOOK_SECRET", "")
    body_bytes = await request.body()

    if secret:
        sig = request.headers.get("x-homevalue-signature", "")
        expected = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=401, detail="Invalid signature")

    payload = HomeValuePayload.model_validate_json(body_bytes)

    db = get_supabase()
    result = db.table("leads").insert({
        "name": payload.owner_name,
        "phone": payload.owner_phone,
        "email": payload.owner_email,
        "source": "home_value",
        "status": "new",
        "address": payload.address,
        "city": payload.city,
        "province": payload.province,
        "property_type": payload.property_type,
        "estimated_value": payload.estimated_value,
        "timeline_to_sell": payload.timeline_to_sell,
    }).execute()

    lead = result.data[0] if result.data else {}
    return {"lead_id": lead.get("id")}
