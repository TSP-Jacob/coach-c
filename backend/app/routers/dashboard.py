from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id
from app.services.coaching import CoachingService

router = APIRouter()
coaching_svc = CoachingService()


def _role(db, agent_id: str) -> str:
    try:
        res = db.table("agents").select("role").eq("id", agent_id).single().execute()
        return (res.data or {}).get("role", "employee")
    except Exception:
        return "employee"


@router.get("/overview")
def dashboard_overview(jwt_agent_id: str | None = Depends(get_jwt_agent_id)):
    """New-leads + follow-ups counts plus a one-sentence AI summary of what
    needs attention, for the dashboard header. Scoped the same way as the
    Leads and Follow-Ups pages: admins/managers see the whole org, everyone
    else sees their own + unassigned."""
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_supabase()
    role = _role(db, jwt_agent_id)
    can_manage = role in ("admin", "manager")

    lq = db.table("leads").select("id, name, source, created_at").eq("status", "new")
    if not can_manage:
        lq = lq.or_(f"agent_id.eq.{jwt_agent_id},agent_id.is.null")
    leads = lq.order("created_at", desc=True).limit(50).execute().data or []

    fq = db.table("clients").select("id, name, follow_up_date").not_.is_("follow_up_date", "null")
    if not can_manage:
        fq = fq.or_(f"agent_id.eq.{jwt_agent_id},agent_id.is.null")
    follow_ups = fq.order("follow_up_date").limit(50).execute().data or []

    today = date.today().isoformat()
    overdue = [f for f in follow_ups if f.get("follow_up_date") and f["follow_up_date"] < today]

    try:
        agent = db.table("agents").select("name, language").eq("id", jwt_agent_id).single().execute()
        agent_name = agent.data["name"] if agent.data else "there"
        language = (agent.data or {}).get("language") or "en"
    except Exception:
        agent_name = "there"
        language = "en"

    overview = coaching_svc.summarize_actions(leads, follow_ups, len(overdue), agent_name, language)

    return {
        "new_leads_count": len(leads),
        "follow_ups_count": len(follow_ups),
        "overdue_follow_ups_count": len(overdue),
        "overview": overview,
    }
