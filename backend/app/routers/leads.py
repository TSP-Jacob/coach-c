import hashlib
import hmac
import logging
import os
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

logger = logging.getLogger(__name__)

router = APIRouter()


class LeadUpdate(BaseModel):
    status: str | None = None
    agent_id: str | None = None
    contact_method: str | None = None


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
    consent_text: str | None = None  # exact consent paragraph shown to homeowner


@router.get("/")
def list_leads(
    source:           str | None = Query(None),
    status:           str | None = Query(None),
    agent_id:         str | None = Query(None),
    jwt_agent_id:     str | None = Depends(get_jwt_agent_id),
):
    caller_id = jwt_agent_id
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

    q = db.table("leads").select("*")

    if role in ("admin", "manager"):
        # Managers and admins see every lead; optionally filter to one agent
        if agent_id:
            q = q.eq("agent_id", agent_id)
    else:
        # Employees see only leads assigned to them or still unassigned
        q = q.or_(f"agent_id.eq.{caller_id},agent_id.is.null")

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
    # When logging a contact method, also stamp the time and advance status
    if updates.get("contact_method"):
        from datetime import datetime, timezone
        updates.setdefault("status", "contacted")
        updates["contacted_at"] = datetime.now(timezone.utc).isoformat()
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

    # Build location string from address parts
    location_parts = [p for p in [payload.address, payload.city, payload.province] if p]
    location = ", ".join(location_parts) if location_parts else None

    # 1. Create lead record
    lead_result = db.table("leads").insert({
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
    lead = lead_result.data[0] if lead_result.data else {}

    # 2. Also create a client record so the lead appears in the Clients section
    # Skip if a client with the same phone already exists (avoid duplicates)
    existing = None
    client_id = None
    if payload.owner_phone:
        existing_rows = db.table("clients").select("id").eq("phone", payload.owner_phone).execute().data
        existing = existing_rows[0] if existing_rows else None
    if existing:
        client_id = existing["id"]
    else:
        client_result = db.table("clients").insert({
            "name": payload.owner_name,
            "phone": payload.owner_phone,
            "email": payload.owner_email,
            "type": "seller",
            "client_status": "Lead",
            "location": location,
            # agent_id intentionally null — unassigned until picked up
        }).execute()
        if client_result.data:
            client_id = client_result.data[0]["id"]

    # 3. Store consent record if consent was given
    lead_id = lead.get("id")
    if payload.consent_given and payload.consent_text and client_id:
        # Look up the org email from any brokerage that has one set
        org_email = None
        try:
            brokerage_rows = db.table("brokerages").select("email").not_.is_("email", "null").limit(1).execute().data
            if brokerage_rows:
                org_email = brokerage_rows[0].get("email")
        except Exception:
            pass

        db.table("consents").insert({
            "client_id": client_id,
            "lead_id": lead_id,
            "owner_name": payload.owner_name,
            "owner_email": payload.owner_email,
            "owner_phone": payload.owner_phone,
            "consent_text": payload.consent_text,
            "sent_to_email": org_email,
        }).execute()

        # 4. Send consent log email to the org if we have an address and a Resend key
        if org_email:
            _send_consent_email(org_email, payload, lead_id, client_id)

    return {"lead_id": lead_id}


def _send_consent_email(to_email: str, payload: "HomeValuePayload", lead_id, client_id):
    """Send consent notification email via Resend (https://resend.com).
    Requires RESEND_API_KEY env var. Fails silently so the webhook always succeeds."""
    import httpx
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.info("RESEND_API_KEY not set — skipping consent email")
        return
    try:
        body_html = f"""
<h2>Consent Log — Home Value</h2>
<p><strong>Homeowner:</strong> {payload.owner_name}</p>
<p><strong>Phone:</strong> {payload.owner_phone or "—"}</p>
<p><strong>Email:</strong> {payload.owner_email or "—"}</p>
<p><strong>Property:</strong> {", ".join(p for p in [payload.address, payload.city, payload.province] if p)}</p>
<hr/>
<h3>Consent text shown to homeowner:</h3>
<blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555">
  {payload.consent_text}
</blockquote>
<hr/>
<p style="color:#888;font-size:12px">Lead ID: {lead_id} · Client ID: {client_id}</p>
"""
        httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": "HomeValue <noreply@chardinsystems.com>",
                "to": [to_email],
                "subject": f"Consent received — {payload.owner_name} ({payload.city or ''})",
                "html": body_html,
            },
            timeout=10,
        )
    except Exception as e:
        logger.warning("Failed to send consent email: %s", e)
