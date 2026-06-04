"""
Billing router — invoices, recurring plans, and Stripe payments.

Roles (agents.role):
  - admin   : configures invoice amounts / recurring plans for managers
  - manager : views their own billing, pays invoices, subscribes
  - employee: no billing access
"""
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
import stripe
from app.config import settings
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

# Initialise Stripe — no-ops gracefully if key not set
stripe.api_key = settings.stripe_secret_key

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


# ─── Stripe helpers ───────────────────────────────────────────────────────────

def _get_or_create_stripe_customer(db, agent: dict) -> str:
    """
    Return the Stripe customer id for an agent.
    Resolution order so we never create duplicates:
      1. our billing_customers mapping
      2. an existing Stripe customer with the same email (e.g. one you created
         in the Stripe Dashboard when issuing an invoice)
      3. create a new customer
    """
    existing = (db.table("billing_customers")
                .select("stripe_customer_id")
                .eq("agent_id", agent["id"])
                .maybe_single().execute())
    if existing and existing.data:
        return existing.data["stripe_customer_id"]

    customer_id = None
    email = (agent.get("email") or "").strip()

    # 2. Reuse an existing Stripe customer with this email
    if email:
        try:
            found = stripe.Customer.list(email=email, limit=1)
            if found and found.data:
                customer_id = found.data[0].id
        except Exception:
            pass

    # 3. Otherwise create one
    if not customer_id:
        customer = stripe.Customer.create(
            email=email or None,
            name=agent.get("name"),
            metadata={"agent_id": agent["id"]},
        )
        customer_id = customer.id

    db.table("billing_customers").insert({
        "agent_id": agent["id"],
        "stripe_customer_id": customer_id,
    }).execute()
    return customer_id


@router.post("/portal")
def billing_portal(agent: dict = Depends(require_billing_viewer)):
    """
    Create a Stripe Customer Portal session for the current manager and return
    its URL. The portal is Stripe-hosted: the manager sees all their invoices,
    pays, updates payment methods, and views history — no custom checkout.
    """
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Payment processing not configured")

    db = get_supabase()
    customer_id = _get_or_create_stripe_customer(db, agent)

    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{settings.frontend_url}/billing",
        )
    except Exception as e:
        # Most common cause: the Customer Portal hasn't been activated in the
        # Stripe Dashboard (Settings → Billing → Customer portal).
        raise HTTPException(status_code=503, detail=f"Could not open billing portal: {e}")

    return {"url": session.url}


# ─── Manager checkout — single payment ───────────────────────────────────────

class CheckoutSingleRequest(BaseModel):
    invoice_id: str


