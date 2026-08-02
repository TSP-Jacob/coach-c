"""
Impersonation router (admin only).

Lets a Chardin Systems admin open a client's REAL Coach-C session — "View as
client" — without ever touching the client's password. The admin's own token
is verified as usual (must resolve to an agents.role == 'admin'); a Supabase
magic-link is minted for the target user's email via the Admin API and
immediately redeemed server-side for a genuine access/refresh token pair. The
frontend then hands that access_token to Coach-C's existing /auth SSO route
exactly like a normal login — no changes needed on the Coach-C frontend side.

Uses a FRESH Supabase client (not the shared app.database singleton) because
generate_link + verify_otp mutate the calling client's in-memory session
state; we don't want that leaking onto the process-wide client every other
request shares.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from supabase import create_client
from app.config import settings
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


def _require_admin(agent_id: str | None):
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    res = db.table("agents").select("id, role").eq("id", agent_id).single().execute()
    if not res.data or res.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return res.data


class ImpersonateRequest(BaseModel):
    email: EmailStr


@router.post("/")
def impersonate(body: ImpersonateRequest, agent_id: str | None = Depends(get_jwt_agent_id)):
    admin = _require_admin(agent_id)

    scoped = create_client(settings.supabase_url, settings.supabase_service_role_key)

    try:
        link = scoped.auth.admin.generate_link({"type": "magiclink", "email": body.email})
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"No account found for {body.email}") from e

    hashed_token = link.properties.hashed_token if link and link.properties else None
    if not hashed_token:
        raise HTTPException(status_code=500, detail="Could not mint an impersonation session")

    try:
        redeemed = scoped.auth.verify_otp({"type": "magiclink", "token_hash": hashed_token})
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not start the impersonation session") from e

    if not redeemed or not redeemed.session:
        raise HTTPException(status_code=500, detail="Could not start the impersonation session")

    # Lightweight audit trail — who viewed as whom.
    print(f"[impersonate] admin {admin['id']} ({body.email} target) started a view-as session")

    return {
        "access_token": redeemed.session.access_token,
        "refresh_token": redeemed.session.refresh_token,
        "target_email": body.email,
    }
