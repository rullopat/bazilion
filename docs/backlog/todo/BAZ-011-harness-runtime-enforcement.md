---
id: BAZ-011
title: Harness authorizer, denial audit, and gated Agent messaging
status: todo
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Build the single authorizer, immutable idempotent denial audit, diagnostics, and gated Agent-message/inbox integration. Full ingress, egress, scheduler, and release activation continue in BAZ-016.
---

# BAZ-011 - Harness authorizer, denial audit, and gated Agent messaging

**Status:** Refined and ready after BAZ-015. ADR 0001 is normative. This is the first half
of the former XL enforcement story; BAZ-016 completes all remaining boundaries.

## User stories

- **As an operator**, I want one daemon authorization decision for every actor pair, so
  clients and transports cannot invent policy semantics.
- **As an Agent**, I want a structured policy denial before message insertion, so a block
  cannot look like recipient failure.
- **As an operator debugging policy**, I want one immutable privacy-safe denial record for
  each logical attempt and a side-effect-free evaluator.

## Goal

Implement the shared decision/audit foundation and Agent-to-Agent storage boundary from
[ADR 0001](../../adr/0001-production-harness-domain.md), behind a release gate that defaults
off from its first integration. No production release blocks communication until BAZ-016
and BAZ-017 are complete.

## Decision contract

    authorizeCommunication({ source, target, origin, attemptKind, attemptId })
      -> { decision, channel, reasonCode, reason, policyRefs[] }

- The daemon resolves current status, `agents.group_id`, channel, and one or two Group
  policies in one SQLite snapshot. Callers never supply an authoritative harness id.
- Same-Group A -> B requires exact A -> B. Cross-Group A -> B requires source
  A -> outside_group **and** target outside_group -> B in the same snapshot.
- User -> Agent and Agent -> user use the target/source Group boundary edge respectively.
- Archived/deleted/missing/nonmember/self/boundary-to-boundary paths deny before matching.
- Origin is required audit metadata and never changes the decision.
- Operator-authenticated history/policy/block/inbox inspection is exempt; Agent-visible
  inbox read/wait is delivery and must reauthorize.
- compatibility_open is not a hidden allow path; only stored explicit edges decide.

Stable denial codes include `no_allow_edge`, `source_outside_output_denied`,
`target_outside_input_denied`, `agent_archived`, `agent_not_found`,
`member_not_in_group`, `group_policy_missing`, `group_policy_invalid`, and
`invalid_communication_path`.

## Linearization and side effects

The policy snapshot is the authorization linearization point. For Agent message storage,
authorization plus message insert—or denial event—occurs in one write transaction. Reply
linkage never bypasses evaluation. A policy/membership writer therefore orders wholly
before or after the attempt; it cannot race between check and insert.

Agent-visible inbox read/wait re-evaluates the original sender/recipient using current
membership. Denied rows receive terminal policy-blocked disposition and audit in the same
transaction and are not returned. Operator history reads remain unchanged.

BAZ-016 extends this rule to turn leases, scheduler claims, and external transport items.

## Globally idempotent denial contract

Block uniqueness is `(attempt_kind, attempt_id)`, not an unqualified caller id. Canonical
examples are:

- `http_chat:<requestUuid>`
- `telegram_update:<botId>:<updateId>:<operation>`
- `agent_tool:<sessionId>:<toolCallId>`
- `scheduler_trigger:<triggerId>:<scheduledOccurrence>`
- `inbox:<messageId>` for tool read/wait and scheduler delivery alike
- `transport:<turnId>:<frameOrItemId>:<transport>:<destination>`

The block row fingerprints operation/source/target. Origin is stored from the first
terminal observation but excluded from identity, so Agent read/wait and scheduler delivery
can share one inbox denial without conflict. Enforcement first looks up an existing denial.
Matching returns the original decision permanently; mismatch returns
`attempt_key_conflict`. On unique-insert race, reload and apply the same check.

A new delivery invocation uses a new typed id. This contract guarantees denial-event
idempotency only; allowed decisions are not block records, no general allowed-delivery
retry ledger is introduced, and each operation retains its existing delivery semantics.

## Scope

- Add pure endpoint/channel/policy resolution and two-sided cross-Group evaluation over
  BAZ-015 canonical state.
- Add immutable `harness_block_events` with semantic endpoint snapshots, channel, origin,
  stable reason, one/two policy revisions, component outcomes, matched/required edge ids,
  fingerprint, first-observed origin, timestamp, and unique typed attempt identity. Store no payload, secret, or
  attachment content.
- Add the inbox terminal policy-blocked disposition and atomic disposition/audit helper.
- Add an enforcing Agent-message service used before `messageRepo.send` by
  `apps/daemon/src/lib/messaging-host.ts`, direct/reply Agent-message routes, and
  Agent-visible read/wait paths. The repo remains a storage primitive.
- Add authenticated cursor-paginated
  `GET /api/groups/:groupId/harness/blocks` and side-effect-free
  `POST /api/communication/evaluate`.
- Return a common structured tool/API denial with decision, channel, reason, typed attempt
  id, and policy references.
- Add the global enforcement release gate in this story. It defaults off; with the gate off
  integrations preserve current behavior and write no production block event. Tests cover
  enabled behavior, but release activation belongs to BAZ-016/017.
- Add privacy-safe decision metrics/logs without message bodies or credentials.

## Out of scope

- Web/CLI/API/Telegram user ingress, Agent-to-user transports, scheduler integration,
  turn/lifecycle leases, and enforcement activation (BAZ-016).
- Production editor/migration UX required for activation (BAZ-012/017).
- CLI policy tools (BAZ-013), approvals (BAZ-014), workflows, routing, retries, payload
  transformation, federation, command approval, or sandbox policy.

## Acceptance criteria

- Unit/property tests prove exact same-Group, two-sided cross-Group, boundary, lifecycle,
  origin-invariant, malformed-policy, and invalid-path decisions.
- Cross-Group denial is one result/event containing both policy revisions and component
  outcomes, never one event per Group.
- With the gate enabled in tests, denied Agent messages insert no deliverable message and
  return a structured denial; allowed/reply paths preserve current semantics.
- Agent read/wait and any later scheduler consumer share `inbox:<messageId>`; terminal
  disposition and denial audit are atomic. Operator reads remain inspectable.
- Lookup-first/fingerprint/unique-conflict behavior creates exactly one immutable block for
  sequential and concurrent retries and never reuses a key for different semantics.
- The diagnostic evaluator is authenticated, current, cross-Group capable, side-effect
  free, and never writes a block.
- Missing or corrupt policy fails closed with distinct stable reason codes when enabled.
- The gate defaults off in production configuration; off preserves current behavior and
  emits no authoritative block history. Partial Agent-only enforcement cannot ship.
- No decision edge invokes an Agent, executes a workflow, retries/routes a payload, or
  creates an approval.

## Tests and verification

- Decision unit/property tests and SQLite snapshot/concurrency tests.
- Block schema, fingerprint collision, lookup-first, unique-race, privacy, pagination,
  filtering, and evaluator tests.
- Messaging host/direct/reply/tool inbox tests with gate off/on, proving atomic insert or
  denial and no denied row exposure.
- Full repository suite, root/web typechecks, lint, build, and a configuration test proving
  the packaged default gate is off.
