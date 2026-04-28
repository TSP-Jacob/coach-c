from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from app.database import get_supabase
from app.services.rag import index_client_notes
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()

# Hardcoded demo brokerage — used for new sign-ups until multi-tenancy lands
_DEMO_BROKERAGE_ID = "00000000-0000-0000-0000-000000000001"


class AgentCreate(BaseModel):
    brokerage_id: str
    name: str
    email: str


class ClientCreate(BaseModel):
    agent_id: str
    name: str
    phone: str | None = None
    email: str | None = None
    type: str = "buyer"
    notes: str | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    type: str | None = None
    notes: str | None = None


@router.post("/")
def create_agent(body: AgentCreate):
    db = get_supabase()
    result = db.table("agents").insert(body.model_dump()).execute()
    return result.data[0]


@router.post("/register")
def register_agent(
    body: AgentCreate,
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
    authorization: str | None = Header(None),
):
    """
    Called after Supabase Auth sign-up to create the agent profile.
    Links the new agent row to the auth user via auth_user_id.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header required")

    token = authorization.split(" ", 1)[1]
    db = get_supabase()

    try:
        user_resp = db.auth.get_user(token)
        if not user_resp.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        auth_user_id = user_resp.user.id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")

    # Prevent duplicate profiles
    existing = (
        db.table("agents")
        .select("id")
        .eq("auth_user_id", auth_user_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        return existing.data

    payload = {
        "brokerage_id": _DEMO_BROKERAGE_ID,
        "name": body.name,
        "email": body.email,
        "auth_user_id": auth_user_id,
    }
    result = db.table("agents").insert(payload).execute()
    return result.data[0]


@router.get("/me")
def get_my_agent(jwt_agent_id: str = Depends(get_jwt_agent_id)):
    """Returns the agent profile for the authenticated user."""
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    result = (
        db.table("agents")
        .select("*, brokerages(name)")
        .eq("id", jwt_agent_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Agent not found")
    return result.data


@router.get("/{agent_id}")
def get_agent(agent_id: str):
    db = get_supabase()
    result = db.table("agents").select("*, brokerages(name)").eq("id", agent_id).single().execute()
    if not result.data:
        raise HTTPException(404, "Agent not found")
    return result.data


@router.get("/{agent_id}/stats")
def agent_stats(agent_id: str):
    db = get_supabase()
    calls = db.table("calls").select("overall_score, call_type, created_at").eq("agent_id", agent_id).eq("status", "complete").execute().data
    if not calls:
        return {"total_calls": 0, "average_score": None, "by_type": {}}
    scores = [c["overall_score"] for c in calls if c["overall_score"] is not None]
    by_type: dict = {}
    for c in calls:
        ct = c.get("call_type") or "unknown"
        by_type.setdefault(ct, []).append(c.get("overall_score"))
    return {
        "total_calls": len(calls),
        "average_score": round(sum(scores) / len(scores)) if scores else None,
        "by_type": {k: round(sum(v) / len(v)) for k, v in by_type.items() if v},
    }


# ─── Clients ──────────────────────────────────────────────────────────────────

@router.post("/clients")
def create_client(body: ClientCreate):
    db = get_supabase()
    result = db.table("clients").insert(body.model_dump()).execute()
    client = result.data[0]
    if body.notes:
        index_client_notes(client["id"], body.notes)
    return client


@router.get("/{agent_id}/clients")
def list_clients(agent_id: str):
    db = get_supabase()
    return db.table("clients").select("*").eq("agent_id", agent_id).order("name").execute().data


@router.patch("/clients/{client_id}")
def update_client(client_id: str, body: ClientUpdate):
    db = get_supabase()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    result = db.table("clients").update(updates).eq("id", client_id).execute()
    client = result.data[0]
    if body.notes:
        index_client_notes(client_id, body.notes)
    return client
