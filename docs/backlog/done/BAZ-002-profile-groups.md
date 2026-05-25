---
id: BAZ-002
title: Profile Groups — preconfigured team templates
status: done
size: M (≈1 week)
created: 2026-05-23
refined: 2026-05-24
shipped: 2026-05-25
release: v0.2.0
pr: 1
note: Additive feature — single-profile spawn is untouched. Profile groups bundle existing primitives (profiles, groups, spawn), they don't replace them.
---

# BAZ-002 — Profile Groups — preconfigured team templates

**Status:** Backlog (draft). Today a `Profile` ([packages/api-types/src/entities.ts:26](../../../packages/api-types/src/entities.ts)) is a single-agent template — SOUL.md + IDENTITY.md + `defaultModel` + `skillsMode` — and `spawnAgent` ([apps/daemon/src/core/agent/spawn.ts](../../../apps/daemon/src/core/agent/spawn.ts)) is invoked once per agent via `POST /api/agents`. There is no notion of "team", "squad", "preset", or "bundle" anywhere in the daemon. Standing up a new project means manually spawning each agent, picking a profile, naming it, and assigning a group — for a four-to-six-agent team that's a fifteen-minute click-fest the operator repeats verbatim every project. This BAZ adds a `ProfileGroup` entity that captures the recipe once and replays it with one call.

**Dependency:** None. Sits entirely on top of the existing `profiles`, `groups`, and `agents` tables; the existing single-profile spawn flow is untouched.

## User stories

- **As an operator standing up a new project**, I want to pick a saved profile group and have Bazilion create the group + spawn the whole team in one action, so I don't repeat the four-to-six manual `agent create` clicks every time and I get a consistent roster across projects.
- **As an operator with a roster I tuned over months**, I want to save my current team's composition (profile per member, agent names, model overrides) as a reusable template, so the next project starts from my tuned setup instead of from scratch.
- **As an operator who hit a partial-spawn failure**, I want spawning a profile group to be atomic — if member 4 of 6 fails (provider error, name collision, disk full), the first three agents are rolled back so I don't have to manually clean up a half-populated group.

## Goal

Ship a `ProfileGroup` entity (DB + routes + CLI + web UI) that:

- Holds an ordered list of members, each pointing at an existing profile with optional per-member overrides (`agent_name`, `model_override`, `reasoning_level`).
- Optionally seeds the target group with a starter `USER.md`.
- Spawns the whole team transactionally when invoked, against either a new group (created on the fly) or an existing empty group.
- Has CLI/web parity (mandatory per CLAUDE.md — every endpoint surfaced in both).

**Strict additivity:** the existing `POST /api/agents` single-spawn path stays exactly as it is. Profile groups are a new resource, not a refactor of profiles.

## Why now

Two pressures converge:

1. **Operator workflow friction** — every project starts with the same handful of agents (planner + implementer + reviewer + sometimes a dedicated docs-writer), assembled by hand each time. The team is stable; the spawn ritual is not.
2. **Setup-flow alignment** — `ensureSetupSeeded` ([apps/daemon/src/lib/ctx.ts](../../../apps/daemon/src/lib/ctx.ts)) already creates a `default` profile + `default` group at first run. A "default team" profile group is the natural next step in the first-run setup story and gives new operators something to spawn into immediately instead of a single bare agent.

Doing this now also locks in a clean answer to "what does it mean to spawn multiple agents" *before* heavier multi-agent features (cross-agent triggers, role-based handoffs, A2A federation per [BAZ-001](BAZ-001-a2a-federation-spike.md)) ossify a different shape.

## Scope

### Data model

Two new tables in a new migration `apps/daemon/src/core/db/migrations/0002_profile_groups.sql`:

