-- Per-trigger Telegram silence.
--
-- By default every trigger-fired turn mirrors to the agent's Telegram topic
-- (v1 step-2 decision: heartbeats always mirror). Setting this to 1 runs the
-- turn normally but suppresses the outbound mirror + typing indicator — for
-- routine heartbeats whose output you don't want flooding the topic.
--
-- Enforced in lib/scheduler.ts (passes { mirror: !silent } to runAgentTurn).
-- Errors/fatals are unaffected by mirror suppression at the run level — a
-- silent trigger simply doesn't open the mirror for that turn at all.

ALTER TABLE agent_triggers
  ADD COLUMN silent_in_telegram INTEGER NOT NULL DEFAULT 0;
