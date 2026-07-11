---
id: BAZ-015
title: Revisioned Team-template, Group-policy, and Agent lifecycle APIs
status: done
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
shipped: 2026-07-11
note: Complete the second half of BAZ-010 with custom revisioned policy APIs, stable-slot operations, explicit placement, adoption/re-baselining, source workflows, and atomic Agent membership lifecycle.
---

# BAZ-015 - Revisioned Team-template, Group-policy, and Agent lifecycle APIs

**Status:** Refined and ready after BAZ-010. ADR 0001 is normative.

## User stories

- **As an operator**, I want canonical APIs for the one Team-template roster and each
  Group's sole policy, so every client edits the same revisioned aggregates.
- **As a template editor**, I want stable-slot clone, adoption, diff, and source-update
  semantics, so repeated Profiles and concurrent edits never retarget an edge silently.
- **As an operator changing membership**, I want spawn, move, archive, and delete to update
  membership, policy, lineage, files, and revisions atomically.

## Goal

Build the custom/revisioned mutation and lifecycle layer on BAZ-010's canonical storage.
This story still does not enforce communication at runtime.

## Canonical API surface

| Endpoint | Contract |
|---|---|
| `GET/POST /api/harness-templates` | List/create Team templates |
| `GET/PATCH/DELETE /api/harness-templates/:id` | Read/revision-update/delete or tombstone metadata |
| `PUT /api/harness-templates/:id/definition` | Atomically update slots and explicit policy with expected revision |
| `POST /api/harness-templates/:id/clone` | Require `templateExpectedRevision`; allocate independent template/slot ids from that immutable definition and translate edges |
| `POST /api/harness-templates/:id/spawn` | Require `templateExpectedRevision` plus target Group revision when applicable; initialize or append that reviewed cohort |
| `GET /api/groups/:groupId/harness` | Resolve sole policy, roster projection, baseline/cohorts, and revision |
| `PUT /api/groups/:groupId/harness/policy` | Replace reviewed live edges with expected revision |
| `POST /api/groups/:groupId/harness/adopt-template` | Require Group and `templateExpectedRevision`; full reviewed rebaseline with explicit slot mapping |
| `GET /api/groups/:groupId/harness/diff` | Compare live state, immutable baseline revision, and current source |
| `POST /api/groups/:groupId/harness/update-source` | Promote reviewed live diff when source has not diverged |
| `POST /api/groups/:groupId/harness/save-as-template` | Snapshot current membership/policy into independent ids |

There is no `/api/harnesses`, detached live-harness CRUD, or caller-supplied authoritative
harness id.

Permanent Agent/Group URLs gain additive canonical fields:

- `POST /api/agents`: `groupExpectedRevision` and explicit `placement`.
- `PATCH /api/agents/:id/group`: source/destination expected revisions and destination
  placement.
- `DELETE /api/agents/:id?expectedGroupRevision=N`.
- `DELETE /api/groups/:id?expectedHarnessRevision=N`.
- Archive/unarchive retain the old payload because topology/revision is unchanged.

Every mutation returns the fully resolved aggregate. Stale expected revisions return 409
with current revision/state and change nothing. The bounded BAZ-010 omitted-field adapters
remain for one release.

Every operation that materializes a template snapshot—clone, new/existing spawn, append,
and adoption—requires the reviewed current `templateExpectedRevision`. A source edit of
slots, Profiles, overrides, roles, layout, or edges returns
`409 template_revision_conflict`, even if the resulting edge preview happens to be equal.

## Stable-slot and source contract

- Server UUIDs survive reorder, Profile/name/role/layout edits, and incident-edge edits.
  Remove/re-add, clone, and save-as-template allocate new ids and translate edges.
- Every template mutation appends one immutable full definition snapshot with its revision.
- The first canonical definition mutation permanently clears the template's
  `compatibility_managed` flag; metadata-only rename does not.
- Canonical Team create, clone, and save-as-template always create
  `compatibility_managed=false`, even when their source was compatible; no canonical action
  re-enables the flag.
- Spawn binds every source slot explicitly to the new Agent created from it.
- A LiveHarness's only baseline authority is `baseline_instantiation_id`; current template
  id/revision derive from that row. Additional appends are cohorts.
- Adoption requires a total injective map from every active source slot to a distinct
  current Group Agent. Idle and archived Agents may map. Every remaining Agent receives a
  reviewed isolated/open/profile-default placement; no order/Profile/name/role inference is
  permitted. Mapped slots alone use template_snapshot.
- Adoption is a full rebaseline: replace live edges, prior current instantiations/bindings,
  and baseline pointer with the translated snapshot plus deterministic placement expansion.
- Source update requires live/template expected revisions and current template revision
  equal to the retained baseline revision. Otherwise return `409 source_diverged`; never
  auto-merge. Success writes template revision + 1, repoints the baseline, bumps live
  revision once, and leaves live edges unchanged.
- When source update explicitly includes an Agent currently bound to an append cohort, it
  allocates that Agent's new baseline slot, transfers its unique binding to the baseline
  instantiation/revision, and prunes the old cohort only if no bindings remain. Nonincluded
  cohort Agents keep their cohort bindings.
