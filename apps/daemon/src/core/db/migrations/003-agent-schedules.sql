-- 0.64.0: schedules an Agent sets itself (BAZ-089). A one-time kind with its time, the
-- conversation a schedule runs in, and who set it. SQLite cannot change a CHECK in place, so the
-- table is copied; every schedule keeps its id, and so its runs in trigger_dispatches.
CREATE TABLE agent_triggers_new (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('interval','cron','once')),
  interval_sec INTEGER,
  cron_expr TEXT,
  -- kind 'once': when it runs.
  run_at INTEGER,
  message TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_at INTEGER,
  created_at INTEGER NOT NULL,
  -- The conversation it runs in; null means the Agent's selected one.
  conversation_id TEXT,
  -- Who set it: the owner, or the Agent itself (schedule_add).
  set_by TEXT NOT NULL DEFAULT 'owner' CHECK (set_by IN ('owner','agent'))
);
INSERT INTO agent_triggers_new
  (id, agent_id, kind, interval_sec, cron_expr, message, enabled, last_fired_at, created_at)
  SELECT id, agent_id, kind, interval_sec, cron_expr, message, enabled, last_fired_at, created_at
  FROM agent_triggers;
DROP TABLE agent_triggers;
ALTER TABLE agent_triggers_new RENAME TO agent_triggers;
CREATE INDEX agent_triggers_agent ON agent_triggers(agent_id);
CREATE INDEX agent_triggers_enabled ON agent_triggers(enabled) WHERE enabled = 1;
