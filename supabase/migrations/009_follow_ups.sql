-- 009_follow_ups.sql
-- Follow-ups: a single scheduled follow-up date per client, surfaced in its
-- own "Follow-Ups" sidebar section. Setting a date puts the client in that
-- list for the week containing the date; clearing it (marking the follow-up
-- complete) removes them until a new date is set.
-- Safe to run more than once (idempotent).

alter table clients add column if not exists follow_up_date date;
alter table clients add column if not exists follow_up_note text;

create index if not exists clients_follow_up_date_idx on clients (follow_up_date);
