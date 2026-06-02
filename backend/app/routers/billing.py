"""
Billing router — invoices, recurring plans, and (Phase 2) Stripe payments.

Roles (agents.role):
  - admin   : configures invoice amounts / recurring plans for managers
  - manager : views their own billing, pays invoices, subscribes
  - employee: no billing access

Phase 1 (this file): schema-backed read paths + admin configuration.
Phase 2 (added once Stripe keys exist): checkout sessions + webhook.
"""
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _agent(agent_id: str | None):
    """Fetch the authenticated agent's record (id, role, name, email)."""
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    res = db.table("agents").select("id, role, name, email").eq("id", agent_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Agent not found")
    return res.data


def require_admin(agent_id: str | None = Depends(get_jwt_agent_id)) -> dict:
    agent = _agent(agent_id)
    if agent.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return agent


def require_billing_viewer(agent_id: str | None = Depends(get_jwt_agent_id)) -> dict:
    """Managers (and admins) may view billing; employees may not."""
    agent = _agent(agent_id)
    if agent.get("role") not in ("manager", "admin"):
        raise HTTPException(status_code=403, detail="Billing is available to managers only")
    return agent


def _dollars(cents: int | None) -> float | None:
    return None if cents is None else round(cents / 100, 2)


# ─── Manager-facing ──────────────────────────────────────────────────────────

@router.get("/me")
def my_billing(agent: dict = Depends(require_billing_viewer)):
    """
    Returns the two billing categories for the current manager, plus paid
    history and the next upcoming payment.

    Amounts are null when an admin has not configured them yet (UI shows blank).
    """
    db = get_supabase()
    agent_id = agent["id"]

    # Recurring (monthly) plan
    plan_res = db.table("recurring_plans").select("*").eq("agent_id", agent_id).maybe_single().execute()
    plan = plan_res.data if plan_res else None

    # Active/most-recent single invoice (the configurable one-off)
    single_res = (db.table("invoices")
                  .select("*")
                  .eq("agent_id", agent_id)
                  .eq("type", "single")
                  .in_("status", ["draft", "pending", "failed"])
                  .order("created_at", desc=True)
                  .limit(1).execute())
    single = single_res.data[0] if single_res.data else None

    # Paid history (both types)
    history = (db.table("invoices")
               .select("id, type, description, amount_cents, currency, status, paid_at, due_date, created_at")
               .eq("agent_id", agent_id)
               .eq("status", "paid")
               .order("paid_at", desc=True)
               .execute().data)

    # Upcoming payment: earliest of (unpaid single due date) and (subscription renewal)
    upcoming = None
    candidates = []
    if single and single.get("amount_cents") is not None:
        candidates.append({
            "type": "single",
            "amount": _dollars(single["amount_cents"]),
            "currency": single.get("currency", "cad"),
            "due_date": single.get("due_date"),
            "description": single.get("description"),
        })
    if plan and plan.get("status") == "active" and plan.get("current_period_end"):
        candidates.append({
            "type": "recurring",
            "amount": _dollars(plan.get("amount_cents")),
            "currency": plan.get("currency", "cad"),
            "due_date": plan.get("current_period_end"),
            "description": plan.get("description") or "Monthly subscription",
        })
    if candidates:
        upcoming = sorted(candidates, key=lambda c: str(c.get("due_date") or "9999"))[0]

    return {
        "single": {
            "invoice_id": single["id"] if single else None,
            "amount": _dollars(single["amount_cents"]) if single else None,
            "currency": (single or {}).get("currency", "cad"),
            "description": (single or {}).get("description"),
            "due_date": (single or {}).get("due_date"),
            "status": (single or {}).get("status"),
            "configured": bool(single and single.get("amount_cents") is not None),
        },
        "recurring": {
            "amount": _dollars(plan.get("amount_cents")) if plan else None,
            "currency": (plan or {}).get("currency", "cad"),
            "description": (plan or {}).get("description"),
            "status": (plan or {}).get("status", "inactive"),
            "current_period_end": (plan or {}).get("current_period_end"),
            "configured": bool(plan and plan.get("amount_cents") is not None),
        },
        "upcoming": upcoming,
        "history": [
            {
                "id": h["id"],
                "type": h["type"],
                "description": h.get("description"),
                "amount": _dollars(h.get("amount_cents")),
                "currency": h.get("currency", "cad"),
                "paid_at": h.get("paid_at"),
            }
            for h in history
        ],
    }


# ─── Admin-facing configuration ──────────────────────────────────────────────

class SingleConfig(BaseModel):
    amount: float | None = None        # dollars; None clears the amount
    description: str | None = None
    due_date: date | None = None


class RecurringConfig(BaseModel):
    amount: float | None = None        # dollars/month; None clears the amount
    description: str | None = None


class BillingConfig(BaseModel):
    single: SingleConfig | None = None
    recurring: RecurringConfig | None = None


@router.get("/admin/managers")
def list_billable_managers(admin: dict = Depends(require_admin)):
    """All manager accounts, with a quick billing summary for the admin list."""
    db = get_supabase()
    managers = db.table("agents").select("id, name, email").eq("role", "manager").order("name").execute().data

    plans = {p["agent_id"]: p for p in db.table("recurring_plans").select("agent_id, amount_cents, status").execute().data}

    out = []
    for m in managers:
        plan = plans.get(m["id"])
        out.append({
            "agent_id": m["id"],
            "name": m.get("name"),
            "email": m.get("email"),
            "recurring_amount": _dollars(plan.get("amount_cents")) if plan else None,
            "recurring_status": (plan or {}).get("status", "inactive"),
        })
    return out


@router.get("/admin/{agent_id}")
def get_manager_billing(agent_id: str, admin: dict = Depends(require_admin)):
    db = get_supabase()
    plan = db.table("recurring_plans").select("*").eq("agent_id", agent_id).maybe_single().execute()
    single = (db.table("invoices").select("*")
              .eq("agent_id", agent_id).eq("type", "single")
              .in_("status", ["draft", "pending", "failed"])
              .order("created_at", desc=True).limit(1).execute())
    plan_data = plan.data if plan else None
    single_data = single.data[0] if single.data else None
    return {
        "agent_id": agent_id,
        "single": {
            "amount": _dollars(single_data["amount_cents"]) if single_data else None,
            "description": (single_data or {}).get("description"),
            "due_date": (single_data or {}).get("due_date"),
        },
        "recurring": {
            "amount": _dollars(plan_data.get("amount_cents")) if plan_data else None,
            "description": (plan_data or {}).get("description"),
            "status": (plan_data or {}).get("status", "inactive"),
        },
    }


@router.put("/admin/{agent_id}")
def configure_manager_billing(agent_id: str, body: BillingConfig, admin: dict = Depends(require_admin)):
    """
    Admin sets the single-payment and/or recurring-monthly amounts for a manager.
    Stores amounts as draft invoice / inactive plan; Stripe objects are created
    later when the manager actually pays/subscribes (Phase 2).
    """
    db = get_supabase()

    # Validate target is a manager
    target = db.table("agents").select("id, role").eq("id", agent_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="Manager not found")
    if target.data.get("role") != "manager":
        raise HTTPException(status_code=400, detail="Target agent is not a manager")

    result: dict = {}

    # ── Single payment ──
    if body.single is not None:
        cents = None if body.single.amount is None else int(round(body.single.amount * 100))
        existing = (db.table("invoices").select("id")
                    .eq("agent_id", agent_id).eq("type", "single")
                    .in_("status", ["draft", "pending", "failed"])
                    .order("created_at", desc=True).limit(1).execute())
        payload = {
            "amount_cents": cents,
            "description": body.single.description,
            "due_date": body.single.due_date.isoformat() if body.single.due_date else None,
            "updated_at": datetime.utcnow().isoformat(),
        }
        if existing.data:
            db.table("invoices").update(payload).eq("id", existing.data[0]["id"]).execute()
            result["single_invoice_id"] = existing.data[0]["id"]
        else:
            row = db.table("invoices").insert({
                "agent_id": agent_id,
                "type": "single",
                "status": "draft",
                "currency": "cad",
                "created_by": admin["id"],
                **payload,
            }).execute().data[0]
            result["single_invoice_id"] = row["id"]

    # ── Recurring plan ──
    if body.recurring is not None:
        cents = None if body.recurring.amount is None else int(round(body.recurring.amount * 100))
        existing = db.table("recurring_plans").select("id, status").eq("agent_id", agent_id).maybe_single().execute()
        payload = {
            "amount_cents": cents,
            "description": body.recurring.description,
            "updated_at": datetime.utcnow().isoformat(),
        }
        if existing and existing.data:
            db.table("recurring_plans").update(payload).eq("id", existing.data["id"]).execute()
            result["recurring_plan_id"] = existing.data["id"]
        else:
            row = db.table("recurring_plans").insert({
                "agent_id": agent_id,
                "status": "inactive",
                "currency": "cad",
                "created_by": admin["id"],
                **payload,
            }).execute().data[0]
            result["recurring_plan_id"] = row["id"]

    return {"ok": True, **result}
