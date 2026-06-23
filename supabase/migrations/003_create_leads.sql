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