```sql
CREATE TABLE profile_groups (
  id              TEXT PRIMARY KEY,        -- slug, e.g. "platform-team"
  name            TEXT NOT NULL,           -- display name
  user_md         TEXT,                    -- optional starter USER.md seeded only into a freshly-created target group
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE profile_group_members (
  profile_group_id TEXT NOT NULL REFERENCES profile_groups(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,       -- spawn order, used for deterministic UI + atomic rollback
  profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  agent_name       TEXT NOT NULL,          -- e.g. "planner", "reviewer"
  model_override   TEXT,                   -- nullable; falls back to profile.defaultModel
  reasoning_level  TEXT,                   -- nullable; falls back to spawn default 'medium'
  PRIMARY KEY (profile_group_id, position)
);
```

`ON DELETE RESTRICT` on `profile_id` prevents the operator from deleting a profile that a profile-group member still references — the existing single-profile delete keeps working unchanged.

### Repo + ops layer

- New file `apps/daemon/src/core/profile-group/repo.ts` mirroring the existing `profileRepo` shape: `get(id)`, `list()`, `insert(row)`, `update(id, patch)`, `delete(id)`, `members(id)` (returns members in `position` order).
- New file `apps/daemon/src/core/profile-group/spawn.ts` exposing `spawnProfileGroup(db, paths, { profile_group_id, group_slug?, user_md? })`. Internally:
  1. Resolve all members up front; validate every `profile_id` still exists. Bail with a structured error before touching the filesystem if any are missing.
  2. Open a DB transaction.
  3. If `group_slug` doesn't exist, create the group (real dir, not symlinked — `--link` stays a separate per-group operation).
  4. Seed `groups.user_md` from the member's `user_md` if the target group's column is currently null. Never overwrite a non-null existing `user_md`.
  5. For each member in order, call the existing `spawnAgent(...)` with the member's overrides. Collect the returned agent IDs in an array.
  6. Commit the transaction.
  7. **On any failure mid-loop:** rollback the DB transaction AND delete every `~/.bazilion/agents/<id>/` directory created so far (these were created outside the DB transaction by `spawnAgent`'s file ops). The directory cleanup retries with backoff (3 attempts, 100ms / 500ms / 2s) before giving up. If cleanup still fails after retries, log the orphan IDs and include them in the thrown error so the route surfaces them to the operator. Throw the original spawn error (cleanup failure is logged but doesn't replace the root cause).

### Routes (`apps/daemon/src/routes/profile-groups.ts`)

- `GET /api/profile-groups` — list (id, name, member count).
- `GET /api/profile-groups/:id` — detail with member array.
- `POST /api/profile-groups` — create.
- `PATCH /api/profile-groups/:id` — update name / user_md.
- `PUT /api/profile-groups/:id/members` — replace the full member array atomically (simpler than per-member CRUD; the web UI builds the array client-side and PUTs it).
- `DELETE /api/profile-groups/:id` — delete the template. Does NOT touch agents previously spawned from it.
- `POST /api/profile-groups/:id/spawn` — body `{ group_slug?: string, user_md?: string }`. Returns `{ group_slug, agents: [{ id, name }, ...] }`. The response includes the *final* agent names (post-suffixing — see "Name collisions" below) so the caller sees what was actually created.

### Name collisions

Member `agent_name` values are templates, not guarantees. At spawn time, we resolve each member's name to a unique final name within the target group by appending a numeric suffix when needed:

1. Build the set of existing agent names already in the target group.
2. For each member in `position` order: if its `agent_name` is taken (either by an existing agent in the group, or by a name already assigned earlier in this spawn), append `-2`, `-3`, ... until unique; otherwise use the bare name.

So a template with two `reviewer` members, spawned into an empty group, produces `reviewer` + `reviewer-2`. Spawned into a group that already has a `reviewer`, the same template produces `reviewer-2` + `reviewer-3`. Duplicate member names within the template are intentionally NOT rejected at PUT time — they're a valid way to say "give me two reviewers, auto-name them".

### CLI (`apps/cli/src/commands/profile-group.ts`)

