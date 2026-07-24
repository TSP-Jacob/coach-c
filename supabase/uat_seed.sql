-- uat_seed.sql — minimal sample data for a UAT database.
--
-- WHY IT'S PARAMETERIZED: logging in requires a Supabase Auth user, which is
-- created by SIGNING UP on the UAT site — not by SQL. So the flow is:
--   1. Sign up a test account on the UAT frontend. The backend auto-creates a
--      matching row in `agents` for that user.
--   2. In the Supabase SQL editor, find that agent's id:
--        select id, email from agents order by created_at desc;
--   3. Paste it into AGENT_ID below and run this script.
--
-- It seeds two clients (one recent, one older "Guillaume" to mirror the call-
-- history test), a couple of completed calls, and a note — enough to exercise
-- the voice assistant's recent-vs-older lookups.

do $$
declare
  a           uuid := 'AGENT_ID';   -- <-- REPLACE with your test agent id
  c_guillaume uuid;
  c_tremblay  uuid;
begin
  if a = 'AGENT_ID' then
    raise exception 'Set AGENT_ID to your test agent id first (select id from agents).';
  end if;

  insert into clients (agent_id, name, type) values (a, 'Guillaume', 'buyer')  returning id into c_guillaume;
  insert into clients (agent_id, name, type) values (a, 'Alex Tremblay', 'seller') returning id into c_tremblay;

  -- An OLDER call (April) — should only be found by searching the full history.
  insert into calls (agent_id, client_id, call_date, call_type, status, overall_score, coaching_report)
  values (a, c_guillaume, timestamptz '2026-04-21 15:00', 'negotiation', 'complete', 62,
    '{"summary":"Negotiation with Guillaume about the gap between offer prices.","priority_focus":"Present an alternative scenario before every negotiation."}'::jsonb);

  -- A RECENT call — appears in the pre-loaded digest.
  insert into calls (agent_id, client_id, call_date, call_type, status, overall_score, coaching_report)
  values (a, c_tremblay, now() - interval '3 days', 'seller_listing', 'complete', 78,
    '{"summary":"Listing consultation with Alex Tremblay; discussed pricing strategy and timeline."}'::jsonb);

  insert into notes (agent_id, client_id, content)
  values (a, c_guillaume, 'Prefers email contact. Budget around 450k. Wants to close before September.');
end $$;
