-- Bazilion database schema. Clean install only: a fresh home gets this file in one transaction,
-- and an existing home must match it exactly (comments and whitespace aside) or startup refuses
-- it with reset guidance. Schema changes edit this file directly; there are no migrations.

-- Core entities: Teams, Profiles, Agents and installed skills
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_md TEXT NOT NULL DEFAULT '',
  -- open: Team members may message each other freely; restricted: only along allow edges.
  policy_mode TEXT NOT NULL DEFAULT 'open' CHECK (policy_mode IN ('open', 'restricted')),
  created_at INTEGER NOT NULL,
  telegram_icon_color INTEGER,
  telegram_topic_name_format TEXT
);
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_model TEXT NOT NULL,
  skills_mode TEXT NOT NULL DEFAULT 'selected' CHECK (skills_mode IN ('all','selected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE profile_default_skills (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  PRIMARY KEY (profile_id, skill_name)
);
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  model_override TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','archived')),
  reasoning_level TEXT NOT NULL DEFAULT 'medium',
  review_enabled INTEGER NOT NULL DEFAULT 0 CHECK (review_enabled IN (0, 1)),
  review_every_n_turns INTEGER NOT NULL DEFAULT 8
    CHECK (review_every_n_turns BETWEEN 1 AND 100),
  review_model TEXT,
  review_reasoning_level TEXT NOT NULL DEFAULT 'low'
    CHECK (review_reasoning_level IN ('off','minimal','low','medium','high','xhigh')),
  review_turns_since_last INTEGER NOT NULL DEFAULT 0 CHECK (review_turns_since_last >= 0),
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  telegram_topic_id INTEGER,
  telegram_icon_emoji TEXT,
  telegram_mirror_mode TEXT NOT NULL DEFAULT 'minimal'
    CHECK (telegram_mirror_mode IN ('minimal','verbose'))
);
CREATE UNIQUE INDEX idx_agents_telegram_topic_id
  ON agents(telegram_topic_id) WHERE telegram_topic_id IS NOT NULL;
CREATE TABLE agent_skills (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  attached_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, skill_name)
);
CREATE TABLE skill_meta (
  name TEXT PRIMARY KEY,
  source TEXT,
  imported_at INTEGER
);

