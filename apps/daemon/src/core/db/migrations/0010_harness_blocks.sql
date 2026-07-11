CREATE TABLE harness_block_events (
  id TEXT PRIMARY KEY,
  attempt_kind TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  source_group_id TEXT,
  target_group_id TEXT,
  channel TEXT NOT NULL,
  origin TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_refs_json TEXT NOT NULL,
  component_outcomes_json TEXT NOT NULL,
  matched_edge_ids_json TEXT NOT NULL,
  required_edge_ids_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (attempt_kind, attempt_id)
);
CREATE INDEX harness_blocks_group_time
  ON harness_block_events(source_group_id, target_group_id, created_at DESC, id DESC);

ALTER TABLE messages ADD COLUMN policy_disposition TEXT NOT NULL DEFAULT 'deliverable'
  CHECK (policy_disposition IN ('deliverable', 'policy_blocked'));
ALTER TABLE messages ADD COLUMN policy_blocked_at INTEGER;
