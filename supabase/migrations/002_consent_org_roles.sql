-- Migration 002 — Consent logging, Organization Profile fields, Agent roles
-- Run this in your Supabase SQL editor

-- ─── Agent roles ─────────────────────────────────────────────────────────────
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'agent'
  CHECK (role IN ('admin', 'manager', 'agent'));

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
