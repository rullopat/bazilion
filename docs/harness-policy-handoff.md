# Harness production implementation handoff

This is the execution index for BAZ-010/011/012 and their pull-sized continuations
BAZ-015/016/017. [ADR 0001](adr/0001-production-harness-domain.md) is authoritative.
BAZ-009 is a browser-local interaction prototype, not persistence, enforcement, audit
evidence, or an ownership model.

## Canonical contract

> **There is one canonical Team/Harness Template roster and one effective live policy per
> Group. `agents.group_id` is the sole live-membership authority.**

| Concept | Responsibility |
|---|---|
| Profile / Agent template | One reusable single-Agent blueprint and optional creation-time communication defaults |
| HarnessTemplate / Team template | The sole reusable multi-Agent roster, stable slots, starter context, overrides/layout, and template policy |
| Group | Live workspace, USER.md/context, memory, integrations, and membership through `agents.group_id` |
| LiveHarness / Group policy | The Group's inseparable one-to-one effective edges, revision, baseline/cohort lineage, and editor metadata |
| Agent | One live Profile instance in exactly one Group; archived remains a member but cannot communicate |

ProfileGroup is a one-release API/CLI/URL projection only. A LiveHarness cannot be created,
addressed, or deleted independently of its Group. Slot bindings and presentation records
are lineage/layout, never membership.

## BAZ-010 implementation status (2026-07-11)

BAZ-010 is complete. Migration `0009_canonical_harness.sql` now owns the canonical current
and immutable Team rows, optional Profile defaults, exactly one `live_harnesses` row per
Group, explicit live edges, retained instantiations/bindings, and optional presentation
state. It atomically converts and removes the legacy Profile Group tables after validating
counts, stable UUIDs, snapshots, cardinality, exact Open topology, membership projection,
and absence of fabricated lineage.

The one-release `/api/profile-groups` and `bazilion profile-group` surfaces are deprecated
adapters over those canonical tables; they are not a second roster. Existing
compatibility-open Agent/Group lifecycle operations maintain stored exact Open edges, and
the shared per-Agent lifecycle/turn lease now orders turn registration against move,
archive, unarchive, and delete through cancellation settlement. BAZ-015 still owns the
canonical Team and Group-policy API endpoints; BAZ-010 exposes no new unpaired management
surface.

BAZ-015 is complete. The shipped canonical routes now own every custom or explicit
mutation: Team definition writes, live policy replacement, placement,
adoption/re-baselining, clone, semantic diff, update-source, save-as-template, and
canonical lifecycle revision payloads. Every canonical membership/policy mutation enters
explicit mode permanently, while the one-release omitted-field adapters remain bounded to
exact Open compatibility state. BAZ-010/015 add no authorizer bypass or runtime
enforcement.

## Cardinality and retained source model

- Profile `1 -> 0..*` Team slots and `1 -> 0..*` Agents; optional defaults are `1 -> 0..1`.
- Team template `1 -> 0..*` current slots/edges and `1 -> 1..*` immutable revision
  snapshots.
- Group `1 -> 1` LiveHarness and `1 -> 0..*` Agents.
- LiveHarness `1 -> 0..*` edges, current template instantiations, and optional Agent-keyed
  layout rows.
- LiveHarness has one nullable `baseline_instantiation_id`; template id/revision derive from
  it. Other instantiations are append cohorts.
- Each retained instantiation references one immutable template revision and has zero or
  more source-slot bindings. Each Agent has at most one current binding.

Current normalized Team rows remain the write model. Every committed mutation also writes
a complete immutable validated revision snapshot. Current and live-referenced revisions
cannot be pruned, so baseline/cohort display and diff remain reproducible after source edits.

## Stable slots, defaults, and exact Open Team

- Slot ids are server-generated opaque UUIDs, independent of Profile/name/role/position.
  Reorder/edit retains; remove tombstones while referenced; re-add/clone/save-as-template
  allocate new ids and translate edges.
