-- Run this in Supabase SQL editor if you already ran schema.sql.
-- Adds open-read RLS policies so the frontend anon key can subscribe via Realtime.
-- Replace with auth.uid()-based policies before production.

create policy "anon_read" on brokerages          for select using (true);
create policy "anon_read" on agents              for select using (true);
create policy "anon_read" on clients             for select using (true);
create policy "anon_read" on client_note_chunks  for select using (true);
create policy "anon_read" on guidelines          for select using (true);
create policy "anon_read" on calls               for select using (true);
create policy "anon_read" on chat_messages       for select using (true);