-- Bootstrap and device credentials (full access, optional expiry) and browser sessions
CREATE TABLE web_tokens (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bootstrap','device')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER
);
-- A session expires once unused for its sliding lifetime; revoking deletes the row.
CREATE TABLE web_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  token_id TEXT NOT NULL REFERENCES web_tokens(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Providers, encrypted secrets and plaintext configuration
CREATE TABLE provider_models (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model)
);
CREATE TABLE provider_state (
  provider_id TEXT NOT NULL PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE secrets (
  key TEXT PRIMARY KEY,
  envelope TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Telegram access control
CREATE TABLE telegram_allowed_users (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  label TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  added_at INTEGER NOT NULL
);
CREATE TABLE telegram_pairing_challenge (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- MCP servers
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio','http')),
  command TEXT,
  args TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  has_auth INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Conversations: metadata only, the transcript stays in Pi's session file <id>.jsonl
CREATE TABLE agent_conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_id, id)
);
CREATE INDEX agent_conversations_agent_time
  ON agent_conversations(agent_id, created_at DESC, id);
CREATE TABLE agent_conversation_selection (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  FOREIGN KEY (agent_id, conversation_id) REFERENCES agent_conversations(agent_id, id)
);

-- Mailbox and loop breaker
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL REFERENCES agents(id),
  to_agent_id TEXT NOT NULL REFERENCES agents(id),
  reply_to TEXT REFERENCES messages(id),
  causal_chain_id TEXT NOT NULL,
  causal_hop INTEGER NOT NULL DEFAULT 0 CHECK (causal_hop >= 0),
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX messages_to_unread ON messages(to_agent_id) WHERE read_at IS NULL;
CREATE TABLE agent_loop_break_events (
  id TEXT PRIMARY KEY,
  causal_chain_id TEXT NOT NULL,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  from_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  target_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  attempted_hop INTEGER NOT NULL CHECK (attempted_hop >= 0),
  max_hops INTEGER NOT NULL CHECK (max_hops >= 0),
  reason TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_loop_break_events_agent_time
  ON agent_loop_break_events(from_agent_id, to_agent_id, created_at DESC);

-- Scheduled triggers and their run history (one row per occurrence, run at most once)
CREATE TABLE agent_triggers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('interval','cron')),
  interval_sec INTEGER,
  cron_expr TEXT,
  message TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_triggers_agent ON agent_triggers(agent_id);
CREATE INDEX agent_triggers_enabled ON agent_triggers(enabled) WHERE enabled = 1;
CREATE TABLE trigger_dispatches (
  id TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL REFERENCES agent_triggers(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  UNIQUE (trigger_id, scheduled_at),
  FOREIGN KEY (agent_id, conversation_id) REFERENCES agent_conversations(agent_id, id)
);
CREATE INDEX trigger_dispatches_status ON trigger_dispatches(status, scheduled_at);

-- Team templates and Team Policy
-- An edge endpoint is a member Agent id (a slot position in a template) or 'outside',
-- which stands for every Agent in other Teams. Edges are directed allow rules.
CREATE TABLE team_policy_edges (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  CHECK (source <> target),
  PRIMARY KEY (team_id, source, target)
);
CREATE TABLE team_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_md TEXT,
  policy_mode TEXT NOT NULL DEFAULT 'open' CHECK (policy_mode IN ('open', 'restricted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE team_template_slots (
  template_id TEXT NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name TEXT NOT NULL,
  model_override TEXT,
  reasoning_level TEXT CHECK (reasoning_level IS NULL
    OR reasoning_level IN ('off','minimal','low','medium','high','xhigh')),
  layout_x REAL,
  layout_y REAL,
  PRIMARY KEY (template_id, position)
);
CREATE TABLE team_template_edges (
  template_id TEXT NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  CHECK (source <> target),
  PRIMARY KEY (template_id, source, target)
);

-- Follow-up queue: user input that waits for the Agent's current turn, oldest first. Responses
-- stay in Pi's session file. A Telegram item keeps the message it came from (origin_json);
-- telegram_message is that message's chat:message id, so a redelivered update is queued once.
CREATE TABLE user_queue_controls (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1))
);
CREATE TABLE user_queue_items (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('http','telegram')),
  telegram_message TEXT UNIQUE,
  origin_json TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending','running','completed','failed','cancelled')),
  text TEXT NOT NULL,
  diagnostic TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (agent_id, conversation_id)
    REFERENCES agent_conversations(agent_id, id) ON DELETE CASCADE
);
CREATE INDEX user_queue_agent_order ON user_queue_items(agent_id, status, created_at);
CREATE TABLE user_queue_attachments (
  item_id TEXT NOT NULL REFERENCES user_queue_items(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  name TEXT,
  mime_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (item_id, ordinal)
);

-- Attention acknowledgements, and Telegram notifications of new Attention items
CREATE TABLE attention_acknowledgements (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  PRIMARY KEY (source_kind, source_id)
);
CREATE TABLE notification_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  kinds_json TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  quiet_json TEXT,
  -- Items last updated before notifications were switched on are never sent.
  enabled_at INTEGER
);
-- One row per open Attention item already sent; removed once the item is no longer open.
CREATE TABLE attention_notified (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  notified_at INTEGER NOT NULL,
  PRIMARY KEY (source_kind, source_id)
);

-- Agent self-review and lesson proposals
CREATE TABLE agent_reviews (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('pending','running','completed','failed','cancelled')),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('cadence','manual')),
  source_session_id TEXT,
  source_start_ordinal INTEGER
    CHECK (source_start_ordinal IS NULL OR source_start_ordinal >= 0),
  source_end_ordinal INTEGER CHECK (source_end_ordinal IS NULL OR source_end_ordinal >= 0),
  input_characters INTEGER NOT NULL DEFAULT 0 CHECK (input_characters >= 0),
  turns_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (turns_reviewed >= 0),
  proposal_count INTEGER NOT NULL DEFAULT 0 CHECK (proposal_count BETWEEN 0 AND 5),
  started_at INTEGER,
  finished_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX agent_reviews_one_open_per_agent
  ON agent_reviews(agent_id) WHERE status IN ('pending','running');
CREATE INDEX agent_reviews_pending ON agent_reviews(status, created_at);
CREATE INDEX agent_reviews_agent_time ON agent_reviews(agent_id, created_at DESC);
CREATE TABLE agent_lesson_proposals (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES agent_reviews(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('private','shared')),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  decided_at INTEGER,
  revoked_at INTEGER,
  applied_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX agent_lesson_proposals_agent_status_time
  ON agent_lesson_proposals(agent_id, status, created_at DESC);
CREATE INDEX agent_lesson_proposals_review
  ON agent_lesson_proposals(review_id, created_at ASC);

-- Agent results: files delivered by deliver_file or image_generate (no Agent foreign key: a result
-- outlives its Agent). One tool call can save several images, numbered by source_index.
CREATE TABLE agent_results (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  source_index INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 0 AND 26214400),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  image_model TEXT,
  created_at INTEGER NOT NULL,
  bytes BLOB NOT NULL CHECK (length(bytes) = byte_length),
  UNIQUE (agent_id, session_id, tool_call_id, source_index)
);
CREATE INDEX agent_results_team_time ON agent_results(team_id, created_at DESC, id DESC);

-- Coding environments
CREATE TABLE team_coding_environments (
  team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  image TEXT,
  cwd TEXT NOT NULL DEFAULT '.'
);