Mirror the existing `bazilion profile` shape:

- `bazilion profile-group create <id> --name <name> [--user-md-file <path>]`
- `bazilion profile-group list`
- `bazilion profile-group show <id>` (renders members as a table)
- `bazilion profile-group edit <id>` (opens member array as JSON in `$EDITOR`; PUT on save)
- `bazilion profile-group delete <id>`
- `bazilion profile-group spawn <id> [--group <slug>] [--user-md-file <path>]` (prints created agent IDs to stdout)

### Web (`apps/web/src/routes/profile-groups/`)

- `index.tsx` — list with member count + "Spawn team" button per row.
- `$id.tsx` — detail page with two cards:
  - **Basics:** name, USER.md textarea.
  - **Members:** drag-to-reorder list (reuse the existing skill-list dnd-kit pattern if present, else `@dnd-kit/sortable`). Each member row: profile picker (from existing `/profiles` data), agent name input, model override picker (optional), reasoning level picker (optional). "Add member" appends to the bottom.
- "Spawn team" CTA on the index row → modal prompting for target group slug (picked from existing groups via datalist or typed for a new one) → POST `/spawn` → redirect to `/groups/:slug` showing the newly populated roster.
- "Spawn team from template" CTA on `/groups/:slug` when the group is empty.

### First-run seeding

**Not in scope.** Profile groups are an advanced, personal-to-the-operator feature; a one-size-fits-all default team would be misleading and would clutter the first-run welcome flow. First-run continues to seed only the `default` profile + `default` group (existing behavior). Once profile groups ship, the welcome page can link to `/profile-groups` as a "build your team" CTA, but no template is auto-created.

## Out of scope

- **Cross-agent triggers / handoffs at spawn time.** A profile group spawns N agents; whether they then talk to each other on a schedule is the heartbeat/triggers domain — covered by `agent_triggers` ([apps/daemon/src/lib/scheduler.ts](../../../apps/daemon/src/lib/scheduler.ts)), not here.
- **Template versioning.** Editing a profile group does NOT retroactively affect already-spawned teams; the spawn is a snapshot at point of invocation. No version column, no "upgrade existing team" flow.
- **Per-member `skills` overrides.** Members inherit the profile's `skillsMode` ('all' or 'selected') verbatim. Per-agent skill tweaks happen post-spawn via `bazilion agent skill add/rm` (the existing surface), not via profile-group members — keeps the member row narrow.
- **Marketplace / shareable export.** JSON export via `bazilion profile-group show --json` is fine (and falls out of the CLI surface anyway). A registry / `bazilion profile-group install <url>` is a separate BAZ if it ever happens.
- **Mobile UI.** The mobile app's agent list ([apps/mobile/app/agents/index.tsx](../../../apps/mobile/app/agents/index.tsx)) doesn't even create agents yet; profile-group spawn from mobile is deferred until single-agent spawn lands there.
- **Cancelling a partial spawn mid-flight.** The spawn loop is short (seconds, not minutes); no `POST /api/profile-groups/:id/spawn/cancel`. If a single `spawnAgent` call hangs, that's the existing `agent cancel` surface's problem.

## Decisions (resolved 2026-05-24)

1. **No default-team seeding.** Profile groups are an advanced, personal-to-the-operator feature; a generic seeded team would be misleading. First-run continues to seed only the `default` profile + `default` group as today.
2. **Atomic-rollback cleanup retries with backoff** — 3 attempts at 100ms / 500ms / 2s before giving up. On exhaustion, log the orphan agent IDs and include them in the thrown error so the route response surfaces them to the operator; the original spawn error remains the root cause.
3. **Name collisions auto-suffix with a numeric counter** at spawn time (`reviewer`, `reviewer-2`, `reviewer-3`, ...). Duplicates within a template are accepted at PUT time — they're a valid way to ask for N copies. Suffixing also resolves collisions with agents already in the target group. See "Name collisions" under Routes.
4. **No `group_slug_hint` column.** Originally specced as a "suggestion" prefill, but in practice every spawn flow either has a contextual target (the group-detail CTA) or none at all (the index-page modal) — a per-template default added clutter for marginal benefit. The spawn op's slug fallback chain is now `input.groupSlug ?? DEFAULT_GROUP_ID`.
5. **USER.md is only seeded when the target group's `user_md` is `NULL`.** Empty string `''` is treated as "operator explicitly cleared this" and left alone.

