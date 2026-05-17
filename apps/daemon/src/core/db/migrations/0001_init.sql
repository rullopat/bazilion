-- Bazilion initial schema (consolidated, post-IPC + secrets-in-DB cleanup).
--
-- The daemon is the sole owner of `~/.bazilion/`. All state — entity
-- metadata, inbox, scheduler, web tokens, encrypted secrets, plaintext
-- config — lives in this single SQLite file. The only other file at the
-- bazilion home root is `auth.json`: a tiny bootstrap shared by the daemon
-- (which uses its `token` as the PBKDF2 seed for the `secrets` table) and
-- the CLI (which uses the same token as its loopback bearer).
--
-- On-disk layout owned by the daemon:
--   ~/.bazilion/bazilion.db
--   ~/.bazilion/groups/<slug>/        — group root, mounted as cwd; may be a
--                                       symlink for "agents working on my
--                                       existing project tree" use cases
--                  /memory/           — qmd index for the group (shared by
--                                       all member agents)
--   ~/.bazilion/agents/<id>/          — agent's private home (NEVER inside
--                                       the group tree, so the cwd-rooted
--                                       coding tools can't see/clobber it)
--                  /sessions/*.jsonl  — pi transcripts
--   ~/.bazilion/profiles/<id>/        — profile templates
--   ~/.bazilion/skills/<name>/        — installed skills
--   ~/.bazilion/logs/                 — daemon logs

-- Groups are collaboration contexts: one filesystem root, one USER.md, one
-- roster of member agents. The id IS the slug IS the directory name under
-- `~/.bazilion/groups/`. No `path` column — paths derive from id.
-- `user_md` is read-only context about the human (edited via web UI; never
-- exposed as a file the agent could clobber via `edit`/`write`).
CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  user_md     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- Profiles are agent templates. `dir` is the on-disk directory for the
-- profile's SOUL.md / IDENTITY.md / etc. master files, derived from id.
-- `skills_mode = 'all'` attaches every installed skill at spawn;
-- `'selected'` attaches only those listed in `profile_default_skills`.
CREATE TABLE profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  dir           TEXT NOT NULL,
  default_model TEXT NOT NULL,
  skills_mode   TEXT NOT NULL DEFAULT 'selected' CHECK (skills_mode IN ('all','selected')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE profile_default_skills (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_name  TEXT NOT NULL,
  PRIMARY KEY (profile_id, skill_name)
);

-- Agents have exactly one group. `dir` is the agent's private home,
-- ~/.bazilion/agents/<id>/ — strictly outside the group tree so that
-- pi's coding tools (rooted at the group dir) can't reach into it.
-- `reasoning_level` feeds pi-ai's streamSimple `reasoning` option;
-- 'medium' is the sensible default.
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES profiles(id),
  name            TEXT NOT NULL,
  model_override  TEXT,
  status          TEXT NOT NULL CHECK (status IN ('idle','running','archived')),
  dir             TEXT NOT NULL,
  reasoning_level TEXT NOT NULL DEFAULT 'medium',
  group_id        TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  created_at      INTEGER NOT NULL,
  archived_at     INTEGER
);

CREATE TABLE agent_skills (
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_name  TEXT NOT NULL,
  attached_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, skill_name)
);

-- Periodic / scheduled wake-up triggers. The scheduler picks rows whose
-- next-fire time has elapsed and kicks off a turn with `message` as the
-- user input.
--
-- kind='interval' → interval_sec holds seconds between fires (cron_expr NULL)
-- kind='cron'     → cron_expr holds a 5-field cron expression (interval_sec NULL)
--
-- last_fired_at is bumped *before* the run kicks off so a daemon restart
-- mid-fire doesn't double-trigger.
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

-- Inter-agent inbox. The scheduler's auto-deliver loop polls
-- `messages_to_unread` to fan out wakeup turns; the messaging tools insert
-- here when one agent sends another a message.
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL REFERENCES agents(id),
  to_agent_id   TEXT NOT NULL REFERENCES agents(id),
  reply_to      TEXT REFERENCES messages(id),
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER
);
CREATE INDEX messages_to_unread ON messages(to_agent_id) WHERE read_at IS NULL;

-- Per-skill import provenance. Skills live on disk under ~/.bazilion/skills/<name>/;
-- this table records where each was imported from and when.
CREATE TABLE skill_meta (
  name         TEXT PRIMARY KEY,
  source       TEXT,
  imported_at  INTEGER
);

-- Per-client web tokens. Each row stores SHA-256(token) hex; the plaintext
-- is returned exactly once at creation time and never persisted in this
-- table. The CLI's bootstrap token is one row here — its plaintext lives
-- in `~/.bazilion/auth.json` so both the daemon (PBKDF2 seed for the
-- secrets table) and the CLI (loopback bearer) can read it.
-- `revoked_at` is a soft-delete marker to keep audit trail intact.
CREATE TABLE web_tokens (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX web_tokens_active ON web_tokens(token_hash) WHERE revoked_at IS NULL;

-- Curated list of models per provider. Drives the model dropdowns in
-- profile creation and agent spawn/edit forms.
CREATE TABLE provider_models (
  provider   TEXT    NOT NULL,
  model      TEXT    NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (provider, model)
);
CREATE INDEX idx_provider_models_provider ON provider_models (provider);

-- Admin-toggled enabled state per provider.
CREATE TABLE provider_state (
  provider_id TEXT    NOT NULL PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

-- Encrypted secrets. AES-256-GCM envelopes (salt+iv+tag+data hex JSON),
-- one row per env-var-shaped key (`ANTHROPIC_API_KEY`, `OPENAI_CODEX_OAUTH`, …).
-- The encryption key is derived from the bootstrap web token (PBKDF2-SHA256,
-- 100k iterations) — same crypto as the previous file-based secrets.enc,
-- now atomic with the rest of the DB.
CREATE TABLE secrets (
  key         TEXT PRIMARY KEY,
  envelope    TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Plaintext config. Same env-var-shaped keys as secrets, but for values
-- that don't need confidentiality (server URLs, region slugs, project IDs).
-- The application layer enforces a CONFIG_KEYS allowlist on writes so a
-- typo can't put a secret in this table.
CREATE TABLE config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
