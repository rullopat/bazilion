-- 0.63.0: commands an Agent may run without asking (BAZ-086).
CREATE TABLE command_rules (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL CHECK (length(trim(prefix)) > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, prefix)
);
