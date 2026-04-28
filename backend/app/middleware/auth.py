"""
Optional JWT auth dependency.

- If Authorization: Bearer <jwt> is present → verify with Supabase and
  return the agent_id linked to that auth user.
- If no JWT → return None (dev / SKIP_AUTH mode; caller decides what to do).

Auto-create: if the JWT is valid but no agent profile is linked yet
(e.g. the register call failed during sign-up), we create one on the
fly using the email from the Supabase user record.
"""
from fastapi import Header, HTTPException
from app.database import get_supabase

_DEMO_BROKERAGE_ID = "00000000-0000-0000-0000-000000000001"


async def get_jwt_agent_id(
    authorization: str | None = Header(None),
) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", 1)[1]
    db = get_supabase()

    try:
        user_resp = db.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")

    if not user_resp.user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = user_resp.user
    auth_user_id = user.id
    email = user.email or ""

    # 1. Look up by auth_user_id
    result = (
        db.table("agents")
        .select("id")
        .eq("auth_user_id", auth_user_id)
        .maybe_single()
        .execute()
    )
    if result and result.data:
        return result.data["id"]

    # 2. Fallback: look up by email and link the auth_user_id
    if email:
        by_email = (
            db.table("agents")
            .select("id")
            .eq("email", email)
            .maybe_single()
            .execute()
        )
        if by_email and by_email.data:
            agent_id = by_email.data["id"]
            db.table("agents").update({"auth_user_id": auth_user_id}).eq("id", agent_id).execute()
            return agent_id

    # 3. Auto-create a minimal profile so the user is never stuck
    name = email.split("@")[0].replace(".", " ").title() if email else "New Agent"
    new_agent = db.table("agents").insert({
        "brokerage_id": _DEMO_BROKERAGE_ID,
        "name": name,
        "email": email,
        "auth_user_id": auth_user_id,
    }).execute()
    if new_agent.data:
        return new_agent.data[0]["id"]

    raise HTTPException(status_code=500, detail="Failed to create agent profile")