- Repeated Profiles always receive distinct slots. Spawn maps source slot to Agent
  explicitly. No adoption/source mapping is inferred by order, Profile, name, or role.
- Clone, spawn/initialize/append, and adopt require the reviewed current
  `templateExpectedRevision`; any source edit returns `409 template_revision_conflict` even
  when its edge set is unchanged.
- Preset expansion happens first. A Profile defaults row then adds/removes exact boundary
  edges; allow_all adds peer edges, deny_all removes, inherit leaves preset unchanged.
  Direct profile-default placement starts isolated. Missing row is neutral.
- Defaults and presets materialize edges at creation time and never inherit during runtime
  evaluation.
- For members `M`, exact Open Team is every `a -> b` for distinct members plus
  `user <-> m` and `outside_group <-> m` for each member. It contains
  `|M|(|M|-1) + 4|M|` edges and no invalid edge.

## Storage and migration handoff

BAZ-010 owns Team current rows/immutable revisions, Profile defaults, LiveHarness keyed by
Group, live edges, current instantiations/bindings, optional layout state, compatibility
flags, and exact-Open lifecycle adapters. BAZ-011 adds immutable block events.

The one-transaction migration:

1. Copies every Profile Group to a same-id Team template at revision 1 with
   `compatibility_managed=true`.
2. Converts every member row to one UUID slot, preserving Profile, name, overrides, and
   ordinal; writes current exact Open edges and immutable revision 1.
3. Preserves Profiles and invents no defaults row.
4. Creates exactly one LiveHarness revision 1 for every Group with
   `membership_mode=compatibility_open` and null baseline.
5. Preserves every existing/archived Agent's `group_id`, creates no source binding, and
   materializes exact Open live edges.
6. Never infers historical Profile Group spawn provenance.
7. Leaves files and BAZ-009 localStorage untouched; local simulated blocks never migrate.
8. Verifies counts/UUIDs/revisions/cardinality/topology/membership/no-lineage postconditions,
   then drops legacy Profile Group tables. Adapters use canonical storage only.

### Data compatibility map

| Legacy/current data | Canonical production result |
|---|---|
| Profile | Preserved Agent template; nullable defaults added without inventing a row |
| Profile Group | Same-id compatibility-managed Team template plus immutable revision 1 |
| Profile Group member | Stable UUID Team slot preserving Profile/name/overrides/ordinal |
| Missing Profile Group policy | Exact Open Team template edges |
| Group | Same workspace/context plus exactly one revision-1 Group policy |
| Agent including archived | Same `group_id`, explicit Open live edges, no fabricated source binding |
| Historical Profile Group spawn | Baseline/cohort/source remain unknown rather than inferred |
| BAZ-009 local policy/block | Preserved locally; reviewed BAZ-017 import only; simulated blocks never audit |
| Legacy Profile Group tables | Dropped after verified copy; adapters query canonical storage |

Profile deletion returns `409 profile_in_use` while any Agent including archived or any
current/immutable retained Team slot refers. It never cascades into a roster.

## Compatibility and explicit-mode transition

`compatibility_open` permits omitted placement/revision only for deprecated payloads that
preserve exact Open Team. It is not an authorizer bypass. `explicit` rejects omission.

Every canonical policy or membership mutation permanently switches all affected Groups to
explicit: policy save, spawn/init/append, adoption, both sides of move, and hard delete.
Archive/unarchive do not because topology/membership is retained. A Group never returns to
compatibility_open automatically.

Migrated/legacy-created Team templates start `compatibility_managed=true`. The first
canonical definition mutation permanently clears it. Metadata-only rename does not.
Canonical Team create, clone, and save-as-template always create false and never inherit or
re-enable the marker.

## Lifecycle implementation table

