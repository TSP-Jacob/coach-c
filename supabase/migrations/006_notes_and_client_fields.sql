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
