-- 012_missed_call_status.sql
-- Adds 'missed' to calls.status so the Android app can log a lightweight,
-- audio-free entry when a call rings out unanswered (either direction) --
-- users want to know a call was missed even though there's nothing to
-- record/transcribe for it. See project_call_forwarding_and_recording_exclusion
-- memory for the full context.
-- Safe to run more than once (idempotent).

alter table calls drop constraint if exists calls_status_check;
alter table calls add constraint calls_status_check
  check (status = any (array['uploaded'::text, 'transcribing'::text, 'analyzing'::text,
                              'complete'::text, 'error'::text, 'missed'::text]));