| Operation | Required result |
|---|---|
| Standalone Group create | Empty LiveHarness revision 1, compatibility_open |
| Team spawn into new Group | Template expected revision; final initialized LiveHarness revision 1; all Agents/bindings/exact immutable snapshot; one baseline; starter USER.md; explicit |
| Existing empty/uninitialized Group | Group/template expected revisions + null baseline; preserve USER.md; initialize to N+1 |
| Append to members/retained baseline | Group/template expected revisions; preserve baseline/topology; add cohort internal/boundary edges only; no implicit cross-cohort peers; explicit N+1 |
| Empty Group with retained baseline | Not uninitialized; initialize returns `409 baseline_replacement_required`; append or rebaseline |
| Direct spawn | Expected revision + placement; no source binding; explicit N+1 |
| Adopt/rebaseline | Group/template expected revisions; roster-neutral total injective mapping from every active slot to distinct current Agent (idle/archived allowed), isolated/open/profile-default placement for remaining Agents, reviewed resolved preview; replace live edges/current lineage/baseline; explicit N+1 |
| Move G1 -> G2 | Shared active-turn guard; both revisions + destination placement; remove source edges/binding, prune empty nonbaseline cohort but retain baseline, update `group_id`/agent.json, add destination state/edges; both explicit N+1 |
| Archive/unarchive | Active archive rejected; retain membership/edges/lineage; status only; no live bump |
| Hard delete Agent | Active rejected; remove state/binding/edges, prune empty nonbaseline cohort but retain baseline, explicit N+1, then purge current dependents/home; block snapshots survive |
| Delete Group | Expected revision and zero Agents including archived; cascade inseparable live aggregate; block snapshots survive |
| Delete Team | Hard-delete if no live lineage, otherwise tombstone; live policy unchanged; tombstone is read-only lineage display and rejects definition edit, clone, spawn/append, adopt/rebaseline, legacy spawn, and update-source with `410 template_deleted` |
| Update source | Both expected revisions; source current must equal retained baseline or `409 source_diverged`; reviewed diff only; transfer explicitly included cohort-bound Agents to new baseline slots, preserve nonincluded cohort bindings, prune only emptied cohorts; template +1 and live +1/repoint; live edges unchanged |
| Save as template | Snapshot all current Agents including archived into independent new slots; future spawns are normal; live baseline/revision unchanged |

Adoption policy expansion is order-independent. Start with translated template edges.
Remaining live-only Agent boundary edges come from its placement. Open/allow_all requests
both directions with mapped Agents; two live-only Agents connect only if both placements
request peer access. The request includes the preview and the daemon recomputes it.

BAZ-010 creates the per-Agent lifecycle/turn lease and wraps current turn registration plus
compatibility lifecycle; BAZ-015 consumes it for explicit operations and BAZ-016 extends
authorized callers. Filesystem work uses the current snapshot/cleanup pattern and failure
restores database plus files.

## Authorization and linearization

    authorizeCommunication({ source, target, origin, attemptKind, attemptId })
      -> { decision, channel, reasonCode, reason, policyRefs[] }

The daemon resolves status, `group_id`, and one/two policies in one snapshot; callers never
supply membership or harness authority. Origin is audit-only.

| Path | Required edge(s) |
|---|---|
| User -> Agent | Target Group `user -> Agent` |
| Agent -> user | Source Group `Agent -> user` |
| Same-Group A -> B | Exact owning-Group `A -> B` |
| Cross-Group A -> B | Source `A -> outside_group` and target `outside_group -> B` in one snapshot |
| Reply | Same underlying new-attempt rule |
| Agent inbox read/wait/drain | Re-evaluate original sender -> recipient using current membership/policies |
| Operator policy/history/block/inbox read | No delivery edge; authenticated API access |

Archived/deleted/missing/nonmember/self/boundary-to-boundary paths deny before an edge can
allow. Cross-Group denial is one result/event with both components/revisions.

Stable denial reasons are `no_allow_edge`, `source_outside_output_denied`,
`target_outside_input_denied`, `agent_archived`, `agent_not_found`,
`member_not_in_group`, `group_policy_missing`, `group_policy_invalid`, and
`invalid_communication_path`.

