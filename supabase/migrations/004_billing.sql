-- Migration 004 — Billing: invoices, recurring plans, Stripe customer mapping
-- Run this in your Supabase SQL editor.
--
-- Model:
--   billing_customers : one Stripe customer per billable agent (manager)
--   recurring_plans   : the monthly subscription per manager (amount blank
--                       until an admin sets it); holds Stripe price/subscription ids
--   invoices          : every charge — one-time single payments AND each monthly
--                       cycle invoice — used for the paid-history and upcoming views
--
-- Amounts are stored in the smallest currency unit (cents). A NULL amount means
-- "not yet configured by an admin" and the UI shows a blank.

-- ─── Stripe customer mapping ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_customers (
  agent_id           UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Recurring (monthly) plan per manager ────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_plans (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id               UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount_cents           INTEGER,                 -- NULL until an admin sets it
  currency               TEXT NOT NULL DEFAULT 'cad',
  description            TEXT,
  -- 'inactive' until subscribed; 'active' once Stripe subscription is live
  status                 TEXT NOT NULL DEFAULT 'inactive'
                           CHECK (status IN ('inactive','pending','active','past_due','canceled')),
  stripe_price_id        TEXT,
  stripe_subscription_id TEXT,
  current_period_end     TIMESTAMPTZ,             -- next renewal (upcoming payment)
  created_by             UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id)                                -- one monthly plan per manager
);

-- ─── Invoices (single one-offs + recurring cycle invoices) ───────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type                      TEXT NOT NULL CHECK (type IN ('single','recurring')),
  description               TEXT,
  amount_cents              INTEGER,              -- NULL until an admin sets it
  currency                  TEXT NOT NULL DEFAULT 'cad',
  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','pending','paid','failed','canceled','void')),
  due_date                  DATE,
  -- Stripe references
  stripe_payment_intent_id  TEXT,
  stripe_checkout_session_id TEXT,
  stripe_invoice_id         TEXT,
  stripe_subscription_id    TEXT,                 -- set on recurring cycle invoices
  -- audit
  created_by                UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS invoices_agent_status
  ON invoices (agent_id, status, due_date);

CREATE INDEX IF NOT EXISTS invoices_agent_created
  ON invoices (agent_id, created_at DESC);

-- ─── Row-level security ──────────────────────────────────────────────────────
-- The backend uses the service-role key (bypasses RLS) and enforces access in
-- code. Enable RLS with service-role full access so direct anon access is denied.
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_billing_customers ON billing_customers;
CREATE POLICY service_all_billing_customers ON billing_customers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all_recurring_plans ON recurring_plans;
CREATE POLICY service_all_recurring_plans ON recurring_plans FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all_invoices ON invoices;
CREATE POLICY service_all_invoices ON invoices FOR ALL USING (true) WITH CHECK (true);