@router.post("/checkout/single")
def checkout_single(body: CheckoutSingleRequest, agent: dict = Depends(require_billing_viewer)):
    """Return a Stripe Checkout URL for a one-time invoice payment."""
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Payment processing not configured")

    db = get_supabase()
    inv_res = (db.table("invoices").select("*")
               .eq("id", body.invoice_id)
               .eq("agent_id", agent["id"])
               .single().execute())
    if not inv_res.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    inv = inv_res.data
    if not inv.get("amount_cents"):
        raise HTTPException(status_code=400, detail="Invoice amount not set")

    customer_id = _get_or_create_stripe_customer(db, agent)
    frontend = settings.frontend_url

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": inv.get("currency", "cad"),
                "unit_amount": inv["amount_cents"],
                "product_data": {"name": inv.get("description") or "Single Payment"},
            },
            "quantity": 1,
        }],
        success_url=f"{frontend}/billing?payment=success",
        cancel_url=f"{frontend}/billing?payment=canceled",
        metadata={"invoice_id": inv["id"], "agent_id": agent["id"]},
    )

    db.table("invoices").update({
        "stripe_checkout_session_id": session.id,
        "status": "pending",
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", inv["id"]).execute()

    return {"url": session.url}


# ─── Manager checkout — recurring subscription ───────────────────────────────

@router.post("/checkout/recurring")
def checkout_recurring(agent: dict = Depends(require_billing_viewer)):
    """Return a Stripe Checkout URL to start a monthly subscription."""
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Payment processing not configured")

    db = get_supabase()
    plan_res = (db.table("recurring_plans").select("*")
                .eq("agent_id", agent["id"])
                .maybe_single().execute())
    if not plan_res or not plan_res.data or not plan_res.data.get("amount_cents"):
        raise HTTPException(status_code=400, detail="Recurring plan not configured by admin")
    plan = plan_res.data

    if plan.get("status") == "active":
        raise HTTPException(status_code=400, detail="Subscription already active")

    customer_id = _get_or_create_stripe_customer(db, agent)
    frontend = settings.frontend_url

    # Create a Stripe price on-the-fly (monthly)
    price = stripe.Price.create(
        unit_amount=plan["amount_cents"],
        currency=plan.get("currency", "cad"),
        recurring={"interval": "month"},
        product_data={"name": plan.get("description") or "Monthly Subscription"},
    )

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        mode="subscription",
        line_items=[{"price": price.id, "quantity": 1}],
        success_url=f"{frontend}/billing?subscription=success",
        cancel_url=f"{frontend}/billing?subscription=canceled",
        metadata={"agent_id": agent["id"], "plan_id": plan["id"]},
    )

    db.table("recurring_plans").update({
        "status": "pending",
        "stripe_price_id": price.id,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", plan["id"]).execute()

    return {"url": session.url}


# ─── Stripe webhook ───────────────────────────────────────────────────────────

def _period_end_iso(sub) -> str | None:
    """
    Return the subscription's current period end as ISO, handling both old and
    new Stripe API shapes. In API 2025-03+ `current_period_end` moved off the
    Subscription onto each subscription item.
    """
    ts = None
    try:
        ts = sub.get("current_period_end")
    except Exception:
        ts = getattr(sub, "current_period_end", None)
    if not ts:
        try:
            ts = sub["items"]["data"][0]["current_period_end"]
        except Exception:
            ts = None
    return datetime.fromtimestamp(ts).isoformat() if ts else None


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """
    Receives Stripe events and updates invoice / plan status accordingly.
    Handles:
      checkout.session.completed — marks single invoice paid OR activates subscription
      invoice.paid               — records each recurring renewal in history
      invoice.payment_failed     — marks plan as past_due
    """
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    # Parse + verify the event (robust across stripe-python versions)
    try:
        if settings.stripe_webhook_secret:
            event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
        else:
            import json
            event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)
    except Exception as e:
        print(f"[stripe_webhook] signature/parse error: {e}")
        raise HTTPException(status_code=400, detail="Invalid webhook payload or signature")

    db = get_supabase()

    # Process the event. Any error is logged with a full traceback; we still
    # return 200 so Stripe doesn't retry-storm while we iterate.
    try:
        etype = event["type"]
        obj   = event["data"]["object"]

        if etype == "checkout.session.completed":
            metadata        = obj.get("metadata") or {}
            invoice_id      = metadata.get("invoice_id")
            plan_id         = metadata.get("plan_id")
            agent_id        = metadata.get("agent_id")
            subscription_id = obj.get("subscription")

            if invoice_id:
                db.table("invoices").update({
                    "status": "paid",
                    "paid_at": datetime.utcnow().isoformat(),
                    "stripe_payment_intent_id": obj.get("payment_intent"),
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", invoice_id).execute()
                print(f"[stripe_webhook] marked invoice {invoice_id} paid")

            if plan_id and subscription_id:
                sub = stripe.Subscription.retrieve(subscription_id)
                db.table("recurring_plans").update({
                    "status": "active",
                    "stripe_subscription_id": subscription_id,
                    "current_period_end": _period_end_iso(sub),
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", plan_id).execute()

                if agent_id:
                    plan = db.table("recurring_plans").select("amount_cents,currency,description").eq("id", plan_id).single().execute()
                    if plan.data:
                        db.table("invoices").insert({
                            "agent_id": agent_id,
                            "type": "recurring",
                            "status": "paid",
                            "amount_cents": plan.data.get("amount_cents"),
                            "currency": plan.data.get("currency", "cad"),
                            "description": plan.data.get("description"),
                            "stripe_subscription_id": subscription_id,
                            "paid_at": datetime.utcnow().isoformat(),
                        }).execute()
                print(f"[stripe_webhook] activated subscription for plan {plan_id}")

        elif etype == "invoice.paid":
            sub_id = obj.get("subscription")
            if sub_id:
                plan = (db.table("recurring_plans").select("*")
                        .eq("stripe_subscription_id", sub_id)
                        .maybe_single().execute())
                if plan and plan.data:
                    sub = stripe.Subscription.retrieve(sub_id)
                    db.table("recurring_plans").update({
                        "status": "active",
                        "current_period_end": _period_end_iso(sub),
                        "updated_at": datetime.utcnow().isoformat(),
                    }).eq("id", plan.data["id"]).execute()

                    db.table("invoices").insert({
                        "agent_id": plan.data["agent_id"],
                        "type": "recurring",
                        "status": "paid",
                        "amount_cents": plan.data.get("amount_cents"),
                        "currency": plan.data.get("currency", "cad"),
                        "description": plan.data.get("description"),
                        "stripe_invoice_id": obj.get("id"),
                        "stripe_subscription_id": sub_id,
                        "paid_at": datetime.utcnow().isoformat(),
                    }).execute()

        elif etype == "invoice.payment_failed":
            sub_id = obj.get("subscription")
            if sub_id:
                db.table("recurring_plans").update({
                    "status": "past_due",
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("stripe_subscription_id", sub_id).execute()

    except Exception as e:
        import traceback
        print(f"[stripe_webhook] processing error for {event.get('type')}: {e}")
        traceback.print_exc()
        return {"received": True, "error": str(e)}

    return {"received": True}
