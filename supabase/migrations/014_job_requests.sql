-- Migration 014 — job detail on leads, so a lead can represent a "new job"
-- (home-services orgs show this section as "New Jobs" — see frontend/lib/industry.ts)
-- rather than only a real-estate-shaped prospect record.
--
-- client_id  — links a lead to an EXISTING client. Previously leads only ever
--              represented a brand-new prospect (no client link); now an
--              existing client calling about another job, or the assistant
--              logging a job for an existing client, can be linked directly.
-- job_date        — the date the caller/user wants the job done (nullable —
--                    calls where no date was mentioned, or home_value leads,
--                    leave this unset).
-- job_description — short free-text description of the work requested.
--
-- source gains a new value 'assistant' (leads created via the voice/text
-- assistant's create_job tool) alongside the existing 'call' | 'home_value'.
-- No CHECK constraint exists on source, so no migration is needed for that.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_date DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_description TEXT;

CREATE INDEX IF NOT EXISTS leads_client_id_idx ON leads(client_id);
