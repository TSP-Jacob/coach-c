"""
Optional JWT auth dependency.

- If Authorization: Bearer <jwt> is present → verify with Supabase and
  return the agent_id linked to that auth user.
- If no JWT → return None (dev / SKIP_AUTH mode; caller decides what to do).

Auto-create: if the JWT is valid but no agent profile is linked yet
(e.g. the register call failed during sign-up), we create one on the
fly using the email from the Supabase user record.
"""
import time
from fastapi import Header, HTTPException
from app.database import get_supabase

_DEMO_BROKERAGE_ID = "00000000-0000-0000-0000-000000000001"

# In-memory token -> agent_id cache. Verifying a Supabase JWT and resolving the
# agent is ~2 network round-trips; a signed-in user makes many requests with the
# same token, so caching the result for a short window removes that cost from
# nearly every call. Short TTL keeps auth changes reasonably fresh.
_TOKEN_TTL_SECONDS = 300
_token_cache: dict[str, tuple[str, float]] = {}


def _prune_token_cache(now: float) -> None:
    for k in [k for k, (_, exp) in _token_cache.items() if exp <= now]:
        _token_cache.pop(k, None)


async def get_jwt_agent_id(
    authorization: str | None = Header(None),
) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", 1)[1]
    return await resolve_agent_from_token(token)


async def resolve_agent_from_token(token: str) -> str | None:
    """Verify a Supabase JWT and return the linked agent_id (short-TTL cached).

    Shared by the HTTP `get_jwt_agent_id` dependency and the voice WebSocket
    (which can't use a Header dependency). Raises HTTPException on an invalid
    token; auto-creates a minimal agent profile if the user has none yet.
    """
    now = time.monotonic()
    hit = _token_cache.get(token)
    if hit and hit[1] > now:
        return hit[0]

    agent_id = await _resolve_agent_uncached(token)
    if agent_id:
        if len(_token_cache) > 2000:
            _prune_token_cache(now)
        _token_cache[token] = (agent_id, now + _TOKEN_TTL_SECONDS)
    return agent_id


async def _resolve_agent_uncached(token: str) -> str | None:
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

    # 3. Auto-create a minimal profile so the user is never stuck.
    #    Look up the Chardin portal profiles table to get the correct role:
    #      profiles.role = 'admin'    → agents.role = 'admin'
    #      profiles.role = 'client'   → agents.role = 'manager'
    #      profiles.role = 'employee' → agents.role = 'employee'
    _ROLE_MAP = {"admin": "admin", "client": "manager", "employee": "employee"}
    chardin_role = "employee"
    try:
        profile_res = (db.table("profiles")
                       .select("role")
                       .eq("id", auth_user_id)
                       .maybe_single()
                       .execute())
        if profile_res and profile_res.data:
            chardin_role = profile_res.data.get("role", "employee")
    except Exception:
        pass
    agent_role = _ROLE_MAP.get(chardin_role, "employee")

    name = email.split("@")[0].replace(".", " ").title() if email else "New Agent"
    new_agent = db.table("agents").insert({
        "brokerage_id": _DEMO_BROKERAGE_ID,
        "name": name,
        "email": email,
        "auth_user_id": auth_user_id,
        "role": agent_role,
    }).execute()
    if new_agent.data:
        return new_agent.data[0]["id"]

    raise HTTPException(status_code=500, detail="Failed to create agent profile")