- Save-as-template snapshots every current Group Agent including archived into new slots;
  archived status is not copied, so future spawn creates normal Agents. It does not change
  the live baseline.

## Placement and mode transitions

Canonical placement is `isolated`, `open`, `profile_defaults`, or `template_snapshot`.
Placement materializes explicit edges; it is never evaluator-time inheritance.

- Direct `open` adds all four boundary directions plus both directions with each current
  member. Direct `isolated` adds none.
- `profile_defaults` starts isolated; boundary booleans add their exact edges,
  `allow_all` adds both peer directions, and deny_all/inherit/absence add none.
- Team snapshot translates reviewed template edges exactly.
- For adoption's multiple live-only Agents, own placement controls boundary edges. Open or
  allow_all requests both directions with mapped Agents; two live-only Agents connect only
  when both request peer access. The request carries the resolved preview and the daemon
  recomputes it before commit.

Every canonical policy or membership mutation permanently changes each affected Group to
`explicit`: policy save, spawn/init/append, adopt, both sides of move, and hard delete.
Archive/unarchive do not. A Group never returns automatically to `compatibility_open`.

## Lifecycle truth table

| Operation | Atomic behavior |
|---|---|
| New Group Team spawn | Require reviewed template revision; create final initialized LiveHarness at revision 1, all Agents/bindings/exact snapshot, baseline pointer, starter USER.md, explicit mode |
| Existing empty uninitialized Group | Require Group/template expected revisions and null baseline; preserve USER.md; initialize and finish at N+1 |
| Append with members or retained baseline | Require append plus Group/template expected revisions; preserve baseline/topology, add cohort internal/boundary edges only, no implicit cross-cohort peers; N+1 |
| Empty Group with retained baseline | Not uninitialized; initialize returns `409 baseline_replacement_required`; append or explicit adopt |
| Direct Agent spawn | Expected revision + placement; add Agent/live state/edges, no source binding; explicit; N+1 |
| Adopt/rebaseline | Group/template expected revisions; roster-neutral total injective mapping + remaining placements; replace policy/current lineage/baseline; explicit; N+1 |
| Move G1 -> G2 | Shared turn/lifecycle guard; both revisions + placement; remove source edges/binding, prune empty nonbaseline cohort but retain baseline, update `group_id` and `agent.json`, add destination state/edges; both explicit and N+1 |
| Archive/unarchive | Reject archive during active turn; retain membership/edges/lineage; status changes only; no live bump |
| Hard delete Agent | Shared turn/lifecycle guard; remove state/binding/edges, prune empty nonbaseline cohort but retain baseline, explicit and N+1, then purge existing dependents/home |
| Delete Group | Expected revision and zero Agents including archived; cascade inseparable live aggregate; immutable future block snapshots survive |
| Delete Team template | Hard-delete if no lineage; otherwise tombstone as read-only lineage display; definition edit, clone, spawn/append, adopt/rebaseline, legacy spawn, and update-source return `410 template_deleted`; live snapshots unchanged |
| Delete Profile | `409 profile_in_use` while any Agent including archived or any current/immutable retained slot refers; never cascade |

Move, archive, and hard delete use BAZ-010's shared turn/lifecycle lease and reject while an
Agent turn is active; cancellation must settle before retry. Filesystem effects use the
existing snapshot/cleanup pattern. All
database/filesystem failure and revision-conflict paths restore membership, policy,
lineage, and files together.

## Out of scope

- Runtime authorization/enforcement/audit (BAZ-011/016).
- Web navigation/editor migration (BAZ-012/017) and CLI policy commands (BAZ-013).
- Approvals, workflows, routing, retries, federation, or multi-Group membership.

## Acceptance criteria

- Every canonical route implements the ADR shapes and validates endpoint domains, Group
  membership, self/boundary edges, stable ids, Group/template expected revisions, and source
  snapshots.
- Reorder, repeated Profiles, edit, remove/re-add, clone, spawn, adoption, update-source,
  and save-as-template preserve or allocate slot ids exactly as specified.
- Immutable snapshots reproduce any retained baseline/cohort revision after later edits.
- New/existing-empty initialization, append, direct spawn, rebaseline, move,
  archive/unarchive, Agent delete, Group delete, and Profile/template delete match the truth
  table under success, conflict, active turn, validation failure, and filesystem failure.
- Each affected aggregate bumps exactly once; new initialized Group ends at revision 1;
  archive/unarchive and save-as-template do not bump live revision; source update bumps both
  template and live once without changing live edges.
- Canonical membership/policy mutation can never leave or restore compatibility_open.
- A final moved/deleted binding prunes an empty cohort but retains an empty baseline; no
  second baseline or second Agent binding exists.
- update-source transfers explicitly included cohort bindings to new baseline slots,
  preserves nonincluded cohort bindings, and prunes only cohorts made empty by transfer.
- Legacy adapters continue only their bounded exact-Open behavior and return structured
  migration/placement/revision conflicts for explicit/customized state.
- No route in this story blocks runtime communication.

## Tests and verification

