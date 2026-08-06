-- Migration 015 — per-agent language preference, so the UI and AI-generated
-- content (coaching reports, call summaries, dashboard insights, the
-- assistant) can be shown in French for francophone employees/orgs (e.g.
-- Air Santé, Québec). Saved on the agent (not the org) so it follows the
-- person across devices, since different employees at the same org may want
-- different languages.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
