-- Canonical schema baseline (migration 0001). Later schema changes are appended as numbered
-- forward migrations in this directory; startup applies pending migrations in place (BAZ-047).
CREATE TABLE IF NOT EXISTS "teams" (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  user_md     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
, telegram_icon_color INTEGER, telegram_topic_name_format TEXT);
CREATE TABLE profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  dir           TEXT NOT NULL,
  default_model TEXT NOT NULL,
  skills_mode   TEXT NOT NULL DEFAULT 'selected' CHECK (skills_mode IN ('all','selected')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
, telegram_icon_emoji TEXT);
CREATE TABLE profile_default_skills (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_name  TEXT NOT NULL,
  PRIMARY KEY (profile_id, skill_name)
);
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES profiles(id),
  name            TEXT NOT NULL,
  model_override  TEXT,
  status          TEXT NOT NULL CHECK (status IN ('idle','running','archived')),
  dir             TEXT NOT NULL,
  reasoning_level TEXT NOT NULL DEFAULT 'medium',
  review_enabled INTEGER NOT NULL DEFAULT 0 CHECK (review_enabled IN (0, 1)),
  review_every_n_turns INTEGER NOT NULL DEFAULT 8
    CHECK (review_every_n_turns BETWEEN 1 AND 100),
  review_model TEXT,
  review_reasoning_level TEXT NOT NULL DEFAULT 'low'
    CHECK (review_reasoning_level IN ('off','minimal','low','medium','high','xhigh')),
  review_turns_since_last INTEGER NOT NULL DEFAULT 0 CHECK (review_turns_since_last >= 0),
  team_id        TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  created_at      INTEGER NOT NULL,
  archived_at     INTEGER
, telegram_topic_id INTEGER, telegram_binding_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))), telegram_topic_name_locked INTEGER NOT NULL DEFAULT 0, telegram_icon_emoji TEXT, telegram_mirror_mode TEXT NOT NULL DEFAULT 'minimal'
  CHECK (telegram_mirror_mode IN ('minimal','verbose')));
CREATE TABLE agent_skills (
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_name  TEXT NOT NULL,
  attached_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, skill_name)
);
CREATE TABLE agent_triggers (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('interval','cron')),
  interval_sec   INTEGER,
  cron_expr      TEXT,
  message        TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_fired_at  INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX agent_triggers_agent ON agent_triggers(agent_id);
CREATE INDEX agent_triggers_enabled ON agent_triggers(enabled) WHERE enabled = 1;
CREATE TABLE trigger_dispatches (
  id              TEXT PRIMARY KEY,
  trigger_id      TEXT NOT NULL REFERENCES agent_triggers(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  scheduled_at    INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','retrying','succeeded','failed','cancelled')),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_expires_at INTEGER,
  started_at      INTEGER,
  finished_at     INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (trigger_id, scheduled_at),
  FOREIGN KEY (agent_id, conversation_id) REFERENCES agent_conversations(agent_id, id)
);
CREATE INDEX trigger_dispatches_claimable
  ON trigger_dispatches(status, next_attempt_at, scheduled_at);
CREATE INDEX trigger_dispatches_trigger_time
  ON trigger_dispatches(trigger_id, scheduled_at DESC);
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL REFERENCES agents(id),
  to_agent_id   TEXT NOT NULL REFERENCES agents(id),
  reply_to      TEXT REFERENCES messages(id),
  causal_chain_id TEXT NOT NULL,
  causal_hop    INTEGER NOT NULL DEFAULT 0 CHECK (causal_hop >= 0),
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER,
  conversation_id TEXT
, policy_disposition TEXT NOT NULL DEFAULT 'deliverable'
  CHECK (policy_disposition IN ('deliverable', 'policy_blocked')), policy_blocked_at INTEGER, policy_claimed_at INTEGER, policy_delivered_at INTEGER);