- Domain/repository tests for revision snapshots, stable slots/tombstones, one baseline,
  one binding per Agent, endpoint validation, placements, diffs, source divergence, clone,
  and save-as-template.
- Lifecycle matrix including two-Group move atomicity, empty retained baseline, archived
  membership, active-turn guard, filesystem rollback, mode transitions, and exact bumps.
- Route/client tests for auth, validation, fully resolved responses, stale conflicts,
  permanent Agent URLs, and one-release legacy payloads.
- Full repository suite, root/web typechecks, lint, and build.

## As-built (2026-07-11, unreleased)

BAZ-015 completed the custom/revisioned API and lifecycle layer on the sole BAZ-010
Team-template roster and per-Group live policy:

- Added authenticated canonical Team-template list/create/read/metadata/delete,
  stable-slot definition, clone, and reviewed spawn endpoints under
  `/api/harness-templates`. New slots use request-local `clientKey` references and
  server-allocated UUIDs; reorder/edit retains stable ids, removal tombstones, re-add and
  clone allocate independent ids, and every definition/metadata mutation appends one full
  immutable revision snapshot. The first canonical definition write permanently clears
  legacy compatibility management. Lineage-free delete is hard; retained lineage produces
  a read-only tombstone and all materializing/source operations return `410
  template_deleted`.
- Added the sole resolved Group-policy projection and revisioned policy replacement under
  `/api/groups/:id/harness`. Reads include the archived-inclusive authoritative Agent
  roster, live edges and presentation state, all retained instantiations/bindings, and the
  one baseline. Writes validate endpoint kinds, membership, self/boundary paths,
  duplicates, and expected revision, then permanently enter explicit mode with one bump.
- Added reviewed Team initialize/append. A new Group finishes initialized at revision 1;
  existing empty/uninitialized Groups require initialize and preserve USER.md; an empty
  retained baseline requires explicit replacement; append preserves baseline and existing
  topology, adds only the reviewed cohort snapshot/bindings, and creates no implicit
  cross-cohort peers. Every source materialization pins the reviewed current template
  revision transactionally and cleans database plus filesystem diffs on failure.
- Added roster-neutral adopt/rebaseline with total injective stable-slot mapping, one
  explicit placement for every remaining Agent, and daemon-recomputed preview equality.
  Template edges translate exactly; open/profile-default live-only placement expands
  deterministically; two live-only peers connect only when both request peer access. The
  operation replaces current lineage/policy, establishes exactly one baseline, enters
  explicit mode, and bumps once.
- Added semantic diff, update-source, and save-as-template. Diff compares live edges with
  the retained immutable baseline and reports current-source slot divergence. Source
  promotion rejects divergence, retains baseline slot order/ids, allocates new ids for
  explicitly included cohort/direct Agents, transfers their unique bindings, preserves
  nonincluded cohorts, prunes only cohorts emptied by transfer, advances source and live
  once, and leaves live edges unchanged. Save-as-template copies every current Agent
  including archived membership, policy, and presentation into independent revision-1
  slots without changing the live baseline/revision.
- Extended permanent Agent/Group lifecycle URLs with explicit placement and expected
  revision fields. Direct spawn materializes isolated/open/Profile-default edges and bumps
  once. Two-Group move runs under the shared turn/lifecycle lease, atomically removes the
  source edge/state/binding, prunes an empty nonbaseline cohort while retaining a baseline,
  updates `agents.group_id` plus `agent.json`, places at the destination, and bumps both
  Groups once. Revisioned Agent and Group deletion stage filesystem slots, restore them on
  SQL/conflict failure, retain empty baselines, and permanently enter explicit mode where
  applicable. Archive/unarchive retain membership, policy, lineage, and revision.
- Kept the one-release omitted-field adapters bounded to exact Open compatibility state.
  No canonical mutation restores `compatibility_open`; customized legacy Team/Group
  surfaces continue returning the structured migration, placement, revision, or merge
  conflicts defined by the ADR.
- Added hermetic canonical request/response types and resolved aggregate shapes in
  `@bazilion/api-types`. No `/api/harnesses`, detached live harness, caller-authoritative
  harness id, runtime communication authorization, audit event, workflow execution,
  production UI, CLI policy tooling, or approval behavior was introduced.

Verification completed:

- Focused authenticated route/domain/lifecycle tests pass for stable ids and repeated
  Profiles, immutable snapshots, clone independence, invalid endpoint rollback, explicit
  policy replacement, direct placement, revision conflicts, new initialization, append
  cohort isolation, adoption preview/mapping, save-as-template, source transfer/divergence,
  two-Group move, Agent delete, and Group delete.
- `pnpm test`: 86 test files and 687 tests passed.
- `pnpm typecheck`, `pnpm --filter @bazilion/web typecheck`, and
  `pnpm --filter @bazilion/mobile typecheck` passed.
- `pnpm lint` passed with no errors; 41 existing warnings and two Biome configuration
  notices remain outside this story.
- `pnpm build` passed, including the production web, daemon, worker, CLI, API-types, and
  client bundles. Existing TanStack `inputValidator()` deprecation notices remain
  unrelated.
