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
