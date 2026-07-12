-- BAZ-010: canonical Team-template and Group-policy storage.
--
-- This migration deliberately performs the legacy Profile Group conversion in
-- the same transaction in which these tables are created.  The migration
-- runner records 0009 only after every assertion at the bottom succeeds.

CREATE TABLE profile_communication_defaults (
  profile_id          TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  user_input          INTEGER NOT NULL CHECK (user_input IN (0, 1)),
  user_output         INTEGER NOT NULL CHECK (user_output IN (0, 1)),
  outside_group_input INTEGER NOT NULL CHECK (outside_group_input IN (0, 1)),
  outside_group_output INTEGER NOT NULL CHECK (outside_group_output IN (0, 1)),
  peer_default        TEXT NOT NULL CHECK (peer_default IN ('inherit_harness','allow_all','deny_all')),
  updated_at          INTEGER NOT NULL
);

CREATE TABLE harness_templates (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  user_md               TEXT,
  current_revision      INTEGER NOT NULL CHECK (current_revision >= 1),
  compatibility_managed INTEGER NOT NULL DEFAULT 0 CHECK (compatibility_managed IN (0, 1)),
  deleted_at            INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE harness_template_slots (
  template_id    TEXT NOT NULL REFERENCES harness_templates(id) ON DELETE CASCADE,
  slot_id        TEXT NOT NULL,
  position       INTEGER NOT NULL CHECK (position >= 0),
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name     TEXT NOT NULL,
  model_override TEXT,
  reasoning_level TEXT CHECK (reasoning_level IS NULL OR reasoning_level IN ('off','minimal','low','medium','high','xhigh')),
  tombstoned_at  INTEGER,
  PRIMARY KEY (template_id, slot_id)
);
CREATE UNIQUE INDEX harness_template_active_position
  ON harness_template_slots(template_id, position) WHERE tombstoned_at IS NULL;

CREATE TABLE harness_template_edges (
  template_id TEXT NOT NULL REFERENCES harness_templates(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','outside_group','slot')),
  source_id   TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL CHECK (target_kind IN ('user','outside_group','slot')),
  target_id   TEXT NOT NULL DEFAULT '',
  CHECK ((source_kind = 'slot') = (length(source_id) > 0)),
  CHECK ((target_kind = 'slot') = (length(target_id) > 0)),
  CHECK (source_kind = 'slot' OR target_kind = 'slot'),
  CHECK (source_kind != target_kind OR source_id != target_id),
  PRIMARY KEY (template_id, source_kind, source_id, target_kind, target_id)
);

CREATE TABLE harness_template_revisions (
  template_id TEXT NOT NULL REFERENCES harness_templates(id) ON DELETE CASCADE,
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  name        TEXT NOT NULL,
  user_md     TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (template_id, revision)
);

CREATE TABLE harness_template_revision_slots (
  template_id     TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  slot_id         TEXT NOT NULL,
  position        INTEGER NOT NULL CHECK (position >= 0),
  profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name      TEXT NOT NULL,
  model_override  TEXT,
  reasoning_level TEXT CHECK (reasoning_level IS NULL OR reasoning_level IN ('off','minimal','low','medium','high','xhigh')),
  PRIMARY KEY (template_id, revision, slot_id),
  UNIQUE (template_id, revision, position),
  FOREIGN KEY (template_id, revision)
    REFERENCES harness_template_revisions(template_id, revision) ON DELETE CASCADE
);

CREATE TABLE harness_template_revision_edges (
  template_id TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','outside_group','slot')),
  source_id   TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL CHECK (target_kind IN ('user','outside_group','slot')),
  target_id   TEXT NOT NULL DEFAULT '',
  CHECK ((source_kind = 'slot') = (length(source_id) > 0)),
  CHECK ((target_kind = 'slot') = (length(target_id) > 0)),
  CHECK (source_kind = 'slot' OR target_kind = 'slot'),
  CHECK (source_kind != target_kind OR source_id != target_id),
  PRIMARY KEY (template_id, revision, source_kind, source_id, target_kind, target_id),
  FOREIGN KEY (template_id, revision)
    REFERENCES harness_template_revisions(template_id, revision) ON DELETE CASCADE
);

CREATE TABLE live_harnesses (
  group_id                  TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  revision                  INTEGER NOT NULL CHECK (revision >= 1),
  membership_mode           TEXT NOT NULL CHECK (membership_mode IN ('compatibility_open','explicit')),
  baseline_instantiation_id TEXT REFERENCES template_instantiations(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  updated_at                INTEGER NOT NULL
);

CREATE TABLE template_instantiations (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL REFERENCES live_harnesses(group_id) ON DELETE CASCADE,
  template_id       TEXT NOT NULL,
  template_revision INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (template_id, template_revision)
    REFERENCES harness_template_revisions(template_id, revision) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX live_harness_baseline_owner
  ON live_harnesses(baseline_instantiation_id) WHERE baseline_instantiation_id IS NOT NULL;

CREATE TABLE source_slot_bindings (
  agent_id        TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  instantiation_id TEXT NOT NULL REFERENCES template_instantiations(id) ON DELETE CASCADE,
  source_slot_id   TEXT NOT NULL,
  UNIQUE (instantiation_id, source_slot_id)
);

CREATE TABLE live_harness_edges (
  group_id    TEXT NOT NULL REFERENCES live_harnesses(group_id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','outside_group','agent')),
  source_id   TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL CHECK (target_kind IN ('user','outside_group','agent')),
  target_id   TEXT NOT NULL DEFAULT '',
  CHECK ((source_kind = 'agent') = (length(source_id) > 0)),
  CHECK ((target_kind = 'agent') = (length(target_id) > 0)),
  CHECK (source_kind = 'agent' OR target_kind = 'agent'),
  CHECK (source_kind != target_kind OR source_id != target_id),
  PRIMARY KEY (group_id, source_kind, source_id, target_kind, target_id)
);

CREATE TABLE live_agent_state (
  agent_id      TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  group_id      TEXT NOT NULL REFERENCES live_harnesses(group_id) ON DELETE CASCADE,
  position_x    REAL,
  position_y    REAL,
  display_json  TEXT,
  CHECK ((position_x IS NULL) = (position_y IS NULL))
);

-- Future Group inserts cannot exist without their inseparable revision-1 policy.
CREATE TRIGGER create_group_live_harness
AFTER INSERT ON groups
BEGIN
  INSERT INTO live_harnesses
    (group_id, revision, membership_mode, baseline_instantiation_id, updated_at)
  VALUES (NEW.id, 1, 'compatibility_open', NULL, NEW.created_at);
END;

CREATE TRIGGER prevent_detached_live_harness_delete
BEFORE DELETE ON live_harnesses
WHEN EXISTS (SELECT 1 FROM groups g WHERE g.id = OLD.group_id)
BEGIN
  SELECT RAISE(ABORT, 'Group policy cannot be deleted independently of its Group');
END;

CREATE TRIGGER validate_template_edge_insert
BEFORE INSERT ON harness_template_edges
WHEN (NEW.source_kind = 'slot' AND NOT EXISTS (
        SELECT 1 FROM harness_template_slots s
        WHERE s.template_id = NEW.template_id AND s.slot_id = NEW.source_id
          AND s.tombstoned_at IS NULL
      ))
  OR (NEW.target_kind = 'slot' AND NOT EXISTS (
        SELECT 1 FROM harness_template_slots s
        WHERE s.template_id = NEW.template_id AND s.slot_id = NEW.target_id
          AND s.tombstoned_at IS NULL
      ))
BEGIN
  SELECT RAISE(ABORT, 'template edge endpoint is not an active slot');
END;

CREATE TRIGGER validate_live_edge_insert
BEFORE INSERT ON live_harness_edges
WHEN (NEW.source_kind = 'agent' AND NOT EXISTS (
        SELECT 1 FROM agents a WHERE a.id = NEW.source_id AND a.group_id = NEW.group_id
      ))
  OR (NEW.target_kind = 'agent' AND NOT EXISTS (
        SELECT 1 FROM agents a WHERE a.id = NEW.target_id AND a.group_id = NEW.group_id
      ))
BEGIN
  SELECT RAISE(ABORT, 'live edge endpoint is not a Group member');
END;

CREATE TRIGGER validate_source_binding_insert
BEFORE INSERT ON source_slot_bindings
WHEN NOT EXISTS (
  SELECT 1
  FROM template_instantiations i
  JOIN harness_template_revision_slots s
    ON s.template_id = i.template_id
   AND s.revision = i.template_revision
   AND s.slot_id = NEW.source_slot_id
  JOIN agents a ON a.id = NEW.agent_id AND a.group_id = i.group_id
  WHERE i.id = NEW.instantiation_id
)
BEGIN
  SELECT RAISE(ABORT, 'source binding does not match retained revision or Group membership');
END;

CREATE TRIGGER validate_live_agent_state_insert
BEFORE INSERT ON live_agent_state
WHEN NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.id = NEW.agent_id AND a.group_id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'live Agent state does not match agents.group_id');
END;

CREATE TRIGGER validate_live_baseline_update
BEFORE UPDATE OF baseline_instantiation_id ON live_harnesses
WHEN NEW.baseline_instantiation_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM template_instantiations i
  WHERE i.id = NEW.baseline_instantiation_id AND i.group_id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'baseline instantiation belongs to another Group');
END;

-- Convert the sole legacy roster to canonical Team templates.
INSERT INTO harness_templates
  (id, name, user_md, current_revision, compatibility_managed, deleted_at, created_at, updated_at)
SELECT id, name, user_md, 1, 1, NULL, created_at, updated_at
FROM profile_groups;

INSERT INTO harness_template_slots
  (template_id, slot_id, position, profile_id, agent_name, model_override, reasoning_level,
   tombstoned_at)
SELECT profile_group_id,
       lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
       substr(lower(hex(randomblob(2))), 2) || '-' ||
       substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
       lower(hex(randomblob(6))),
       position, profile_id, agent_name, model_override, reasoning_level, NULL
FROM profile_group_members;

-- Exact Open Team current policy: every distinct slot pair and four boundary edges per slot.
INSERT INTO harness_template_edges
SELECT a.template_id, 'slot', a.slot_id, 'slot', b.slot_id
FROM harness_template_slots a
JOIN harness_template_slots b ON b.template_id = a.template_id AND b.slot_id <> a.slot_id;
INSERT INTO harness_template_edges
SELECT template_id, 'user', '', 'slot', slot_id FROM harness_template_slots;
INSERT INTO harness_template_edges
SELECT template_id, 'slot', slot_id, 'user', '' FROM harness_template_slots;
INSERT INTO harness_template_edges
SELECT template_id, 'outside_group', '', 'slot', slot_id FROM harness_template_slots;
INSERT INTO harness_template_edges
SELECT template_id, 'slot', slot_id, 'outside_group', '' FROM harness_template_slots;

INSERT INTO harness_template_revisions (template_id, revision, name, user_md, created_at)
SELECT id, 1, name, user_md, updated_at FROM harness_templates;
INSERT INTO harness_template_revision_slots
SELECT template_id, 1, slot_id, position, profile_id, agent_name, model_override, reasoning_level
FROM harness_template_slots WHERE tombstoned_at IS NULL;
INSERT INTO harness_template_revision_edges
SELECT template_id, 1, source_kind, source_id, target_kind, target_id
FROM harness_template_edges;

-- Every Group owns exactly one ordinary stored policy. Historical lineage is intentionally absent.
INSERT INTO live_harnesses (group_id, revision, membership_mode, baseline_instantiation_id, updated_at)
SELECT id, 1, 'compatibility_open', NULL, created_at FROM groups;
INSERT INTO live_agent_state (agent_id, group_id, position_x, position_y, display_json)
SELECT id, group_id, NULL, NULL, NULL FROM agents;
INSERT INTO live_harness_edges
SELECT a.group_id, 'agent', a.id, 'agent', b.id
FROM agents a JOIN agents b ON b.group_id = a.group_id AND b.id <> a.id;
INSERT INTO live_harness_edges
SELECT group_id, 'user', '', 'agent', id FROM agents;
INSERT INTO live_harness_edges
SELECT group_id, 'agent', id, 'user', '' FROM agents;
INSERT INTO live_harness_edges
SELECT group_id, 'outside_group', '', 'agent', id FROM agents;
INSERT INTO live_harness_edges
SELECT group_id, 'agent', id, 'outside_group', '' FROM agents;

-- Fail the transaction before legacy tables are dropped if any migration postcondition is false.
CREATE TEMP TABLE harness_migration_assertion (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO harness_migration_assertion SELECT COUNT(*) = (SELECT COUNT(*) FROM profile_groups) FROM harness_templates;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = (SELECT COUNT(*) FROM profile_group_members) FROM harness_template_slots;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = COUNT(DISTINCT slot_id) FROM harness_template_slots;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = 0 FROM harness_template_slots WHERE length(slot_id) <> 36;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = (SELECT COUNT(*) FROM harness_templates) FROM harness_template_revisions;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = (SELECT COUNT(*) FROM groups) FROM live_harnesses;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = (SELECT COUNT(*) FROM agents) FROM live_agent_state;
INSERT INTO harness_migration_assertion
SELECT COUNT(*) = 0 FROM live_agent_state s
JOIN agents a ON a.id = s.agent_id
WHERE s.group_id <> a.group_id;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = 0 FROM template_instantiations;
INSERT INTO harness_migration_assertion SELECT COUNT(*) = 0 FROM source_slot_bindings;
INSERT INTO harness_migration_assertion
SELECT COUNT(*) = 0 FROM harness_templates t
WHERE (SELECT COUNT(*) FROM harness_template_edges e WHERE e.template_id = t.id) <>
      ((SELECT COUNT(*) FROM harness_template_slots s WHERE s.template_id = t.id AND s.tombstoned_at IS NULL) *
       ((SELECT COUNT(*) FROM harness_template_slots s WHERE s.template_id = t.id AND s.tombstoned_at IS NULL) - 1) +
       4 * (SELECT COUNT(*) FROM harness_template_slots s WHERE s.template_id = t.id AND s.tombstoned_at IS NULL));
INSERT INTO harness_migration_assertion
SELECT COUNT(*) = 0 FROM harness_template_revisions r
WHERE (SELECT COUNT(*) FROM harness_template_revision_edges e
       WHERE e.template_id = r.template_id AND e.revision = r.revision) <>
      ((SELECT COUNT(*) FROM harness_template_revision_slots s
        WHERE s.template_id = r.template_id AND s.revision = r.revision) *
       ((SELECT COUNT(*) FROM harness_template_revision_slots s
         WHERE s.template_id = r.template_id AND s.revision = r.revision) - 1) +
       4 * (SELECT COUNT(*) FROM harness_template_revision_slots s
            WHERE s.template_id = r.template_id AND s.revision = r.revision));
INSERT INTO harness_migration_assertion
SELECT COUNT(*) = 0 FROM live_harnesses h
WHERE (SELECT COUNT(*) FROM live_harness_edges e WHERE e.group_id = h.group_id) <>
      ((SELECT COUNT(*) FROM agents a WHERE a.group_id = h.group_id) *
       ((SELECT COUNT(*) FROM agents a WHERE a.group_id = h.group_id) - 1) +
       4 * (SELECT COUNT(*) FROM agents a WHERE a.group_id = h.group_id));
DROP TABLE harness_migration_assertion;

DROP TABLE profile_group_members;
DROP TABLE profile_groups;
