---
id: BAZ-010
title: Canonical harness storage and compatibility migration
status: todo
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Establish canonical Team-template and one-per-Group policy storage, migrate and remove legacy Profile Group tables, and preserve exact Open Team behavior through bounded adapters. Explicit policy/lifecycle APIs continue in BAZ-015.
---

# BAZ-010 - Canonical harness storage and compatibility migration

**Status:** Refined and ready after BAZ-009. ADR 0001 is normative. This is the first half
of the former XL persistence story; BAZ-015 owns revisioned policy and lifecycle APIs.

## User stories

- **As an existing operator**, I want Profile Groups and Groups migrated without changing
  communication behavior, so the production ownership model can land safely.
- **As a template editor**, I want server-generated stable slot ids and immutable revision
  snapshots, so later policy work has reproducible identities and baselines.
- **As a maintainer**, I want legacy APIs backed only by canonical tables, so there is no
  dual-write or second roster to reconcile.

## Goal

Create the canonical storage and one-release migration foundation from
[ADR 0001](../../adr/0001-production-harness-domain.md), while runtime remains unenforced.

> There is one canonical Team/Harness Template roster, exactly one effective live policy
> per Group, and `agents.group_id` is the sole live-membership authority.

## Scope

- Add hermetic wire types and normalized repositories for Team templates, current stable
  slots/edges, immutable full definition snapshots by revision, optional Profile
  communication defaults, one LiveHarness keyed by Group id, live edges, current
  baseline/cohort instantiations, unique-per-Agent source bindings, and optional live
  presentation state.
- Persist `harness_templates.compatibility_managed` and
  `live_harnesses.membership_mode`. Neither flag is an authorizer bypass.
- Add Profile create/detail/update support for optional communication defaults: create
  omission means no row, PATCH omission leaves unchanged, and explicit null clears.
- Make standalone Group creation create an empty compatibility_open LiveHarness at revision
  1 in the same transaction.
- Add compatibility-safe domain wrappers for existing Agent spawn/move/delete and Group
  delete payloads so every migrated Group remains exact Open Team. Missing revisions are
  allowed only while all affected Groups are compatibility_open; explicit Groups return
  the ADR's structured 409 errors.
- Add the shared per-Agent turn/lifecycle lease and route all current turn registration plus
  compatibility move/archive/delete through it, closing the active-check-to-mutation race
  before later stories add authorization.
- Migrate Profile Group CRUD/spawn and CLI commands to one-release adapters over canonical
  Team-template storage. Responses include deprecation/sunset/successor metadata.
- Do not expose custom live-policy mutation, adoption, source update, or runtime enforcement
  in this story.

## Atomic migration

| Existing state | Canonical result |
|---|---|
| `profile_groups` | Same-id Team template, metadata/timestamps, revision 1, `compatibility_managed=true` |
| `profile_group_members` | One opaque UUID slot per row; preserve Profile, name, overrides, and ordinal |
| Missing template policy | Exact Open Team current edges and immutable revision-1 snapshot |
| Profiles | Preserve; no defaults row is invented because prior production defaults do not exist |
| Groups | Exactly one LiveHarness revision 1, `compatibility_open`, null baseline pointer |
| Existing Agents including archived | Preserve `agents.group_id`; no source binding; materialize exact Open Team live edges |
| Historical Profile Group spawns | No inferred baseline, instantiation, or slot binding |
| BAZ-009 localStorage/simulated blocks | Leave untouched and never import as production state/evidence |

For member set `M`, exact Open Team is every `a -> b` where `a != b`, plus
`user <-> m` and `outside_group <-> m` for each member: `|M|(|M|-1) + 4|M|` edges.

The migration copies and validates in one transaction, then drops the legacy
`profile_groups` and `profile_group_members` tables. Filesystem state is untouched. It
rolls back unless counts match, all stable ids are unique, every current template has its
revision snapshot, every Group has exactly one LiveHarness, every compatibility topology
is exact Open Team, all membership projections agree with `agents.group_id`, and no source
lineage was fabricated.

## Stable slots and revision snapshots

- Slot ids are opaque server UUIDs, never derived from Profile, name, role, or position.
- Reorder/edit retains id. Repeated Profiles have distinct ids. Legacy member replacement
  may edit an existing slot by prior ordinal only while exact Open Team makes the mapping
  unambiguous.
- Remove tombstones a referenced slot; re-add allocates a new id. Unreferenced deleted
  templates/slots may be hard-deleted.
- Every committed template mutation atomically appends a complete immutable validated
  definition snapshot. A current or live-referenced revision cannot be pruned.
- Current bindings are unique by Agent and are lineage only, never membership.
- `live_harnesses.baseline_instantiation_id` is the sole baseline pointer. Template id and
  revision derive from the retained instantiation; migrated Groups begin null.

## One-release compatibility behavior

### Profile Group surfaces

- GET projects canonical Team templates and adds slot/revision fields for upgraded clients.
- POST creates compatibility-managed Open Team plus revision 1.
- PATCH metadata remains available while compatibility-managed.
- Member PUT treats ordinal `i < oldCount` as editing that stable slot, `i >= oldCount` as
  append, and a shorter list as suffix tombstone. Middle insertion/reorder is not
  representable. It regenerates exact Open Team.
