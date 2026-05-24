-- Profile groups — preconfigured team templates. A ProfileGroup captures
-- the recipe for a team (ordered slots, each pointing at a Profile with
-- optional per-slot overrides) so an operator can replay it with a single
-- spawn call instead of clicking through agent-create N times per project.
--
-- Strictly additive: the single-profile `POST /api/agents` spawn path is
-- untouched. Profile groups bundle existing primitives (profiles, groups,
-- agents), they don't replace them.
--
-- Spawn semantics live in apps/daemon/src/core/profile-group/spawn.ts.
-- See docs/backlog/todo/BAZ-002-profile-groups.md for the full spec.

CREATE TABLE profile_groups (
  id              TEXT PRIMARY KEY,        -- slug, e.g. "platform-team"
  name            TEXT NOT NULL,           -- display name
  group_slug_hint TEXT,                    -- optional default target group slug; treated as a suggestion at spawn time (operator can override via `--group <slug>` / web modal)
  user_md         TEXT,                    -- optional starter USER.md; seeded into the target group only when the target's `user_md` IS NULL (empty string is operator-explicit, left alone)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Slot ordering uses an explicit `position` column rather than insertion
-- order so the spawn loop is deterministic and rollback can identify which
-- slots succeeded. PK includes position so the same template can have
-- multiple slots pointing at the same profile (e.g. "two reviewers" —
-- duplicate agent_name values are intentionally accepted; the spawn op
-- auto-suffixes collisions with `-2`, `-3`, ... at spawn time).
--
-- `ON DELETE RESTRICT` on profile_id prevents deleting a profile that a
-- profile-group slot still references; the existing single-profile delete
-- keeps working unchanged because it never had a referrer before.
CREATE TABLE profile_group_slots (
  profile_group_id TEXT NOT NULL REFERENCES profile_groups(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name       TEXT NOT NULL,          -- e.g. "planner", "reviewer"
  model_override   TEXT,                   -- nullable; falls back to profile.default_model
  reasoning_level  TEXT,                   -- nullable; falls back to spawn default 'medium'
  PRIMARY KEY (profile_group_id, position)
);