## Deliverable

A working profile-group lifecycle end-to-end, with both surfaces:

- Operator can `bazilion profile-group create platform-team --name "Platform Team"` then `bazilion profile-group spawn platform-team --group acme-project` and end up with N agents inside `acme-project`'s group, named per the member config.
- Operator can do the same from the web UI: build the template on `/profile-groups/<id>`, click "Spawn team" from `/groups/<slug>`, see the roster fill.

## Tests

- **Repo unit tests** (`apps/daemon/test/core/profile-group.test.ts`):
  - `insert` + `get` round-trip including member ordering.
  - `update` doesn't drop members; PUT-replace semantics work for adds, removes, and reorderings.
  - `delete` cascades to members but doesn't touch profiles.
  - `ON DELETE RESTRICT` on `profile_id`: deleting a profile that a member references fails with the expected SQLite error.
- **Spawn integration test** (`apps/daemon/test/core/profile-group-spawn.test.ts`):
  - Happy path: spawn into a new group → N agents created, all in the right group, names match members, model overrides applied where set.
  - Atomic rollback: inject a failure at member 3 of 4 (mock `spawnAgent` to throw on the third call) → assert 0 agent rows exist after, 0 agent dirs exist on disk, target group either doesn't exist (if newly created) or exists but is empty (if pre-existing).
  - USER.md seeding: `user_md` populates a target group whose `user_md` IS NULL; the same call against a target group with non-null `user_md` (including `''`) leaves the existing value untouched.
  - Name-suffix resolution: a template with two `reviewer` members spawned into an empty group yields `reviewer` + `reviewer-2`; spawned into a group that already contains `reviewer`, yields `reviewer-2` + `reviewer-3`. Response payload reflects the final names.
  - Rollback retry: simulate a transient `rmdir EBUSY` on the first attempt, succeed on the second — assert cleanup completes and no orphan IDs appear in the error.
- **Route tests** (`apps/daemon/test/routes/profile-groups.test.ts`):
  - Full CRUD + `/spawn` happy path against the in-memory test daemon.
  - `DELETE /api/profile-groups/:id` returns 404 for unknown id, succeeds for existing, leaves previously-spawned agents intact.
- **CLI smoke test** — at minimum `bazilion profile-group list` + `show` against a seeded fixture, since the CLI is the support surface when the web UI breaks.
- **Web e2e (optional, ship without if dev-only):** Playwright pass: create profile group → add 2 members → spawn into new group → assert agent count on `/groups/<slug>` matches.
- **First-run regression:** `apps/daemon/test/lib/ctx-bootstrap.test.ts` — confirm the pre-existing `default` profile + `default` group seeding still works and that NO `default-team` profile group is created (negative assertion, since we explicitly decided not to seed one).

## As-built (2026-05-25, shipped in v0.2.0 / PR #1)

Landed pretty close to the plan. Notable deltas:

