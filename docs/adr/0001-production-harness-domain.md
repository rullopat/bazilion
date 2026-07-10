# ADR 0001: Production harness domain and migration contract

- **Status:** Accepted
- **Date:** 2026-07-10
- **Owners:** BAZ-010, BAZ-011, BAZ-012, BAZ-015, BAZ-016, BAZ-017
- **Normative detail:** [Harness production implementation handoff](../harness-policy-handoff.md)
- **Prototype reference:** BAZ-009 and `apps/web/src/lib/harness-prototype.ts`

## Context

BAZ-009 validated a directed allow-edge policy and Flow/Matrix editor in browser-local
state. Production needs persistence, runtime enforcement, and a unified web experience
without creating competing Profile Group, Group, and local harness rosters.

The current durable boundary already has one Profile per reusable Agent blueprint, one
Group per workspace/context/memory/integration boundary, and one `agents.group_id` per live
Agent. This ADR extends those concepts rather than adding an independent live harness.

## Decision

> **There is one canonical Team/Harness Template roster. Legacy Profile Groups are a
> one-release compatibility projection, never a second writable roster. Every Group has
> exactly one effective live policy, and `agents.group_id` is the sole live-membership
> authority.**

The product calls a HarnessTemplate a **Team template** and the Group-owned LiveHarness its
**Group policy**. A LiveHarness has no identity or CRUD lifecycle outside its Group.

## Canonical ownership

| Product concept | Domain type | Owns | Never owns |
|---|---|---|---|
| Agent template | Profile | Persona files, model/skills defaults, optional creation-time communication defaults | Membership or live policy |
| Team template | HarnessTemplate | The sole reusable roster, stable slots, starter USER.md, overrides/layout, explicit template policy, immutable revisions | Live Agents or live policy |
| Group | Group | Workspace, context, memory, integrations, and membership through `agents.group_id` | A second template roster |
| Group policy | LiveHarness | One effective edge set, revision, current baseline/cohort lineage, editor state | Independent identity or membership |
| Agent | Agent | One live Profile instance, private home, lifecycle status, exactly one Group | Template-slot identity |

Profile defaults and presets expand into explicit edges only when a template/live snapshot
is created. Boundary false and deny_all remove preset edges; allow_all adds; inherit leaves
preset peer edges unchanged. Missing defaults are neutral. Runtime never inherits them.

## Entity and cardinality diagram

