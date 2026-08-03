-- Canonical clean-install schema. Bazilion is alpha and does not support legacy DB upgrades.
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
  team_id        TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  created_at      INTEGER NOT NULL,
  archived_at     INTEGER
, telegram_topic_id INTEGER, telegram_topic_name_locked INTEGER NOT NULL DEFAULT 0, telegram_icon_emoji TEXT, telegram_mirror_mode TEXT NOT NULL DEFAULT 'minimal'
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
  UNIQUE (trigger_id, scheduled_at)
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
  read_at       INTEGER
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
CREATE TABLE skill_meta (
  name         TEXT PRIMARY KEY,
  source       TEXT,
  imported_at  INTEGER
);
CREATE TABLE web_tokens (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX web_tokens_active ON web_tokens(token_hash) WHERE revoked_at IS NULL;
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
  username  TEXT,
  label     TEXT,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  added_at  INTEGER NOT NULL
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
CREATE TRIGGER validate_team_policy_baseline_update
BEFORE UPDATE OF baseline_instantiation_id ON team_policies
WHEN NEW.baseline_instantiation_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM template_instantiations i
  WHERE i.id = NEW.baseline_instantiation_id AND i.team_id = NEW.team_id
)
BEGIN
  SELECT RAISE(ABORT, 'baseline instantiation belongs to another Team');
END;
