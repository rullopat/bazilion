# Harness Policy Production Handoff

BAZ-009 validates a browser-local communication policy and its editing model. It does not
create a production security boundary. This note preserves the prototype semantics and
identifies the persistence and enforcement work that must happen before the controls can
be described as enforced.

## Fixed policy semantics

- The policy is a versioned set of directed allow edges.
- Endpoints are user, outside_group, member_slot for templates, and agent for live
  harnesses.
- A matching edge allows communication. An absent edge denies it.
- User input/output and outside-group input/output are separate directions.
- Agent-to-agent edges authorize a sender/recipient pair; they do not execute a workflow,
  route payloads, retry work, or imply a handoff.
- Self edges, duplicate edges, boundary-to-boundary edges, and mixed template/live
  endpoints are invalid.
- Transport origin is audit metadata and never changes the decision.
- Presets and profile defaults expand to explicit edges when a template or live snapshot
  is created. There is no hidden inheritance at evaluation time.
- Template and live policies are independent snapshots. Promotion and cloning are explicit
  operations with optimistic concurrency.
- Operator access to policy, history, and block events is independent of delivery
  permission.

The executable prototype reference is apps/web/src/lib/harness-prototype.ts.

## Persistence shape

BAZ-010 should add normalized production records rather than storing a JSON policy blob as
the only source of truth:

- harness_templates: identity, name, preset metadata, policy version, revision, timestamps.
- harness_template_members: stable slot id, template id, profile id, display name, role,
  position, and ordering metadata.
- harness_template_edges: template id, source kind/id, target kind/id, with a uniqueness
  constraint on the directed pair.
- live_harnesses: group id, optional source template id/revision, revision, and timestamps.
- live_harness_members: live harness id, stable source slot id when present, and agent id.
- live_harness_edges: live harness id and resolved agent/boundary endpoint pair.
- profile communication defaults: four boundary booleans and one peer posture.
- harness_block_events: added by BAZ-011 with source, target, derived channel, origin, reason
  code/detail, policy revision, and timestamp.

Existing profile-group member rows need stable slot ids before policy edges can reference
them safely across reorder. Existing groups and profile groups must backfill to an explicit
Open Team posture so migration does not silently remove current communication.

## Decision service

Runtime code should call one daemon-owned policy service:

    authorizeCommunication({
      source,
      target,
      origin,
      harnessId,
    }) -> { decision, reasonCode, reason, edgeId?, policyRevision }

The service resolves live membership and the current policy in one database snapshot.
Denial must be recorded and returned before message insertion, turn start, or transport
send. Callers must not reproduce edge matching independently.

Recommended stable reason codes are allow_edge_match, no_allow_edge,
invalid_communication_path, member_not_in_harness, harness_not_found, and
legacy_open_team. Human-readable text can change without breaking clients.

## Enforcement points

1. Agent tool messaging

   apps/daemon/src/lib/messaging-host.ts is the daemon boundary used by the worker
   send_message tool. Authorize fromAgentId -> toAgentId before messageRepo.send. This is
   the primary inter-agent enforcement point.

2. External/API agent sends

   POST /api/agents/:id/messages in apps/daemon/src/routes/agents.ts calls messageRepo.send
   directly. It must use the same authorizer before insertion. Keep messageRepo.send a
   storage primitive; production callers should reach it through an enforcing service.

3. Web and CLI user ingress

   POST /api/agents/:id/chat in apps/daemon/src/routes/agents.ts starts runAgentTurn
   directly. Authorize user -> agent before attachments are persisted or a worker starts.
   CLI chat reaches the same daemon route and receives the same decision.

4. Telegram ingress

   apps/daemon/src/lib/telegram/routing.ts resolves a bound topic and then calls
   enqueueAgentMessage. Authorize user -> agent before media download and queue insertion.
   A denial should produce a concise Telegram response and a durable block event.

5. User and Telegram egress

   apps/daemon/src/lib/agent-turn.ts relays ChatFrames both to the requesting HTTP stream
   and to mirrorAgentTurnFrame. Apply agent -> user delivery policy centrally before
   either direct delivery path. Operator history remains readable, but a denied direct
   reply must be represented as a block event instead of being sent. Telegram must also
   check before enqueueOutbound in apps/daemon/src/lib/telegram/mirror.ts.

6. Scheduler assumptions

   apps/daemon/src/lib/scheduler.ts wakes recipients from unread rows after insertion.
   The primary guarantee is that denied inter-agent messages never enter messages.
   Re-authorize before drain as defense in depth because policy may change after a message
   was queued. A newly denied queued message must not start runAgentTurn.

All direct runAgentTurn callers must provide explicit actor/origin context. Operator-created
triggers and other non-interactive calls should map to a documented v1 actor rather than
bypassing policy accidentally.

## API sketch

BAZ-010 owns persistence APIs:

- GET/POST /api/harness-templates
- GET/PATCH/DELETE /api/harness-templates/:id
- GET/POST /api/harnesses
- GET/PATCH /api/harnesses/:id
- PUT /api/harnesses/:id/policy
- GET /api/harnesses/:id/diff
- POST /api/harnesses/:id/update-source
- POST /api/harnesses/:id/save-as-template
- profile create/update responses and requests include communicationDefaults

Mutations carry an expectedRevision and return 409 with the current revision on conflict.
Create/update responses return the fully resolved member and edge snapshot used by the
editor.

BAZ-011 adds enforcement visibility:

- GET /api/harnesses/:id/blocks with cursor pagination and filters
- GET /api/harnesses/:id/policy/evaluate for authenticated diagnostics only

The evaluate endpoint must be side-effect free. Runtime denials are recorded by the
authorizer, not by the diagnostic route.

## Delivery order

1. BAZ-010: schema, API types/routes, stable slots, defaults, and migration compatibility.
2. BAZ-011: central authorizer, all ingress/egress enforcement, and durable block history.
3. BAZ-012: replace localStorage with production APIs and migrate the production web UX.
4. BAZ-013: CLI show/import/export and block history.
5. BAZ-014: approval-required decisions after allow/deny enforcement is proven.

BAZ-010 through BAZ-014 are tracked as separate Todo stories. None should add workflow
execution semantics to communication edges.