~~~mermaid
erDiagram
    PROFILE ||--o| PROFILE_COMMUNICATION_DEFAULTS : has
    PROFILE ||--o{ HARNESS_TEMPLATE_SLOT : referenced_by
    PROFILE ||--o{ AGENT : instantiates

    HARNESS_TEMPLATE ||--o{ HARNESS_TEMPLATE_SLOT : owns_only_template_roster
    HARNESS_TEMPLATE ||--o{ HARNESS_TEMPLATE_EDGE : owns_current_policy
    HARNESS_TEMPLATE ||--|{ HARNESS_TEMPLATE_REVISION : snapshots
    HARNESS_TEMPLATE_REVISION ||--o{ TEMPLATE_INSTANTIATION : instantiated_as

    GROUP ||--|| LIVE_HARNESS : owns_exactly_one
    GROUP ||--o{ AGENT : membership_via_group_id
    LIVE_HARNESS ||--o{ LIVE_HARNESS_EDGE : owns
    LIVE_HARNESS ||--o{ TEMPLATE_INSTANTIATION : retains_lineage
    LIVE_HARNESS ||--o{ LIVE_AGENT_STATE : projects

    TEMPLATE_INSTANTIATION ||--o{ SOURCE_SLOT_BINDING : maps
    HARNESS_TEMPLATE_SLOT ||--o{ SOURCE_SLOT_BINDING : source
    AGENT ||--o| SOURCE_SLOT_BINDING : current_provenance
    AGENT ||--o| LIVE_AGENT_STATE : decorates
~~~

`live_harnesses.group_id` is both primary and foreign key.
`baseline_instantiation_id` is its sole nullable baseline pointer; template id/revision
derive from that instantiation. Source bindings and live Agent state are current
provenance/presentation projections, unique by Agent, never membership.

## Stable identity and source decisions

- Slot ids are opaque server UUIDs, independent of Profile/name/role/position. Reorder/edit
  retains; remove tombstones while referenced; re-add/clone/save-as-template allocate new
  ids and translate edges. Repeated Profiles have distinct ids.
- Current Team rows are normalized. Every committed mutation also writes one immutable,
  complete validated revision snapshot. Current and live-referenced revisions are retained.
- Clone, spawn/initialize/append, and adopt require `templateExpectedRevision`; any source
  edit returns `409 template_revision_conflict`, even when edges happen to be equal.
- Adoption is a roster-neutral full rebaseline: every active source slot maps injectively to
  a distinct current Group Agent; remaining Agents receive explicit placement; prior current
  lineage/policy is replaced after reviewed preview. No mapping is inferred.
- A Group has at most one baseline; appends are cohorts. Removing the final binding retains
  the baseline, so an empty Group can remain initialized.
- update-source requires current source revision equal to retained baseline or returns
  `409 source_diverged`. Explicitly included cohort Agents transfer their unique binding to
  new baseline slots; only emptied cohorts are pruned. Live edges do not change.
- A tombstoned Team template is read-only lineage display. Definition edit, clone,
  spawn/append, adopt/rebaseline, legacy spawn, and update-source return
  `410 template_deleted`. A Group can recover with save-as-template or another live action.

## Membership and lifecycle decisions

`membership_mode` is a transition aid, not authorization:

- `compatibility_open` permits omitted revision/placement only for deprecated operations
  whose result remains exact Open Team.
- `explicit` rejects omission. Every canonical policy or membership mutation permanently
  switches all affected Groups explicit; archive/unarchive do not because they retain
  membership/topology.

For members `M`, exact Open Team contains every `a -> b` where `a != b`, plus
`user <-> m` and `outside_group <-> m` for each member:
`|M|(|M|-1) + 4|M|` edges, with no self or boundary-to-boundary edge.

All spawn/move/delete operations atomically update `agents.group_id`, live edges, current
lineage, Agent filesystem metadata, and each affected revision exactly once. New Team spawn
creates its final LiveHarness at revision 1; existing mutations finish at N+1.
Archive/unarchive retain membership/edges/lineage and do not bump. Profile delete returns
`409 profile_in_use` while any Agent including archived or any current/immutable retained
slot refers. Group delete requires zero Agents including archived.

BAZ-010 introduces one per-Agent turn/lifecycle lease around current turn registration and
compatibility lifecycle. BAZ-015 consumes it for explicit move/archive/delete; BAZ-016
extends it across authorization and turn start. No mutation can enter an allow-to-worker
registration gap.

The exact operation/revision/placement results are the lifecycle truth table in the
[normative handoff](../harness-policy-handoff.md#lifecycle-implementation-table).

## Authorization decision

One daemon service resolves current status, `agents.group_id`, and one or two Group policies
in one SQLite snapshot:

    authorizeCommunication({
      source,
      target,
      origin,
      attemptKind,
      attemptId
    }) -> {
      decision,
      channel,
      reasonCode,
      reason,
      policyRefs[]
    }

- User -> Agent requires target `user -> Agent`; Agent -> user requires source
  `Agent -> user`.
- Same-Group A -> B requires exact `A -> B`.
- Cross-Group A -> B requires source `A -> outside_group` **and** target
  `outside_group -> B` in one snapshot. One result/event records both components.
- Archived/deleted/missing/nonmember/self/invalid-boundary paths deny before matching.
- Origin is audit-only. Operator history/policy/block reads are not delivery.
- There is no `legacy_open_team` evaluator bypass; compatibility is ordinary stored edges.

The snapshot is the attempt's linearization point. Authorization and database effect or
denial share one write transaction. Trigger fired state and inbox terminal disposition are
atomic with denial audit. External frames/items reauthorize immediately before final send;
already-sent bytes cannot be retracted, but later items observe new policy.

Denials use globally typed `(attempt_kind, attempt_id)` uniqueness and an
operation/source/target fingerprint. Lookup-first returns the original denial; mismatch is
`attempt_key_conflict`; a unique-race loser reloads. Origin is stored from the first
terminal observation but excluded from identity, so Agent read/wait and scheduler share
`inbox:<messageId>`. This is denial-event idempotency, not a new allowed-delivery retry
ledger.

The communication and scheduler authorization truth tables, stable reason codes, and
attempt namespaces are in the
[normative handoff](../harness-policy-handoff.md#authorization-and-linearization).

## Migration and compatibility decision

BAZ-010 atomically:

1. Copies every Profile Group/member into same-id `compatibility_managed=true` Team current
   rows and immutable revision 1 with stable UUID slots and exact Open edges.
2. Creates exactly one revision-1 compatibility_open LiveHarness per Group, preserves every
   Agent `group_id` including archived, materializes exact Open edges, and leaves baseline
   null because historical source was never recorded.
3. Invents no Profile defaults/source lineage and leaves filesystem/BAZ-009 local state
   untouched.
4. Verifies count, UUID, revision, one-to-one, topology, membership, and no-fabrication
   postconditions, then drops legacy Profile Group tables.

For one release, Profile Group API/CLI adapters use canonical storage with
Deprecation/Sunset/Link guidance. Legacy positional member replacement can edit prior
ordinals, append, or remove a suffix only while compatibility-managed; custom definitions
return `409 migration_required`.

Only migration and legacy Profile Group POST create
`compatibility_managed=true`. Canonical Team create, clone, and save-as-template always
create false, never copy/re-enable the marker; the first canonical definition edit of a
compatible template permanently clears it.

Legacy Team spawn reads the current compatible immutable source revision transactionally.
New Group creates baseline/bindings/exact Open at revision 1 and seeds USER.md; existing
empty-uninitialized finishes N+1 preserving USER.md; any other compatibility_open Group
appends a cohort, preserves null/existing baseline and USER.md, regenerates full Open, and
finishes N+1. It remains compatibility_open. Explicit returns
`409 policy_merge_required`.

Existing Agent/Group lifecycle URLs remain permanent. BAZ-015 adds expected revisions and
placement; omitted legacy payloads work only for compatibility_open and are the sole
serialized optimistic-concurrency exception. There is no `/api/harnesses` or detached live
CRUD. The exact data/API/URL compatibility maps are in the
[normative handoff](../harness-policy-handoff.md#canonical-apis-and-legacy-payload-map).

## Web and rollout decision

Top navigation is **Templates · Agents · Groups · Skills · Config**. `/templates` redirects
to Agent templates; Team templates own the reusable roster. `/groups/:id` owns Overview,
Members, Policy, Memory, Context, and blocked-communication Activity. Old Profile/Profile
Group URLs redirect for one release. `/harnesses` is only reviewed BAZ-009 local migration;
nothing uploads/deletes silently and simulated blocks never become audit.

The former XL work is split into pull-sized L stories: BAZ-010/015 persistence+lifecycle,
BAZ-011/016 authorization+all runtime boundaries, and BAZ-012/017 IA+editors/migration/QA.
The enforcement gate defaults off. BAZ-016 introduces compiled
`HARNESS_MANAGEMENT_CONTRACT_VERSION=0`; BAZ-017 changes it to 1 only after both stories'
release acceptance passes. Daemon startup refuses enforcement-on below version 1. This is
a same-release manifest check, not a cross-process runtime handshake.

## Consequences

- Profile Group capabilities survive migration, but ProfileGroup stops owning data.
- Group remains the workspace/memory/integration boundary and gains one inseparable policy.
- Agent lifecycle becomes policy-aware and revisioned instead of bare repository writes.
- Cross-Group consent is two-sided, current, and auditable.
- Compatibility is bounded and cannot silently corrupt reviewed slot/policy identity.

## Non-goals

- Production persistence, enforcement, or UI implementation in this decision-only goal.
- Workflow execution, stages, sequencing, routing, retries, or transformation.
- Approval-required communication (BAZ-014), daemon command approval, or sandbox policy.
- Federation or multi-Group Agent membership.
- Origin-dependent authorization or authoritative browser-local state.
