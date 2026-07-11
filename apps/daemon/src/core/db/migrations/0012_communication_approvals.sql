ALTER TABLE harness_template_edges
  ADD COLUMN posture TEXT NOT NULL DEFAULT 'allow'
  CHECK (posture IN ('allow', 'approval_required'));

ALTER TABLE harness_template_revision_edges
  ADD COLUMN posture TEXT NOT NULL DEFAULT 'allow'
  CHECK (posture IN ('allow', 'approval_required'));

ALTER TABLE live_harness_edges
  ADD COLUMN posture TEXT NOT NULL DEFAULT 'allow'
  CHECK (posture IN ('allow', 'approval_required'));

CREATE TABLE communication_approvals (
  id TEXT PRIMARY KEY,
  attempt_kind TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  operation TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  source_group_id TEXT,
  target_group_id TEXT,
  channel TEXT NOT NULL,
  origin TEXT NOT NULL,
  requester TEXT NOT NULL,
  policy_refs_json TEXT NOT NULL,
  required_edge_ids_json TEXT NOT NULL,
  payload_kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN (
      'pending', 'approved', 'denied', 'expired', 'cancelled',
      'delivering', 'delivered', 'delivery_failed'
    )),
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  decision_reason TEXT,
  delivery_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(attempt_kind, attempt_id)
);

CREATE INDEX communication_approvals_queue
  ON communication_approvals(status, expires_at, created_at DESC);
CREATE INDEX communication_approvals_groups
  ON communication_approvals(source_group_id, target_group_id, created_at DESC);

CREATE TABLE communication_approval_events (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES communication_approvals(id) ON DELETE CASCADE,
  event TEXT NOT NULL
    CHECK (event IN (
      'requested', 'approved', 'denied', 'expired', 'cancelled',
      'delivery_started', 'delivered', 'delivery_failed'
    )),
  actor TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX communication_approval_events_attempt
  ON communication_approval_events(approval_id, created_at ASC);

CREATE TABLE communication_approval_message_grants (
  approval_id TEXT PRIMARY KEY REFERENCES communication_approvals(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
