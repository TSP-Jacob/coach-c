-- uat_bootstrap.sql — full Coach-C schema for a FRESH Supabase project (UAT).
-- Run ONCE in the SQL editor of an EMPTY project (e.g. the Coach-C DB used
-- for UAT). Sections are ordered by dependency: leads (003) is created before
-- consents (002), which has a foreign key to leads. Safe building blocks use
-- IF NOT EXISTS; run it on an empty project to avoid policy re-create errors.

-- ==================== base schema (schema.sql) ====================
-- Coach-C Database Schema
-- Run this in your Supabase SQL editor

create extension if not exists vector;

-- ─── Brokerages ───────────────────────────────────────────────────────────────
create table brokerages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz default now()
);

-- ─── Agents (Realtors) ────────────────────────────────────────────────────────
create table agents (
  id            uuid primary key default gen_random_uuid(),
  brokerage_id  uuid references brokerages(id) on delete cascade,
  auth_user_id  uuid unique,
  name          text not null,
  email         text unique not null,
  avatar_url    text,
  created_at    timestamptz default now()
);

-- ─── Clients (per agent) ──────────────────────────────────────────────────────
create table clients (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  type        text check (type in ('buyer','seller','both')) default 'buyer',
  notes       text,
  updated_at  timestamptz default now(),
  created_at  timestamptz default now()
);

-- ─── Client Note Chunks (for RAG) ─────────────────────────────────────────────
create table client_note_chunks (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  content     text not null,
  embedding   vector(384),
  created_at  timestamptz default now()
);

create index on client_note_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─── Guidelines ───────────────────────────────────────────────────────────────
create table guidelines (
  id            uuid primary key default gen_random_uuid(),
  brokerage_id  uuid references brokerages(id) on delete cascade,
  call_type     text not null check (call_type in (
    'prospecting', 'buyer_consultation', 'seller_listing',
    'followup', 'negotiation', 'post_closing'
  )),
  version       integer default 1,
  content       jsonb not null,
  is_default    boolean default false,
  created_at    timestamptz default now()
);

-- ─── Calls ────────────────────────────────────────────────────────────────────
create table calls (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid references agents(id) on delete cascade,
  client_id        uuid references clients(id) on delete set null,
  call_date        timestamptz,
  duration_seconds integer,
  audio_url        text,
  status           text check (status in ('uploaded','transcribing','analyzing','complete','error')) default 'uploaded',
  call_type        text check (call_type in (
    'prospecting', 'buyer_consultation', 'seller_listing',
    'followup', 'negotiation', 'post_closing', 'unknown'
  )),
  transcript       jsonb,
  realtor_speaker  text,
  coaching_report  jsonb,
  overall_score    integer check (overall_score between 0 and 100),
  error_message    text,
  created_at       timestamptz default now()
);

-- ─── Chat Messages ────────────────────────────────────────────────────────────
create table chat_messages (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id) on delete cascade,
  role        text check (role in ('user','assistant')) not null,
  content     text not null,
  context     jsonb,
  created_at  timestamptz default now()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table brokerages        enable row level security;
alter table agents            enable row level security;
alter table clients           enable row level security;
alter table client_note_chunks enable row level security;
alter table guidelines        enable row level security;
alter table calls             enable row level security;
alter table chat_messages     enable row level security;

-- ─── Helper function: match client notes by embedding ─────────────────────────
create or replace function match_client_notes(
  query_embedding vector(384),
  match_agent_id  uuid,
  match_count     int default 5
)
returns table (
  id         uuid,
  client_id  uuid,
  content    text,
  similarity float
)
language sql stable
as $$
  select
    cnc.id,
    cnc.client_id,
    cnc.content,
    1 - (cnc.embedding <=> query_embedding) as similarity
  from client_note_chunks cnc
  join clients c on c.id = cnc.client_id
  where c.agent_id = match_agent_id
  order by cnc.embedding <=> query_embedding
  limit match_count;
$$;

-- ─── RLS Policies (prototype — open read, restrict writes to service role) ────
-- These are intentionally permissive for the prototype. Replace with
-- auth.uid()-based policies before production.