- The first canonical definition mutation in BAZ-015 permanently clears
  `compatibility_managed`; later legacy mutations return `409 migration_required`.
- Only migration and legacy POST create the true marker. Canonical create/clone/
  save-as-template in BAZ-015 always create false and never inherit/re-enable it.
- Delete hard-deletes when unreferenced or tombstones when live lineage exists. It never
  mutates a Group.
- Spawn into new/empty-uninitialized establishes the Open baseline and remains
  compatibility_open. Spawn into any other compatibility_open Group, including an empty
  retained-baseline Group, appends a cohort, retains the baseline, regenerates full Open
  Team, and stays compatible. An explicit Group returns `409 policy_merge_required`.
- A tombstoned source is read-only lineage display and legacy spawn returns
  `410 template_deleted`.
- Missing expected revision is a serialized one-release exception while compatibility is
  intact; additive `If-Match` is honored when present.

Legacy spawn reads the compatibility-managed source's current immutable revision in the
same transaction; it never guesses a revision. For a new Group it creates Agents,
instantiation/bindings, baseline pointer, exact Open edges, and the final LiveHarness at
revision 1, and seeds starter USER.md. For an existing empty/uninitialized Group it
preserves USER.md and finishes at N+1. For any other compatible Group it creates a cohort
and bindings, preserves a null or existing baseline and USER.md, regenerates exact Open
over all members including archived, and finishes at N+1. Name collision and filesystem
rollback behavior remains the current Profile Group spawn contract.

### Existing Agent and Group URLs

- `POST /api/agents` without placement/revision serializes on the target
  compatibility_open Group, spawns a live-only Agent, regenerates exact Open Team including
  archived members, and bumps once.
- `PATCH /api/agents/:id/group` without new fields succeeds only when both Groups are
  compatibility_open; it rejects an active turn, atomically removes source binding/edges,
  prunes an empty nonbaseline cohort but retains an empty baseline, updates `group_id` and
  agent.json, adds destination live-only state, regenerates both exact Open topologies, and
  bumps both once.
- Agent hard delete without expected revision succeeds only in compatibility_open, removes
  state/binding/edges, prunes an empty nonbaseline cohort but retains an empty baseline,
  regenerates exact Open Team, bumps once, and then purges current dependents/home. Active
  delete is rejected.
- Group delete without expected revision succeeds only for an empty compatibility_open
  Group and cascades its LiveHarness.
- Archive/unarchive keep their existing payloads, membership, topology, and lineage; active
  archive is rejected and no live revision changes.

These wrappers use the existing filesystem snapshot/cleanup pattern and keep
compatibility_open only because their committed topology remains exact Open Team.

The URLs remain permanent; BAZ-015 adds canonical revision/placement fields to them.

## Out of scope

- Custom Team-template definitions, Group policy CRUD, clone/adopt/diff/update-source,
  explicit placement, and the full lifecycle contract (BAZ-015).
- Runtime authorization, enforcement, or block events (BAZ-011/016).
- Production web migration (BAZ-012/017) and canonical CLI policy tools (BAZ-013).
- Approvals, workflow execution, routing, retries, federation, or multi-Group membership.

## Acceptance criteria

- Migration is atomic, idempotent, filesystem-neutral, and satisfies every postcondition
  before dropping the legacy tables.
- There is exactly one writable Team-template roster, one LiveHarness row per Group, and no
  writable Profile Group or live-member roster.
- Restart preserves all canonical current rows, immutable revision snapshots, stable ids,
  compatibility flags, memberships, and explicit Open edges.
- Existing Profile Group API/CLI CRUD/spawn and Agent/Group lifecycle clients preserve
  exact prior Open Team behavior on migrated Groups using canonical storage only.
- Legacy positional replacement follows the exact ordinal/suffix contract and cannot alter
  a customized template or explicit Group.
- Existing and archived Agents remain in the same Groups; no historical source is guessed.
- Profile defaults are additive and neutral when absent; no runtime inheritance exists.
- Profile deletion returns `409 profile_in_use` while any Agent including archived or any
  current/immutable retained Team slot references it; no cascade changes a roster.
- No path in this story enforces communication or exposes custom live-policy mutation.

## Tests and verification

- Migration fixtures: empty, repeated-member templates, existing/archived Agents, multiple
  Groups, idempotent restart, invariant failure, SQL rollback, and unchanged filesystem.
- Repository tests: one-to-one Group policy, stable ids, exact Open formula, immutable
  revisions/retention, unique current bindings, baseline pointer, tombstones, and Profile
  defaults.
- Turn/lifecycle lease tests proving turn registration orders wholly before or after legacy
  move/archive/delete, including cancellation settlement and filesystem rollback.
- Compatibility tests: every legacy Profile Group and Agent/Group path, additive If-Match,
  serialized concurrency, explicit-state 409s, deprecation headers/warnings, and no legacy
  table access.
- API type/client compilation, full repository suite, root/web typechecks, lint, and build.
