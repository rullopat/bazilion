-- Per-agent-topic Telegram behavior overrides (Phase 8).
--
-- Keyed on agent (not topic id) so an override survives topic delete+recreate.
-- All knobs apply to plain-text chat in the agent's bound topic:
--   require_mention — only respond when the bot is @-mentioned or replied-to.
--   allow_from      — JSON array of Telegram user ids; INTERSECTS the global
--                     Phase-7 allowlist (can only narrow, never widen). Empty/
--                     NULL means "no per-topic narrowing".
--   silent          — suppress the outbound mirror for this topic.
--
-- Topic-context commands (/close, /rebind, /unbind) stay governed by the
-- global ACL — these knobs gate chat only.

CREATE TABLE IF NOT EXISTS agent_telegram_overrides (
  agent_id        TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  require_mention INTEGER NOT NULL DEFAULT 0,
  allow_from      TEXT,
  silent          INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER
);
