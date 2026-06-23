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
