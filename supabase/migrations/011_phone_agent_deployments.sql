-- 011_phone_agent_deployments.sql
-- Registers each org's AI phone-agent deployment (e.g. Air Santé's Twilio+Gemini
-- bridge on Railway) so Coach-C can show it in the onboarding/setup checklist —
-- previously Coach-C had zero visibility into these; they were pure Railway env
-- vars on a service Coach-C couldn't see. See project_air_sante_call_pipeline
-- memory for the pipeline this supports.
-- Safe to run more than once (idempotent).

create table if not exists phone_agent_deployments (
  id            uuid primary key default gen_random_uuid(),
  brokerage_id  uuid references brokerages(id) on delete cascade,
  agent_id      uuid references agents(id) on delete set null,
  name          text not null,
  base_url      text not null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists phone_agent_deployments_brokerage_idx on phone_agent_deployments (brokerage_id);

alter table phone_agent_deployments enable row level security;
drop policy if exists "anon_read" on phone_agent_deployments;
create policy "anon_read" on phone_agent_deployments for select using (true);
