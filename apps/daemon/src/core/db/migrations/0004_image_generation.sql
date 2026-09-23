-- BAZ-059: narrow, non-replayable image-provider operations, not a job queue.
-- The initial outcome is uncertain: intent commits before the potentially billable request.
CREATE TABLE image_generations (
  agent_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  model TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('uncertain', 'completed', 'failed')),
  response_id TEXT,
  usage_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, session_id, tool_call_id)
);
CREATE INDEX image_generations_turn ON image_generations(turn_id);

ALTER TABLE agent_results ADD COLUMN source_index INTEGER NOT NULL DEFAULT 0
  CHECK (source_index BETWEEN 0 AND 3);
ALTER TABLE agent_results ADD COLUMN image_model TEXT;
DROP INDEX agent_results_session_source;
CREATE UNIQUE INDEX agent_results_session_source
  ON agent_results(agent_id, session_id, tool_call_id, source_index)
  WHERE source_kind = 'session_tool';