The snapshot is the attempt's linearization point. Database authorization and insert,
claim/disposition, or block event share one write transaction. Turn start and lifecycle
mutation share a per-Agent lease spanning authorization, active registration, and commit.
External effects reauthorize immediately before final send: every HTTP frame, proactive
item, file/image, and Telegram item is separate. A sent item is not retractable; later items
observe new policy. Media ingress rechecks before persistence/queue/start.

## Scheduler handoff

- Trigger attempt is `user -> Agent`, origin `scheduler_trigger`. Under the turn lease,
  occurrence claim/fired update/evaluation/denial are one transaction; allowed turn is
  registered before release; denied starts no turn.
- Inbox wake claims rows and evaluates each original path in one transaction. Denied
  disposition and block are atomic; only allowed rows enter prompt; empty allowed set starts
  no turn.
- Agent read/wait and scheduler use exactly `inbox:<messageId>` for denial identity.
- A moved Agent uses current Groups. Scheduler output separately checks Agent -> user.
- Archived denies; active retains defer-until-idle without duplicate attempt.

## Denial identity and audit

Block uniqueness is the typed pair `(attempt_kind, attempt_id)`, with a semantic fingerprint
of operation/source/target. Origin is stored from the first terminal observation but is
excluded from identity. Examples: HTTP operation+request UUID, Telegram
bot/update/operation, Agent session/tool call, trigger/occurrence, `inbox:<messageId>`, and
turn/frame/item+transport+destination.

Enforcement performs lookup-first. Matching existing denial returns the original even after
policy change; fingerprint mismatch returns `attempt_key_conflict`; unique-race loser
reloads. A new delivery invocation uses a new typed id. This key guarantees denial-event
idempotency only; it does not add a general allowed-delivery retry ledger or change each
transport's existing delivery semantics.

Block snapshots contain semantic endpoints, channel, origin, stable reason, policy refs,
required/matched edges, cross-Group components, and timestamp—never payloads, attachments,
or secrets. Diagnostic evaluation is authenticated and writes no event.

## Canonical APIs and legacy payload map

| Canonical surface | Ownership |
|---|---|
| `GET/POST /api/harness-templates` | Team template list/create |
| `GET/PATCH/DELETE /api/harness-templates/:id` | Revisioned metadata/read/delete |
| `PUT /api/harness-templates/:id/definition` | Stable slots plus explicit template policy |
| `POST /api/harness-templates/:id/clone` | Reviewed-revision independent clone |
| `POST /api/harness-templates/:id/spawn` | Reviewed initialize/append cohort |
| `GET /api/groups/:groupId/harness` | Sole Group policy projection |
| `PUT .../harness/policy` | Revisioned live-edge replacement |
| `POST .../harness/adopt-template` | Reviewed full rebaseline |
| `GET .../harness/diff` | Immutable baseline/current-source/live comparison |
| `POST .../harness/update-source` | Reviewed source promotion |
| `POST .../harness/save-as-template` | Independent Team snapshot |
| `GET .../harness/blocks` | BAZ-011 Group block history |
| `POST /api/communication/evaluate` | Side-effect-free diagnostic |
| Existing Agent/Group lifecycle URLs | Permanent resources with additive BAZ-015 revision/placement fields |

Team templates live under `/api/harness-templates`. Group policy lives only under
`/api/groups/:groupId/harness` with `/policy`, `/adopt-template`, `/diff`,
`/update-source`, `/save-as-template`, and BAZ-011 `/blocks`. Diagnostic evaluation is
`POST /api/communication/evaluate`. There is no `/api/harnesses`.

Profile create/detail/update adds nullable communication defaults. Permanent lifecycle URLs
are existing `/api/agents`, `/:id/group`, `/:id/archive`, `/:id/unarchive`, Agent delete,
and Group delete, with BAZ-015 additive revision/placement fields.

