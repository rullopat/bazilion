---
id: BAZ-011
title: TeamPolicy authorizer, denial audit, and gated Agent messaging
status: done
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Build the single authorizer, immutable idempotent denial audit, diagnostics, and gated Agent-message/inbox integration. Full ingress, egress, scheduler, and release activation continue in BAZ-016.
---

# BAZ-011 - TeamPolicy authorizer, denial audit, and gated Agent messaging

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

- The daemon resolves current status, `agents.team_id`, channel, and one or two Team
  policies in one SQLite snapshot. Callers never supply an authoritative teamPolicy id.
- Same-Team A -> B requires exact A -> B. Cross-Team A -> B requires source
  A -> outside_team **and** target outside_team -> B in the same snapshot.
- User -> Agent and Agent -> user use the target/source Team boundary edge respectively.
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

- Add pure endpoint/channel/policy resolution and two-sided cross-Team evaluation over
  BAZ-015 canonical state.
- Add immutable `team_policy_block_events` with semantic endpoint snapshots, channel, origin,
  stable reason, one/two policy revisions, component outcomes, matched/required edge ids,
  fingerprint, first-observed origin, timestamp, and unique typed attempt identity. Store no payload, secret, or
  attachment content.
- Add the inbox terminal policy-blocked disposition and atomic disposition/audit helper.
- Add an enforcing Agent-message service used before `messageRepo.send` by
  `apps/daemon/src/lib/messaging-host.ts`, direct/reply Agent-message routes, and
  Agent-visible read/wait paths. The repo remains a storage primitive.
- Add authenticated cursor-paginated
  `GET /api/teams/:teamId/policy/blocks` and side-effect-free
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

- Unit/property tests prove exact same-Team, two-sided cross-Team, boundary, lifecycle,
  origin-invariant, malformed-policy, and invalid-path decisions.
- Cross-Team denial is one result/event containing both policy revisions and component
  outcomes, never one event per Team.
- With the gate enabled in tests, denied Agent messages insert no deliverable message and
  return a structured denial; allowed/reply paths preserve current semantics.
- Agent read/wait and any later scheduler consumer share `inbox:<messageId>`; terminal
  disposition and denial audit are atomic. Operator reads remain inspectable.
- Lookup-first/fingerprint/unique-conflict behavior creates exactly one immutable block for
  sequential and concurrent retries and never reuses a key for different semantics.
- The diagnostic evaluator is authenticated, current, cross-Team capable, side-effect
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

## As-built

Completed on 2026-07-11.

- Added the snapshot-linearized authorizer for same-Team, two-sided cross-Team, user,
  outside-Team, lifecycle, malformed-policy, and invalid-path decisions. Origins remain
  audit-only and callers never provide authoritative policy identity.
- Migration `0010_teamPolicy_blocks.sql` adds the immutable typed-attempt denial ledger and
  terminal message policy disposition. Block rows contain semantic endpoint and policy
  evidence but no message body, attachment, or credential content.
- `sendAgentMessage` is the sole enforcing Agent-message service used by IPC tools and the
  direct/reply HTTP route. Authorization plus message insert or denial record commits in
  one transaction. Agent inbox read/wait reauthorizes with `inbox:<messageId>` while
  operator history remains inspectable.
- Added authenticated, side-effect-free `POST /api/communication/evaluate` and filtered,
  cursor-paginated `GET /api/teams/:teamId/policy/blocks`.
- Enforcement is enabled only by the exact value `BAZILION_HARNESS_ENFORCEMENT=on`; absent
  or any other value is compatibility behavior and writes no authoritative block history.
  BAZ-016/017 still own complete-boundary activation.
- Verification: 695 repository tests, root and web typechecks, Biome lint, root build, and
  web production build. Focused authorization and HTTP tests cover policy decisions,
  atomic denial, idempotency/collision, privacy, pagination/filtering, evaluator auth and
  side-effect freedom, default-off behavior, reply linkage, and inbox terminal blocking.
