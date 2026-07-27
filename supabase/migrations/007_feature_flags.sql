-- 007_feature_flags.sql
-- Per-user feature toggles, configured by admins on the Team page.
-- Each agent stores an override map like {"call_coaching": true}; any key not
-- present falls back to the code defaults in backend/app/routers/agents.py
-- (FEATURE_DEFAULTS). Notably, call_coaching defaults OFF — call scoring/
-- coaching is opt-in per user.
-- Safe to run more than once (idempotent).

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;