For one release, old Agent payloads are accepted only on compatibility_open: omitted spawn
expands Open, omitted move requires both Groups compatible and regenerates both, and omitted
Agent/Group delete revision requires compatible state. Explicit state returns structured
placement/revision 409. Archive/unarchive payloads are unchanged.

Legacy Profile Group GET projects Team templates; POST creates compatibility-managed Open;
PATCH edits metadata while compatible; member PUT edits prior ordinal, appends beyond old
count, or tombstones only a removed suffix; middle insertion/reorder is unrepresentable;
custom state returns `409 migration_required`. Delete removes/tombstones source only. Spawn
reads the current compatible immutable source revision transactionally. New Group creates
the final LiveHarness revision 1, Agents/bindings/baseline/exact Open, starter USER.md, and
remains compatible. Existing empty/uninitialized preserves USER.md and finishes N+1. Any
other compatibility_open Group, including empty with retained baseline, appends a cohort,
preserves null/existing baseline and USER.md, regenerates full Open over archived members,
and finishes N+1. Explicit returns `409 policy_merge_required`. HTTP adds
Deprecation/Sunset/Link; CLI warns.

## Target web information architecture

Top navigation: **Templates · Agents · Groups · Skills · Config**.

- `/templates` redirects to `/templates/agents`; tabs link Agent templates and
  `/templates/teams` Team templates.
- Existing `/agents[/:id]` remains live Agent/chat.
- `/groups[/:id]` owns Overview, Members, Policy, Memory, Context, Activity. Activity is
  blocked communication/current revision, not an unowned policy-change audit.
| Existing/canonical URL | Target/compatibility behavior |
|---|---|
| `/templates` | Canonical redirect to `/templates/agents` |
| `/templates/agents[/:id]` | Agent templates |
| `/templates/teams[/:id]` | Sole Team-template roster and editor |
| `/agents[/:id]` | Existing live Agent/detail/chat |
| `/groups[/:id]` | Overview, Members, Policy, Memory, Context, Activity |
| `/profiles[/:id]` | One-release redirect to matching Agent-template URL |
| `/profile-groups[/:id]` | One-release redirect to matching Team-template URL |
| `/harnesses` | BAZ-009 local compatibility/import landing only |
| `/harnesses/:localId` template | Reviewed new-id Team import, then Team-template route |
| `/harnesses/:localId` live | Reviewed Group compare/import, then `/groups/:id/policy` |

Prototype state is never silently uploaded/deleted and simulated blocks never import.

## Pull-sized delivery order

1. **BAZ-010 (L, complete):** canonical storage, immutable revisions, atomic migration,
   exact-Open adapters, and the shared lifecycle/turn lease.
2. **BAZ-015 (L, complete):** custom revisioned Team/Group policy APIs and atomic Agent
   lifecycle.
3. **BAZ-011 (L):** authorizer/audit/diagnostics and gated Agent messaging; gate defaults
   off from first merge.
4. **BAZ-012 (L):** canonical web IA/projections/redirects/lifecycle and recovery shell.
5. **BAZ-016 (L):** all ingress/egress/scheduler/turn-boundary enforcement; introduce
   compiled management capability 0 and remain disabled for release.
6. **BAZ-017 (L):** production editors, conflicts/local migration/activity, accessibility,
   and viewport/theme completion.
7. BAZ-017 flips the compiled management capability to 1 only after both stories pass; the
   daemon refuses enforcement-on below version 1. No cross-process runtime handshake is
   used because daemon/web ship from the same release.
8. BAZ-013 adds CLI policy tools; BAZ-014 adds approvals afterward.

Legacy API/CLI/URL adapters remain for one complete release after BAZ-017 migration UX.
Removal needs a separate breaking-change story.

## Explicit non-goals

- Production workflow execution, stages, sequencing, routing, retries, or transformation.
- Approval-required communication in BAZ-010/011/012/015/016/017.
- Daemon sandbox/command approval, federation, or multi-Group Agent membership.
- Origin-dependent authorization.
- Treating BAZ-009 local policy or simulated blocks as production evidence.
