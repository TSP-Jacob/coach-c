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