CREATE INDEX messages_to_unread ON messages(to_agent_id) WHERE read_at IS NULL;
CREATE INDEX messages_causal_chain ON messages(causal_chain_id, causal_hop);
CREATE TABLE agent_loop_break_events (
  id                TEXT PRIMARY KEY,
  causal_chain_id   TEXT NOT NULL,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  from_agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  target_team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  attempted_hop     INTEGER NOT NULL CHECK (attempted_hop >= 0),
  max_hops          INTEGER NOT NULL CHECK (max_hops >= 0),
  reason            TEXT NOT NULL,
  origin            TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE INDEX agent_loop_break_events_agent_time
  ON agent_loop_break_events(from_agent_id, to_agent_id, created_at DESC);
CREATE INDEX agent_loop_break_events_team_time
  ON agent_loop_break_events(source_team_id, target_team_id, created_at DESC);
CREATE TABLE attention_acknowledgements (
  source_kind    TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  PRIMARY KEY (source_kind, source_id)
);
CREATE TABLE agent_reviews (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status                TEXT NOT NULL
    CHECK (status IN ('pending','running','retrying','completed','failed','cancelled')),
  trigger_kind          TEXT NOT NULL CHECK (trigger_kind IN ('cadence','manual')),
  source_session_id     TEXT,
  source_start_ordinal  INTEGER CHECK (source_start_ordinal IS NULL OR source_start_ordinal >= 0),
  source_end_ordinal    INTEGER CHECK (source_end_ordinal IS NULL OR source_end_ordinal >= 0),
  input_characters      INTEGER NOT NULL DEFAULT 0 CHECK (input_characters >= 0),
  turns_reviewed        INTEGER NOT NULL DEFAULT 0 CHECK (turns_reviewed >= 0),
  proposal_count        INTEGER NOT NULL DEFAULT 0 CHECK (proposal_count BETWEEN 0 AND 5),
  attempt_count         INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at       INTEGER NOT NULL,
  lease_expires_at      INTEGER,
  started_at            INTEGER,
  finished_at           INTEGER,
  last_error            TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE UNIQUE INDEX agent_reviews_one_open_per_agent
  ON agent_reviews(agent_id)
  WHERE status IN ('pending','running','retrying');
CREATE INDEX agent_reviews_claimable
  ON agent_reviews(status, next_attempt_at, created_at);
CREATE INDEX agent_reviews_agent_time
  ON agent_reviews(agent_id, created_at DESC);
CREATE TABLE agent_lesson_proposals (
  id                TEXT PRIMARY KEY,
  review_id         TEXT NOT NULL REFERENCES agent_reviews(id) ON DELETE CASCADE,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scope             TEXT NOT NULL CHECK (scope IN ('private','shared')),
  text              TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  evidence_json     TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked')),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  decided_at        INTEGER,
  revoked_at        INTEGER,
  applied_key       TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX agent_lesson_proposals_agent_status_time
  ON agent_lesson_proposals(agent_id, status, created_at DESC);
CREATE INDEX agent_lesson_proposals_review
  ON agent_lesson_proposals(review_id, created_at ASC);
CREATE TABLE skill_meta (
  name         TEXT PRIMARY KEY,
  source       TEXT,
  imported_at  INTEGER
);
CREATE TABLE web_tokens (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('bootstrap','device')),
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  expires_at    INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX web_tokens_active ON web_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE TABLE web_sessions (
  id                   TEXT PRIMARY KEY,
  secret_hash          TEXT NOT NULL UNIQUE,
  csrf_hash            TEXT NOT NULL,
  device_token_id      TEXT NOT NULL REFERENCES web_tokens(id) ON DELETE CASCADE,
  created_at           INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL,
  idle_expires_at      INTEGER NOT NULL,
  absolute_expires_at  INTEGER NOT NULL,
  revoked_at           INTEGER
);
CREATE INDEX web_sessions_active ON web_sessions(id) WHERE revoked_at IS NULL;
CREATE INDEX web_sessions_device ON web_sessions(device_token_id, created_at DESC);
CREATE TABLE provider_models (
  provider   TEXT    NOT NULL,
  model      TEXT    NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (provider, model)
);
CREATE INDEX idx_provider_models_provider ON provider_models (provider);
CREATE TABLE provider_state (
  provider_id TEXT    NOT NULL PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE secrets (
  key         TEXT PRIMARY KEY,
  envelope    TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_agents_telegram_topic_id
  ON agents(telegram_topic_id)
  WHERE telegram_topic_id IS NOT NULL;
CREATE TABLE telegram_allowed_users (
  user_id   INTEGER PRIMARY KEY,
  grant_id  TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  username  TEXT,
  label     TEXT,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  added_at  INTEGER NOT NULL
);
CREATE TABLE telegram_pairing_challenge (
  singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
  digest     TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  transport   TEXT NOT NULL CHECK (transport IN ('stdio','http','sse')),
  command     TEXT,
  args        TEXT NOT NULL DEFAULT '[]',
  url         TEXT,
  has_auth    INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "team_templates" (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  user_md               TEXT,
  current_revision      INTEGER NOT NULL CHECK (current_revision >= 1),
  deleted_at            INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "team_template_slots" (
  template_id    TEXT NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
  slot_id        TEXT NOT NULL,
  position       INTEGER NOT NULL CHECK (position >= 0),
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name     TEXT NOT NULL,
  model_override TEXT,
  reasoning_level TEXT CHECK (reasoning_level IS NULL OR reasoning_level IN ('off','minimal','low','medium','high','xhigh')),
  position_x     REAL,
  position_y     REAL,
  display_json   TEXT,
  tombstoned_at  INTEGER,
  PRIMARY KEY (template_id, slot_id)
);
CREATE TABLE IF NOT EXISTS "team_template_revisions" (
  template_id TEXT NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  name        TEXT NOT NULL,
  user_md     TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (template_id, revision)
);
CREATE TABLE IF NOT EXISTS "team_template_revision_slots" (
  template_id     TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  slot_id         TEXT NOT NULL,
  position        INTEGER NOT NULL CHECK (position >= 0),
  profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name      TEXT NOT NULL,
  model_override  TEXT,
  reasoning_level TEXT CHECK (reasoning_level IS NULL OR reasoning_level IN ('off','minimal','low','medium','high','xhigh')),
  position_x      REAL,
  position_y      REAL,
  display_json    TEXT,
  PRIMARY KEY (template_id, revision, slot_id),
  UNIQUE (template_id, revision, position),
  FOREIGN KEY (template_id, revision)
    REFERENCES team_template_revisions(template_id, revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "team_policies" (
  team_id                  TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  revision                  INTEGER NOT NULL CHECK (revision >= 1),
  baseline_instantiation_id TEXT REFERENCES template_instantiations(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  updated_at                INTEGER NOT NULL
);
CREATE TABLE template_instantiations (
  id                TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES team_policies(team_id) ON DELETE CASCADE,
  template_id       TEXT NOT NULL,
  template_revision INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (template_id, template_revision)
    REFERENCES team_template_revisions(template_id, revision) ON DELETE RESTRICT
);
CREATE TABLE source_slot_bindings (
  agent_id        TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  instantiation_id TEXT NOT NULL REFERENCES template_instantiations(id) ON DELETE CASCADE,
  source_slot_id   TEXT NOT NULL,
  UNIQUE (instantiation_id, source_slot_id)
);
CREATE TABLE IF NOT EXISTS "team_agent_state" (
  agent_id      TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  team_id      TEXT NOT NULL REFERENCES team_policies(team_id) ON DELETE CASCADE,
  position_x    REAL,
  position_y    REAL,
  display_json  TEXT,
  CHECK ((position_x IS NULL) = (position_y IS NULL))
);
CREATE TABLE IF NOT EXISTS "team_policy_block_events" (
  id TEXT PRIMARY KEY,
  attempt_kind TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  source_team_id TEXT,
  target_team_id TEXT,
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
CREATE INDEX messages_policy_delivery_queue
  ON messages(to_agent_id, policy_disposition, read_at, policy_claimed_at, created_at);
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
  source_team_id TEXT,
  target_team_id TEXT,
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
CREATE TABLE profile_communication_defaults (
  profile_id           TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  user_input           INTEGER NOT NULL CHECK (user_input IN (0, 1)),
  user_output          INTEGER NOT NULL CHECK (user_output IN (0, 1)),
  outside_team_input   INTEGER NOT NULL CHECK (outside_team_input IN (0, 1)),
  outside_team_output  INTEGER NOT NULL CHECK (outside_team_output IN (0, 1)),
  peer_default         TEXT NOT NULL CHECK (peer_default IN ('inherit_team_policy','allow_all','deny_all')),
  updated_at           INTEGER NOT NULL
);
CREATE TABLE team_template_edges (
  template_id TEXT NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','outside_team','slot')),
  source_id   TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL CHECK (target_kind IN ('user','outside_team','slot')),
  target_id   TEXT NOT NULL DEFAULT '',
  posture     TEXT NOT NULL DEFAULT 'allow' CHECK (posture IN ('allow','approval_required')),
  CHECK ((source_kind = 'slot') = (length(source_id) > 0)),
  CHECK ((target_kind = 'slot') = (length(target_id) > 0)),
  CHECK (source_kind = 'slot' OR target_kind = 'slot'),
  CHECK (source_kind != target_kind OR source_id != target_id),
  PRIMARY KEY (template_id, source_kind, source_id, target_kind, target_id)
);
CREATE TABLE team_template_revision_edges (
  template_id TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','outside_team','slot')),
  source_id   TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL CHECK (target_kind IN ('user','outside_team','slot')),
  target_id   TEXT NOT NULL DEFAULT '',
  posture     TEXT NOT NULL DEFAULT 'allow' CHECK (posture IN ('allow','approval_required')),
  CHECK ((source_kind = 'slot') = (length(source_id) > 0)),
  CHECK ((target_kind = 'slot') = (length(target_id) > 0)),
  CHECK (source_kind = 'slot' OR target_kind = 'slot'),
  CHECK (source_kind != target_kind OR source_id != target_id),
  PRIMARY KEY (template_id, revision, source_kind, source_id, target_kind, target_id),
  FOREIGN KEY (template_id, revision)
    REFERENCES team_template_revisions(template_id, revision) ON DELETE CASCADE
);
CREATE TABLE team_policy_edges (
  team_id     TEXT NOT NULL REFERENCES team_policies(team_id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','outside_team','agent')),
  source_id   TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL CHECK (target_kind IN ('user','outside_team','agent')),
  target_id   TEXT NOT NULL DEFAULT '',
  posture     TEXT NOT NULL DEFAULT 'allow' CHECK (posture IN ('allow','approval_required')),
  CHECK ((source_kind = 'agent') = (length(source_id) > 0)),
  CHECK ((target_kind = 'agent') = (length(target_id) > 0)),
  CHECK (source_kind = 'agent' OR target_kind = 'agent'),
  CHECK (source_kind != target_kind OR source_id != target_id),
  PRIMARY KEY (team_id, source_kind, source_id, target_kind, target_id)
);
CREATE UNIQUE INDEX team_template_active_position
  ON team_template_slots(template_id, position) WHERE tombstoned_at IS NULL;
CREATE UNIQUE INDEX team_policy_baseline_owner
  ON team_policies(baseline_instantiation_id) WHERE baseline_instantiation_id IS NOT NULL;
CREATE INDEX team_policy_blocks_team_time
  ON team_policy_block_events(source_team_id, target_team_id, created_at DESC, id DESC);
CREATE INDEX communication_approvals_teams
  ON communication_approvals(source_team_id, target_team_id, created_at DESC);
CREATE TRIGGER create_team_policy
AFTER INSERT ON teams
BEGIN
  INSERT INTO team_policies
    (team_id, revision, baseline_instantiation_id, updated_at)
  VALUES (NEW.id, 1, NULL, NEW.created_at);
END;
CREATE TRIGGER prevent_detached_team_policy_delete
BEFORE DELETE ON team_policies
WHEN EXISTS (SELECT 1 FROM teams t WHERE t.id = OLD.team_id)
BEGIN
  SELECT RAISE(ABORT, 'Team policy cannot be deleted independently of its Team');
END;
CREATE TRIGGER validate_team_template_edge_insert
BEFORE INSERT ON team_template_edges
WHEN (NEW.source_kind = 'slot' AND NOT EXISTS (
        SELECT 1 FROM team_template_slots s
        WHERE s.template_id = NEW.template_id AND s.slot_id = NEW.source_id
          AND s.tombstoned_at IS NULL
      ))
  OR (NEW.target_kind = 'slot' AND NOT EXISTS (
        SELECT 1 FROM team_template_slots s
        WHERE s.template_id = NEW.template_id AND s.slot_id = NEW.target_id
          AND s.tombstoned_at IS NULL
      ))
BEGIN
  SELECT RAISE(ABORT, 'Team Template edge endpoint is not an active slot');
END;
CREATE TRIGGER validate_team_policy_edge_insert
BEFORE INSERT ON team_policy_edges
WHEN (NEW.source_kind = 'agent' AND NOT EXISTS (
        SELECT 1 FROM agents a WHERE a.id = NEW.source_id AND a.team_id = NEW.team_id
      ))
  OR (NEW.target_kind = 'agent' AND NOT EXISTS (
        SELECT 1 FROM agents a WHERE a.id = NEW.target_id AND a.team_id = NEW.team_id
      ))
BEGIN
  SELECT RAISE(ABORT, 'Team policy edge endpoint is not a Team member');
END;
CREATE TRIGGER validate_source_binding_insert
BEFORE INSERT ON source_slot_bindings
WHEN NOT EXISTS (
  SELECT 1
  FROM template_instantiations i
  JOIN team_template_revision_slots s
    ON s.template_id = i.template_id
   AND s.revision = i.template_revision
   AND s.slot_id = NEW.source_slot_id
  JOIN agents a ON a.id = NEW.agent_id AND a.team_id = i.team_id
  WHERE i.id = NEW.instantiation_id
)
BEGIN
  SELECT RAISE(ABORT, 'source binding does not match retained revision or Team membership');
END;
CREATE TRIGGER validate_team_agent_state_insert
BEFORE INSERT ON team_agent_state
WHEN NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.id = NEW.agent_id AND a.team_id = NEW.team_id
)
BEGIN
  SELECT RAISE(ABORT, 'Team Agent state does not match agents.team_id');
END;
-- Captured bytes and their publication receipt share one atomic SQLite commit.
-- Agent identity is retained across deletion/transfer; Team deletion owns cleanup.
CREATE TABLE agent_results (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  -- BAZ-043 widened provenance: a result is either a turn's deliver_file call, or an artifact an
  -- operator/system surface produced from a review packet. Never both, and never neither — the source is
  -- what the access rules and the backup verifier reason about.
  source_kind TEXT NOT NULL CHECK (source_kind IN ('session_tool', 'review_packet')),
  session_id TEXT,
  tool_call_id TEXT,
  review_packet_id TEXT REFERENCES review_packets(id) ON DELETE CASCADE,
  review_revision TEXT,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 0 AND 26214400),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  deleted_at INTEGER,
  bytes BLOB,
  CHECK ((source_kind = 'session_tool') = (session_id IS NOT NULL AND tool_call_id IS NOT NULL)),
  CHECK ((source_kind = 'review_packet') = (review_packet_id IS NOT NULL AND review_revision IS NOT NULL)),
  CHECK ((deleted_at IS NULL AND bytes IS NOT NULL AND length(bytes) = byte_length)
    OR (deleted_at IS NOT NULL AND bytes IS NULL))
);
-- Retry idempotency is per source: a turn's tool call, or one export of one revision of one packet.
CREATE UNIQUE INDEX agent_results_session_source
  ON agent_results(agent_id, session_id, tool_call_id) WHERE source_kind = 'session_tool';
CREATE UNIQUE INDEX agent_results_packet_source
  ON agent_results(agent_id, review_packet_id, review_revision) WHERE source_kind = 'review_packet';
CREATE INDEX agent_results_team_time ON agent_results(team_id, created_at DESC, id DESC);

CREATE TRIGGER validate_team_policy_baseline_update
BEFORE UPDATE OF baseline_instantiation_id ON team_policies
WHEN NEW.baseline_instantiation_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM template_instantiations i
  WHERE i.id = NEW.baseline_instantiation_id AND i.team_id = NEW.team_id
)
BEGIN
  SELECT RAISE(ABORT, 'baseline instantiation belongs to another Team');
END;

-- Conversation metadata never duplicates the canonical Pi transcript.
CREATE TABLE agent_conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  title TEXT NOT NULL,
  title_revision INTEGER NOT NULL DEFAULT 1,
  initial_title TEXT,
  creation_revision INTEGER NOT NULL,
  creation_conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(agent_id, id),
  UNIQUE(agent_id, filename)
);
CREATE INDEX agent_conversations_agent_time ON agent_conversations(agent_id, created_at DESC, id);
CREATE TABLE agent_conversation_selection (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  FOREIGN KEY(agent_id, conversation_id) REFERENCES agent_conversations(agent_id, id)
);

-- Retained user input only: canonical responses remain in Pi JSONL.
CREATE TABLE user_queue_controls (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  next_position INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE user_queue_items (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('http','telegram')),
  attempt_id TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  provenance_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','claimed','running','held','completed','failed','cancelled','uncertain','superseded')),
  text TEXT,
  payload_retained INTEGER NOT NULL DEFAULT 1 CHECK(payload_retained IN (0,1)),
  supersedes_id TEXT,
  approval_id TEXT REFERENCES communication_approvals(id) ON DELETE SET NULL,
  diagnostic TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  UNIQUE(source, attempt_id),
  FOREIGN KEY(agent_id, conversation_id) REFERENCES agent_conversations(agent_id, id) ON DELETE CASCADE
);
CREATE INDEX user_queue_agent_order ON user_queue_items(agent_id, position, created_at);
CREATE INDEX user_queue_status ON user_queue_items(status, updated_at);
CREATE TABLE user_queue_attachments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES user_queue_items(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  name TEXT,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  bytes BLOB NOT NULL,
  UNIQUE(item_id, ordinal)
);

-- Narrow live clarification receipts; continuation ownership remains process-local.
CREATE TABLE IF NOT EXISTS agent_questions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  question_json TEXT NOT NULL,
  delivered_at INTEGER,
  binding_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','answered','skipped','expired','cancelled')),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER,
  answer_json TEXT,
  response_request_id TEXT,
  no_answer_reason TEXT,
  continuation TEXT NOT NULL CHECK (continuation IN ('waiting','unconfirmed','consumed','interrupted')),
  consumed_at INTEGER,
  delivery_approval_id TEXT REFERENCES communication_approvals(id) ON DELETE SET NULL,
  answer_approval_id TEXT REFERENCES communication_approvals(id) ON DELETE SET NULL,
  proposal_json TEXT,
  FOREIGN KEY (agent_id, conversation_id) REFERENCES agent_conversations(agent_id, id) ON DELETE CASCADE,
  UNIQUE (turn_id, tool_call_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_questions_one_pending ON agent_questions(turn_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agent_questions_agent_time ON agent_questions(agent_id, created_at, id);

-- Daemon-only provenance key. Never merged into provider/worker environments.
-- Stable across bootstrap credential rotation and included in canonical backups.
CREATE TABLE question_receipt_key (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  key BLOB NOT NULL CHECK (length(key) = 32)
);

-- Operator notification metadata only. Source content remains in its canonical tables.
CREATE TABLE notification_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  restore_paused INTEGER NOT NULL DEFAULT 0 CHECK (restore_paused IN (0, 1)),
  restore_history_uncertain INTEGER NOT NULL DEFAULT 0 CHECK (restore_history_uncertain IN (0, 1)),
  kinds_json TEXT NOT NULL,
  kind_cutoffs_json TEXT NOT NULL DEFAULT '{}',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  quiet_json TEXT,
  destination_json TEXT,
  eligible_after INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE notification_receipts (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('communication_approval','lesson_proposal','review_failure','trigger_failure','agent_loop_break')),
  source_id TEXT NOT NULL,
  agent_id TEXT,
  team_id TEXT,
  destination_id TEXT NOT NULL,
  destination_json TEXT NOT NULL CHECK (length(destination_json) <= 4096),
  state TEXT NOT NULL CHECK (state IN ('deferred','sending','delivered','failed','uncertain','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  attempted_at INTEGER,
  delivered_at INTEGER,
  telegram_message_id INTEGER,
  diagnostic TEXT CHECK (diagnostic IS NULL OR length(diagnostic) <= 160),
  UNIQUE (source_kind, source_id, destination_id)
);
CREATE INDEX notification_receipts_state ON notification_receipts(state, created_at, id);
CREATE INDEX notification_receipts_time ON notification_receipts(created_at, id);

-- BAZ-040: operator-reviewed settings; changes never launch project commands.
CREATE TABLE team_coding_environments (
  team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  updated_at INTEGER NOT NULL
);

-- Active writer ownership survives restart and Team deletion until teardown is proven.
-- Deliberately no cascading Team FK: orphaned writers must still block overlapping roots.
CREATE TABLE workspace_writers (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  root_identity TEXT NOT NULL,
  daemon_identity TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('agent', 'mutation')),
  exclusive INTEGER NOT NULL CHECK (exclusive IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('active', 'recovery')),
  recovery_mode TEXT NOT NULL DEFAULT 'owned' CHECK (recovery_mode IN ('owned', 'restored')),
  resources_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(resources_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE workspace_resources (
  id TEXT PRIMARY KEY,
  writer_id TEXT NOT NULL REFERENCES workspace_writers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'container')),
  identity_json TEXT NOT NULL CHECK (json_valid(identity_json)),
  creation_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (creation_acknowledged IN (0, 1)),
  cleanup_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_confirmed IN (0, 1))
);

-- Bounded Agent command evidence. Active commands are never evicted by retention.
CREATE TABLE coding_commands (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  receipt_json TEXT NOT NULL,
  UNIQUE(agent_id, turn_id, tool_call_id)
);
CREATE INDEX coding_command_history ON coding_commands(team_id, created_at, id);

-- BAZ-041: bounded retained diagnostic evidence, subordinate to its receipt.
-- Text lives in the database so the encrypted backup contract carries it, and its
-- original expiry, without a side store. A row without retained bytes is a truthful
-- tombstone: expired (past its own window) or deleted (deliberately erased).
-- Quota eviction drops the row instead, which clients read as unavailable.
CREATE TABLE coding_command_logs (
  command_id TEXT PRIMARY KEY REFERENCES coding_commands(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('retained', 'expired', 'deleted')),
  text TEXT,
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 0 AND 2097152),
  observed_bytes INTEGER NOT NULL CHECK (observed_bytes >= 0),
  redacted INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0, 1)),
  -- Explicit: redaction can shorten or lengthen bytes, so truncation is never
  -- inferred by comparing observed_bytes with the retained byte_length.
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER,
  retired_at INTEGER,
  CHECK (expires_at >= created_at),
  CHECK ((state = 'retained') = (retired_at IS NULL)),
  CHECK ((state = 'retained' AND text IS NOT NULL
      AND length(CAST(text AS BLOB)) = byte_length)
    OR (state != 'retained' AND text IS NULL AND byte_length = 0))
);
CREATE INDEX coding_command_logs_retention ON coding_command_logs(expires_at, command_id);
CREATE INDEX coding_command_logs_team_time ON coding_command_logs(team_id, created_at, command_id);

-- BAZ-042: bounded source snapshots — code evidence, not another conversation store.
-- A snapshot is identified by the content-addressed id of its manifest, so identical trees
-- collapse onto one row per Team. That row keeps the *first* capture's provenance and its
-- original window: capturing the same state again must not extend retention. Manifests hold
-- paths and digests only; no file content is stored here.
CREATE TABLE source_snapshots (
  snapshot_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Operator captures have no turn: provenance is explicit rather than faked with sentinel ids.
  captured_by TEXT NOT NULL CHECK (captured_by IN ('agent', 'operator')),
  agent_id TEXT,
  turn_id TEXT,
  tool_call_id TEXT,
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  head TEXT,
  base_oid TEXT NOT NULL,
  entry_count INTEGER NOT NULL CHECK (entry_count BETWEEN 0 AND 4096),
  captured_content_bytes INTEGER NOT NULL
    CHECK (captured_content_bytes BETWEEN 0 AND 16777216),
  manifest_json TEXT NOT NULL CHECK (length(CAST(manifest_json AS BLOB)) <= 2097152),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((captured_by = 'agent') = (agent_id IS NOT NULL AND turn_id IS NOT NULL
      AND tool_call_id IS NOT NULL)),
  PRIMARY KEY (snapshot_id, team_id)
);
CREATE INDEX source_snapshots_retention ON source_snapshots(expires_at, snapshot_id);
CREATE INDEX source_snapshots_team_time ON source_snapshots(team_id, created_at, snapshot_id);

-- BAZ-043: revision-bound review and handoff.
--
-- One packet binds exactly one immutable change (a BAZ-042 snapshot) to a bounded set of findings and
-- one review conclusion, plus an optional reviewer Agent. It is a record of *review*, not a workflow:
-- no stages, no approver assignment, and no automatic commit, push, PR, merge or deploy.
CREATE TABLE review_packets (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  requester_kind TEXT NOT NULL CHECK (requester_kind IN ('agent', 'operator')),
  requester_agent_id TEXT,
  -- Null means an operator-only packet: nothing was delegated, so no reviewer turn is dispatched.
  reviewer_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  -- BAZ-042 evidence identity. Not a foreign key, deliberately: a snapshot has its own seven-day
  -- window, and a packet whose evidence is gone must report that rather than resolve to another tree.
  snapshot_id TEXT NOT NULL,
  snapshot_complete INTEGER NOT NULL CHECK (snapshot_complete IN (0, 1)),
  head TEXT,
  base_oid TEXT NOT NULL,
  -- What the change is for: the requester's statement of the problem, kept as commentary.
  summary TEXT CHECK (summary IS NULL OR length(CAST(summary AS BLOB)) <= 2000),
  state TEXT NOT NULL CHECK (state IN (
    'open', 'awaiting_approval', 'blocked', 'reviewing', 'reviewed', 'cancelled'
  )),
  -- Recorded only when an export was actually produced, and only for the revision it exported.
  exported_at INTEGER,
  export_revision TEXT,
  -- Operator-reported external states (committed / pushed / pull request / merged / deployed /
  -- production accepted), each a reference the operator supplied. Never inferred, never verified: a
  -- reported state is what the operator says, and this story has no code-host integration to check it.
  reported_json TEXT CHECK (reported_json IS NULL OR json_valid(reported_json)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((requester_kind = 'agent') = (requester_agent_id IS NOT NULL)),
  -- A reviewer never reviews its own packet.
  CHECK (requester_agent_id IS NULL OR reviewer_agent_id IS NULL OR requester_agent_id != reviewer_agent_id),
  -- An export names the revision it was made from, or it is not an export.
  CHECK ((exported_at IS NULL) = (export_revision IS NULL))
);
CREATE INDEX review_packets_team_time ON review_packets(team_id, created_at DESC, id);
CREATE INDEX review_packets_reviewer_dispatch
  ON review_packets(reviewer_agent_id, state, created_at);
CREATE INDEX review_packets_retention ON review_packets(expires_at, id);

-- Findings, append-only. A finding is about one path in one captured revision; the line range is
-- context, never identity, because lines move while the issue stays the same.
CREATE TABLE review_findings (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL REFERENCES review_packets(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent', 'operator')),
  author_agent_id TEXT,
  -- Repository-relative. Validated at write time to be inside the reviewed scope.
  path TEXT NOT NULL CHECK (length(CAST(path AS BLOB)) BETWEEN 1 AND 1000),
  line_start INTEGER CHECK (line_start IS NULL OR line_start >= 1),
  line_end INTEGER CHECK (line_end IS NULL OR line_end >= 1),
  severity TEXT NOT NULL CHECK (severity IN ('blocker', 'major', 'minor', 'info')),
  note TEXT NOT NULL CHECK (length(CAST(note AS BLOB)) BETWEEN 1 AND 4000),
  -- The revision the finding was made against. A finding of an older revision stays visible and is
  -- reported as stale for the current code, rather than being silently attached to new lines.
  snapshot_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'unverified', 'resolved')),
  -- Proof of resolution. A line number alone never proves an issue was fixed, so the only ways out of
  -- `open` are an explicit decision or a later revision that is named.
  resolution_kind TEXT CHECK (resolution_kind IN ('explicit', 'linked_revision')),
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(CAST(resolution_note AS BLOB)) <= 2000),
  resolved_at INTEGER,
  resolved_by_kind TEXT CHECK (resolved_by_kind IN ('agent', 'operator')),
  resolved_by_agent_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK ((line_end IS NULL) OR (line_start IS NOT NULL AND line_end >= line_start)),
  CHECK ((author_kind = 'agent') = (author_agent_id IS NOT NULL)),
  -- Resolution facts travel together, and only a resolved finding has them.
  CHECK (
    (state = 'resolved') = (
      resolution_kind IS NOT NULL AND resolved_at IS NOT NULL
      AND resolved_by_kind IS NOT NULL AND resolution_note IS NOT NULL
    )
  ),
  CHECK ((resolved_by_kind = 'agent') = (resolved_by_agent_id IS NOT NULL))
);
CREATE INDEX review_findings_packet ON review_findings(packet_id, created_at, id);
CREATE INDEX review_findings_unresolved ON review_findings(packet_id, state, severity);

-- One conclusion per reviewer per packet: changes_requested, commented or recommended. Operator
-- acceptance is a separate fact recorded elsewhere; a conclusion never implies it.
CREATE TABLE review_conclusions (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL REFERENCES review_packets(id) ON DELETE CASCADE,
  reviewer_kind TEXT NOT NULL CHECK (reviewer_kind IN ('agent', 'operator')),
  reviewer_agent_id TEXT,
  conclusion TEXT NOT NULL CHECK (conclusion IN ('changes_requested', 'commented', 'recommended')),
  note TEXT CHECK (note IS NULL OR length(CAST(note AS BLOB)) <= 4000),
  -- The revision the conclusion is about, so a later revision cannot inherit it.
  snapshot_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (packet_id, reviewer_kind, reviewer_agent_id),
  CHECK ((reviewer_kind = 'agent') = (reviewer_agent_id IS NOT NULL))
);
CREATE INDEX review_conclusions_packet ON review_conclusions(packet_id, created_at, id);

-- Reviewer dispatch attempts. Claiming is transactional and leased so exactly one owner reviews a
-- packet; a claim left by an interrupted process becomes uncertain and is never replayed.
CREATE TABLE review_attempts (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL REFERENCES review_packets(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  supersedes_attempt_id TEXT REFERENCES review_attempts(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('claimed', 'running', 'completed', 'failed', 'cancelled', 'uncertain')),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT CHECK (error IS NULL OR length(CAST(error AS BLOB)) <= 2000),
  created_at INTEGER NOT NULL,
  CHECK ((state IN ('claimed', 'running')) = (finished_at IS NULL)),
  CHECK ((state IN ('claimed', 'running')) = (lease_owner IS NOT NULL)),
  CHECK (state != 'claimed' OR started_at IS NULL),
  UNIQUE (packet_id, attempt_number)
);
CREATE UNIQUE INDEX review_attempts_one_open_per_packet
  ON review_attempts(packet_id) WHERE finished_at IS NULL;
CREATE INDEX review_attempts_lease ON review_attempts(state, lease_expires_at);

-- BAZ-044: specialist verification of a captured code change.
--
-- One typed request binds exactly one immutable change (a BAZ-042 snapshot) to a finite set of
-- captured commands and the BAZ-040 admitted environment, and one selected same-Team specialist.
-- This is a bounded dispatch-and-evidence record, not a workflow engine: there are no stages,
-- transformations, approver assignments, automatic retries or check substitution.
CREATE TABLE verification_requests (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  requester_kind TEXT NOT NULL CHECK (requester_kind IN ('agent', 'operator')),
  requester_agent_id TEXT,
  recipient_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  -- Canonical messaging identity when the request rides the existing peer message path.
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  -- BAZ-035 conversation identity of the source task, when there is one.
  source_session_id TEXT,
  -- BAZ-042 evidence identity. Deliberately not a foreign key: a snapshot has its own seven-day
  -- window, and a request whose evidence is gone must report that rather than resolve to a
  -- different tree.
  snapshot_id TEXT NOT NULL,
  snapshot_complete INTEGER NOT NULL CHECK (snapshot_complete IN (0, 1)),
  head TEXT,
  base_oid TEXT NOT NULL,
  -- BAZ-040 admitted environment facts resolved at admission and frozen with the request.
  environment_json TEXT NOT NULL CHECK (json_valid(environment_json)),
  summary TEXT CHECK (summary IS NULL OR length(CAST(summary AS BLOB)) <= 2000),
  state TEXT NOT NULL CHECK (state IN (
    'pending', 'awaiting_approval', 'blocked', 'running',
    'completed', 'failed', 'cancelled', 'uncertain'
  )),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  -- An operator request has no Agent requester; an Agent request must name one.
  CHECK ((requester_kind = 'agent') = (requester_agent_id IS NOT NULL)),
  -- A specialist never verifies its own request.
  CHECK (requester_agent_id IS NULL OR requester_agent_id != recipient_agent_id)
);
CREATE INDEX verification_requests_team_time
  ON verification_requests(team_id, created_at DESC, id);
CREATE INDEX verification_requests_recipient_dispatch
  ON verification_requests(recipient_agent_id, state, created_at);
CREATE INDEX verification_requests_retention ON verification_requests(expires_at, id);

-- The captured contract: at most eight checks, each with an exact command, cwd, purpose and
-- timeout. Immutable once written, so a later attempt cannot reinterpret what was agreed.
CREATE TABLE verification_checks (
  request_id TEXT NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 7),
  command TEXT NOT NULL CHECK (length(CAST(command AS BLOB)) BETWEEN 1 AND 2000),
  cwd TEXT NOT NULL CHECK (length(CAST(cwd AS BLOB)) <= 1000),
  purpose TEXT NOT NULL CHECK (length(CAST(purpose AS BLOB)) BETWEEN 1 AND 500),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 300000),
  PRIMARY KEY (request_id, ordinal)
);

-- Execution attempts. Claiming is transactional and leased so exactly one owner dispatches a
-- request; a claim left by an interrupted process becomes uncertain and is never automatically
-- replayed. An explicit rerun is a new attempt that links to the result it supersedes.
CREATE TABLE verification_attempts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  supersedes_attempt_id TEXT REFERENCES verification_attempts(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN (
    'claimed', 'running', 'completed', 'failed', 'cancelled', 'uncertain'
  )),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT CHECK (error IS NULL OR length(CAST(error AS BLOB)) <= 2000),
  -- BAZ-044: where the tree moved relative to the capture, after the checks ran. Written once at
  -- settle, never rewritten; NULL means it was not established (still running, or nothing executed),
  -- which is deliberately distinct from an empty observation.
  observed_writes_json TEXT,
  created_at INTEGER NOT NULL,
  CHECK ((state IN ('claimed', 'running')) = (finished_at IS NULL)),
  CHECK ((state IN ('claimed', 'running')) = (lease_owner IS NOT NULL)),
  CHECK (state != 'claimed' OR started_at IS NULL),
  UNIQUE (request_id, attempt_number)
);
CREATE UNIQUE INDEX verification_attempts_one_open_per_request
  ON verification_attempts(request_id) WHERE finished_at IS NULL;
CREATE INDEX verification_attempts_lease ON verification_attempts(state, lease_expires_at);

-- Executor-owned outcomes, one row set per attempt. History is never rewritten: a rerun records
-- its own outcomes beside the previous attempt's, so the earlier receipt stays readable.
CREATE TABLE verification_check_outcomes (
  attempt_id TEXT NOT NULL REFERENCES verification_attempts(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 7),
  state TEXT NOT NULL CHECK (state IN (
    'not_executed', 'succeeded', 'failed', 'skipped', 'blocked',
    'timed_out', 'cancelled', 'unknown'
  )),
  command_id TEXT REFERENCES coding_commands(id) ON DELETE SET NULL,
  exit_code INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  PRIMARY KEY (attempt_id, ordinal),
  CHECK ((state = 'not_executed') = (finished_at IS NULL)),
  -- A skipped, blocked or interrupted check must not borrow a receipt from another run. Stated
  -- one-directionally on purpose: `command_id` is ON DELETE SET NULL, so a required-non-null rule here
  -- would make a referenced receipt impossible to prune — and pruning runs on every command save, so
  -- the failure would spread to every later receipt in the Team. An executed outcome whose receipt was
  -- pruned therefore keeps its state and exit code with no receipt pointer.
  CHECK (command_id IS NULL OR state IN ('succeeded', 'failed', 'timed_out', 'cancelled')),
  CHECK (exit_code IS NULL OR state IN ('succeeded', 'failed'))
);
CREATE INDEX verification_check_outcomes_command ON verification_check_outcomes(command_id);

-- BAZ-046: one operator-approved publication of a reviewed revision to a code host.
--
-- One row is one decision, one attempt and one observed outcome. There is no workflow: a publication
-- either published, was refused before anything was sent, or ended in a state that says honestly what is
-- and is not known. Retrying a refused publication is a new row, so the earlier refusal stays visible.
CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL REFERENCES review_packets(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  -- The host adapter that was used, and the repository as the operator configured it.
  host TEXT NOT NULL CHECK (host IN ('github', 'local')),
  repository TEXT NOT NULL CHECK (length(repository) BETWEEN 1 AND 200),
  base_branch TEXT NOT NULL CHECK (length(base_branch) BETWEEN 1 AND 200),
  head_branch TEXT NOT NULL CHECK (length(head_branch) BETWEEN 1 AND 200),
  base_oid TEXT NOT NULL CHECK (length(base_oid) = 40),
  commit_message TEXT NOT NULL CHECK (length(commit_message) BETWEEN 1 AND 2000),
  -- The Agent that asked for the review, if one did: it is told the outcome and nothing else.
  notify_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN (
    'pending', 'publishing', 'published', 'refused', 'failed', 'uncertain'
  )),
  refusal_reason TEXT CHECK (refusal_reason IS NULL OR length(refusal_reason) <= 64),
  refusal_detail TEXT CHECK (refusal_detail IS NULL OR length(refusal_detail) <= 400),
  commit_oid TEXT CHECK (commit_oid IS NULL OR length(commit_oid) = 40),
  -- Always 0 today: publication commits are unsigned and no code path may claim otherwise.
  signed INTEGER NOT NULL DEFAULT 0 CHECK (signed = 0),
  pull_request_number INTEGER,
  pull_request_url TEXT CHECK (pull_request_url IS NULL OR length(pull_request_url) <= 400),
  error TEXT CHECK (error IS NULL OR length(error) <= 400),
  -- Lease ownership, so a restarted daemon can recover an interrupted attempt as unknown rather than
  -- replaying a push that may already have landed.
  claimed_by TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  -- A refusal is the only state that carries no attempt: everything else was, or may have been, sent.
  CHECK ((state = 'refused') = (refusal_reason IS NOT NULL)),
  CHECK ((state IN ('published', 'refused', 'failed', 'uncertain')) = (finished_at IS NOT NULL))
);
CREATE INDEX publications_team_time ON publications(team_id, created_at, id);
-- One successful publication per packet. A refused or failed one does not block a corrected retry.
CREATE UNIQUE INDEX publications_packet_published ON publications(packet_id) WHERE state = 'published';
CREATE INDEX publications_lease ON publications(state, lease_expires_at);