- **`slots` → `members` rename mid-PR.** Originally specced as "slots" (since the column held an ordered list of template positions). Renamed everywhere — DB columns, repo functions, wire types, route bodies, UI labels — once it became clear that "members" reads better in product copy ("a profile group has 3 members" vs "3 slots"). Migration `0002_profile_groups.sql` was edited in place rather than chained, since the project is alpha and we wipe DBs on shape changes.
- **`groupSlugHint` dropped entirely.** The plan retained it as an optional "suggested target group" per template. In practice every spawn surface either has a contextual target (the group-detail CTA passes the current slug) or none at all (the index-page modal asks the user); a per-template default added clutter for marginal benefit. The spawn op's slug fallback chain landed as `input.groupSlug ?? DEFAULT_GROUP_ID`.
- **USER.md seeding semantics simplified.** Decision #5 was originally "overwrite only when target's `user_md` is `null`". The implementation lands as "seed only when `groupCreated === true` during this spawn call" — the `groups.user_md` column is `TEXT NOT NULL DEFAULT ''`, so we can't reliably distinguish "never set" from "cleared". The new constraint is simpler and matches the operator's mental model: "USER.md from the template fills in only when the group is created on the fly".
- **`rmWithRetry` extracted to its own module.** Originally inlined into `spawnProfileGroup`'s catch path. Vitest's `vi.spyOn` doesn't work on ESM exports (`Cannot redefine property: rmSync`), so the retry helper was lifted into `apps/daemon/src/core/profile-group/rm-with-retry.ts` with dependency-injected `rm` + `sleep` and unit-tested with fakes. Side benefit: explicit `DEFAULT_RM_RETRY_DELAYS_MS = [100, 500, 2000]` constant lives next to the code that uses it.
- **Web UI: "templates" tab merge.** Not in the original plan. Profiles and Profile Groups both ship under a single top-nav `templates` entry with a sub-tab strip (`apps/web/src/components/TemplatesTabs.tsx`), keeping the nav from sprawling.
- **Sidebar `+ new ▾` rework.** Not in the original plan. Two labeled sections — "spawn agent from template" (profiles) and "spawn group from template" (profile groups) — replace the old single "spawn from profile" list. The earlier "manage agents →" / "manage groups →" footer links were dropped (top-nav already covers them).
- **Friendly profile-delete error.** Discovered during end-to-end testing: deleting a profile still referenced by a profile-group member produced a raw `FOREIGN KEY constraint failed` and the web UI silently dropped it. Added a pre-check in `deleteProfile` (mirroring the existing agents pre-check) + `findReferencingProfile` helper on the repo, and `alert()` on `res.ok === false` in the web `del()` handler.
- **Shared `<Button>` component.** Discovered during end-to-end testing: the "save members" button was a bare `<button type="button">` with no className, which falls through to Tailwind preflight and renders unstyled (`styles.css:282` only opt-styles `button[type='submit']` or `.btn-primary`). Fixed by extracting `apps/web/src/components/Button.tsx` with `variant="primary|ghost|danger"` and migrating the touched files. Remaining files convert opportunistically — every PR from here on should use the component.
- **Theme flash bug fix.** Discovered mid-cycle, unrelated to BAZ-002 but blocking smooth testing. Shipped as its own PR (#2, `fix/theme-flash-on-nav`) and merged into main, then merged back into the BAZ-002 branch.

What landed exactly as planned:

- Schema (`profile_groups` + `profile_group_members` with RESTRICT on `profile_id`, CASCADE on `profile_group_id`).
- Full HTTP surface: `GET|POST|PATCH|DELETE /api/profile-groups`, `PUT /api/profile-groups/:id/members`, `POST /api/profile-groups/:id/spawn`.
- CLI parity: `bazilion profile-group create|list|show|update|edit|delete|spawn`.
- Atomic spawn: pre-flight validates all `profileId`s, transactional insert, dir-diff orphan scan on failure with retry-with-backoff cleanup.
- Auto-suffix algorithm: `webby` → `webby-2` → `webby-3` on re-spawn; verified end-to-end against the running daemon.
- Group auto-create on spawn when target slug doesn't exist; verified with `auto-cta-fresh` smoke test.
- Test coverage: 32 unit/integration tests across `profile-group.test.ts` + `profile-group-spawn.test.ts` + `rm-with-retry.test.ts` + `ctx-bootstrap.test.ts` (no default-team seeding).
