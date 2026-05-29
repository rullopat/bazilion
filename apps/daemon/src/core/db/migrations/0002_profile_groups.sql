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

CREATE TABLE profile_groups (
  id              TEXT PRIMARY KEY,        -- slug, e.g. "platform-team"
  name            TEXT NOT NULL,           -- display name
  user_md         TEXT,                    -- optional starter USER.md; seeded only into a freshly-created target group (pre-existing groups are left alone — see Decision #5)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Member ordering uses an explicit `position` column rather than insertion
-- order so the spawn loop is deterministic and rollback can identify which
-- members succeeded. PK includes position so the same template can have
-- multiple members pointing at the same profile (e.g. "two reviewers" —
-- duplicate agent_name values are intentionally accepted; the spawn op
-- auto-suffixes collisions with `-2`, `-3`, ... at spawn time).
--
-- `ON DELETE RESTRICT` on profile_id prevents deleting a profile that a
-- profile-group member still references; the existing single-profile delete
-- keeps working unchanged because it never had a referrer before.
CREATE TABLE profile_group_members (
  profile_group_id TEXT NOT NULL REFERENCES profile_groups(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name       TEXT NOT NULL,          -- e.g. "planner", "reviewer"
  model_override   TEXT,                   -- nullable; falls back to profile.default_model
  reasoning_level  TEXT,                   -- nullable; falls back to spawn default 'medium'
  PRIMARY KEY (profile_group_id, position)
);