create policy "anon_read" on brokerages          for select using (true);
create policy "anon_read" on agents              for select using (true);
create policy "anon_read" on clients             for select using (true);
create policy "anon_read" on client_note_chunks  for select using (true);
create policy "anon_read" on guidelines          for select using (true);
create policy "anon_read" on calls               for select using (true);
create policy "anon_read" on chat_messages       for select using (true);

-- ─── Storage bucket for audio files ───────────────────────────────────────────
-- The backend seeder auto-creates this bucket on startup.
-- If it fails, create manually: Storage > New bucket > "call-recordings" (private)


-- ==================== 001 auth_user_id ====================
-- Add Supabase Auth user ID to agents table
-- Run this in the Supabase SQL editor before enabling authentication

alter table agents
  add column if not exists auth_user_id uuid unique;

-- Optional index for fast lookup by auth_user_id
create index if not exists agents_auth_user_id_idx on agents(auth_user_id);


-- ==================== 003 leads (before 002) ====================
-- Migration 003 — Create the leads table (was never created in production)
-- Run this in your Supabase SQL editor BEFORE re-running 002 (consents has a
-- foreign key to leads, so 002 fails if leads is missing).
--
-- Columns are derived from backend/app/routers/leads.py:
--   webhook insert -> name, phone, email, source, status, address, city,
--                     province, property_type, estimated_value, timeline_to_sell
--   PATCH update   -> status, agent_id, contact_method, contacted_at
--   list query     -> filters on source/status/agent_id, orders by created_at

CREATE TABLE IF NOT EXISTS leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID REFERENCES agents(id) ON DELETE SET NULL,  -- nullable = unassigned
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  source           TEXT NOT NULL DEFAULT 'home_value',  -- 'home_value' | 'call'
  status           TEXT NOT NULL DEFAULT 'new',          -- new | contacted | converted | lost
  address          TEXT,
  city             TEXT,
  province         TEXT,
  property_type    TEXT,
  estimated_value  NUMERIC,
  timeline_to_sell TEXT,
  contact_method   TEXT,
  contacted_at     TIMESTAMPTZ,
  call_id          UUID REFERENCES calls(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_source_idx   ON leads(source);
CREATE INDEX IF NOT EXISTS leads_agent_id_idx ON leads(agent_id);
CREATE INDEX IF NOT EXISTS leads_status_idx   ON leads(status);
CREATE INDEX IF NOT EXISTS leads_city_idx     ON leads(city);

-- All access is server-side via the service-role key (FastAPI backend), which
-- bypasses RLS. Enable RLS with permissive policies to mirror the consents table.
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"       ON leads FOR SELECT USING (true);
CREATE POLICY "service_insert"  ON leads FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update"  ON leads FOR UPDATE USING (true) WITH CHECK (true);


-- ==================== 002 consents + roles + org fields ====================
-- Migration 002 — Consent logging, Organization Profile fields, Agent roles
-- Run this in your Supabase SQL editor

-- ─── Roles on agents ─────────────────────────────────────────────────────────
-- Roles belong to the client portal account, not the profession.
-- "agent" (realtor) is a person, not a role — roles are admin/manager/employee.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'employee'
  CHECK (role IN ('admin', 'manager', 'employee'));

-- ─── Brokerage / Organization Profile fields ─────────────────────────────────
ALTER TABLE brokerages
  ADD COLUMN IF NOT EXISTS primary_contact TEXT,
  ADD COLUMN IF NOT EXISTS industry        TEXT,
  ADD COLUMN IF NOT EXISTS email           TEXT;

-- ─── Leads table (if not yet created) — referenced by consents ───────────────
-- Assumes leads table already exists (created by app startup or prior migration).

-- ─── Consents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES leads(id)   ON DELETE SET NULL,
  owner_name      TEXT,
  owner_email     TEXT,   -- homeowner's email
  owner_phone     TEXT,   -- homeowner's phone
  consent_text    TEXT NOT NULL,  -- full text of the consent message shown to homeowner
  sent_to_email   TEXT,           -- org email the consent log was sent to
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON consents FOR SELECT USING (true);
CREATE POLICY "service_insert" ON consents FOR INSERT WITH CHECK (true);


-- ==================== 004 billing ====================
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


-- ==================== 005 phone numbers + brokerage tagging ====================
-- Migration 005 — Org-level phone numbers + org tagging for inbound call routing
--
-- Adds a phone_numbers table so an admin can map a (Twilio) number to an
-- organization (brokerage). Inbound calls on that number are recorded, coached,
-- and their resulting call/lead/client rows are tagged with the org via
-- brokerage_id so they show up under that organization in the portal.
--
-- phone_numbers is touched only by the FastAPI backend (service-role key, which
-- bypasses RLS), so RLS is enabled with NO policies = no anon/auth access.

CREATE TABLE IF NOT EXISTS phone_numbers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       TEXT NOT NULL UNIQUE,            -- normalized last-10 digits of the dialed number
  brokerage_id UUID NOT NULL REFERENCES brokerages(id) ON DELETE CASCADE,
  agent_id     UUID REFERENCES agents(id) ON DELETE SET NULL,  -- org's inbound "owner" agent
  label        TEXT,
  provider     TEXT NOT NULL DEFAULT 'twilio',
  forward_to   TEXT,                            -- real line to bridge + record; NULL = voicemail capture
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phone_numbers_brokerage_idx ON phone_numbers(brokerage_id);
CREATE INDEX IF NOT EXISTS phone_numbers_number_idx    ON phone_numbers(number);

-- Tag inbound-routed rows with their organization.
ALTER TABLE calls   ADD COLUMN IF NOT EXISTS brokerage_id UUID REFERENCES brokerages(id) ON DELETE SET NULL;
ALTER TABLE leads   ADD COLUMN IF NOT EXISTS brokerage_id UUID REFERENCES brokerages(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brokerage_id UUID REFERENCES brokerages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS calls_brokerage_idx   ON calls(brokerage_id);
CREATE INDEX IF NOT EXISTS leads_brokerage_idx   ON leads(brokerage_id);
CREATE INDEX IF NOT EXISTS clients_brokerage_idx ON clients(brokerage_id);

ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only the service-role backend reads/writes this table.


-- ==================== 006 notes + client fields ====================
-- 006_notes_and_client_fields.sql
-- Reconcile the live DB with UI sections that were shipped without schema:
--   • Notes page + per-client notes + the voice assistant's search_notes /
--     get_client_history tools all expect a `notes` table that never existed.
--   • The Clients page edits a status pill and a location, but clients has no
--     client_status / location columns.
-- Safe to run more than once (idempotent).

-- ── Notes ─────────────────────────────────────────────────────────────────────
create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id)  on delete cascade,
  client_id   uuid references clients(id) on delete set null,
  content     text not null,
  created_at  timestamptz default now()
);

