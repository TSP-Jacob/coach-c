-- Add Supabase Auth user ID to agents table
-- Run this in the Supabase SQL editor before enabling authentication

alter table agents
  add column if not exists auth_user_id uuid unique;

-- Optional index for fast lookup by auth_user_id
create index if not exists agents_auth_user_id_idx on agents(auth_user_id);
