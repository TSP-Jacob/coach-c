-- 010_tasks.sql
-- Manager-assigned tasks. A manager/admin creates a task (voice is the
-- default way, via the assistant's create_task tool, with a manual form as
-- a fallback) and assigns it to a teammate; the teammate sees it in their
-- Tasks list and advances its status. Managers get an overview grouped by
-- employee.
-- Safe to run more than once (idempotent).

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  brokerage_id  uuid references brokerages(id) on delete cascade,
  assigned_to   uuid references agents(id) on delete cascade,
  created_by    uuid references agents(id) on delete set null,
  title         text not null,
  description   text,
  status        text not null default 'pending' check (status in ('pending','in_progress','done')),
  due_date      date,
  completed_at  timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists tasks_assigned_to_idx  on tasks (assigned_to);
create index if not exists tasks_brokerage_id_idx on tasks (brokerage_id);
create index if not exists tasks_status_idx       on tasks (status);

-- All access is server-side via the service-role key (FastAPI backend),
-- which bypasses RLS. Enable RLS with a permissive read policy to mirror
-- the pattern used by notes/leads.
alter table tasks enable row level security;
drop policy if exists "anon_read" on tasks;
create policy "anon_read" on tasks for select using (true);