-- Look-ups are by agent (and optionally client), newest first.
create index if not exists notes_agent_created_idx on notes (agent_id, created_at desc);
create index if not exists notes_client_idx        on notes (client_id);

-- Match the RLS posture of the other tables. The backend uses the service-role
-- key (which bypasses RLS); this policy just mirrors the existing pattern.
alter table notes enable row level security;
drop policy if exists "anon_read" on notes;
create policy "anon_read" on notes for select using (true);

-- ── Client fields the Clients UI edits ────────────────────────────────────────
alter table clients add column if not exists client_status text default 'Lead';
alter table clients add column if not exists location      text;


-- ==================== 007 performance indexes ====================
-- 007_performance_indexes.sql
-- Scale insurance: the assistant tools and list endpoints filter by agent_id and
-- sort by date, but calls/clients/chat_messages were only indexed on brokerage_id
-- (or not at all). Without these, those queries do sequential scans that get
-- slower as rows accumulate. All idempotent; safe to run anytime.
--
-- Tables are small today, so a plain CREATE INDEX is instant. If any table has
-- grown large before you run this, use CREATE INDEX CONCURRENTLY instead (it
-- can't run inside a transaction block, so run each statement on its own).

-- ── calls: filtered by agent_id, often with status, ordered by date ──
create index if not exists calls_agent_created_idx   on calls (agent_id, created_at desc);
create index if not exists calls_agent_call_date_idx on calls (agent_id, call_date desc);
create index if not exists calls_client_idx          on calls (client_id);

-- ── clients: listed and name-searched per agent ──
create index if not exists clients_agent_idx on clients (agent_id);

-- ── chat_messages: rolling per-agent history (load + prune by agent_id, date) ──
create index if not exists chat_messages_agent_created_idx on chat_messages (agent_id, created_at desc);
