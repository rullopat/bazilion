---
id: BAZ-011
title: Harness runtime enforcement and blocked-attempt audit
status: todo
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Enforce BAZ-010 policies before side effects across agent messaging, user chat, Telegram, and scheduler delivery. This is the story that creates the production communication boundary.
---

# BAZ-011 - Harness runtime enforcement and blocked-attempt audit

**Status:** Todo. Ready to pull after BAZ-010.

## User stories

- **As an operator**, I want denied communication stopped by the daemon, so harness policy
  is a real boundary rather than a UI preference.
- **As an agent**, I want a structured denial from send_message, so I can react without
  assuming a recipient failed.
- **As an operator debugging a team**, I want durable block history with a reason and
  origin, so policy failures are distinguishable from runtime failures.

## Goal

Implement one daemon-owned authorizer and apply it before every relevant insertion, turn
start, HTTP delivery, and Telegram send. Persist complete denied-attempt records and expose
read-only diagnostics without changing edges into workflow steps.

## Decisions

1. One matching directed edge allows; absence denies.
2. Every caller uses the same authorizer and stable reason codes.
3. Denial occurs before message insertion, attachment persistence, worker start, or
   transport send.
4. Origin is audit metadata and does not alter the decision.
5. Operator history/diagnostics remain readable even when direct delivery is denied.
6. Existing Open Team compatibility policies preserve pre-migration behavior.
7. Scheduler delivery rechecks queued communication as defense in depth.

## Scope

- Add the policy decision service described in docs/harness-policy-handoff.md.
- Enforce agent -> agent in createDbMessagingHost before messageRepo.send.
- Enforce the direct POST /api/agents/:id/messages route before insertion.
- Require explicit actor and origin context for all runAgentTurn call sites.
- Enforce user -> agent before web/CLI chat starts and before Telegram queues input.
- Enforce agent -> user before direct ChatFrame delivery and Telegram mirroring.
- Enforce outside-group directions by comparing sender and recipient group membership.
- Recheck unread messages before scheduler drain/turn start when policy changed after
  insertion.
- Persist denied attempts with harness, policy revision, endpoints, channel, origin, stable
  reason code/detail, and timestamp.
- Expose paginated/filterable block history and a side-effect-free policy evaluation route.
- Return structured tool/API/transport denial responses; do not silently drop.
- Add metrics/logging that omit message payloads and secrets.

## Out of scope

- Production web editor migration (BAZ-012).
- CLI import/export and block-history commands (BAZ-013).
- Human approvals (BAZ-014).
- Workflow execution, routing, retries, payload transformation, or federation.

## Acceptance criteria

- Denied agent messages never create a messages row and never wake the recipient.
- Allowed agent messages preserve current insertion, inbox, reply, and scheduler behavior.
- Denied web/CLI/Telegram input does not persist attachments or start an agent turn.
- Denied user output is not sent through the request transport or Telegram and produces a
  visible structured block result while operator history remains inspectable.
- All origins produce the same decision for the same source/target/policy.
- Every denial creates exactly one durable block record, including under retries.
- Policy changes between insertion and scheduler drain cannot deliver a now-denied queued
  message.
- Legacy Open Team groups behave as before.
- No edge causes automatic invocation, sequencing, or retry.

## Tests

- Unit tests for endpoint resolution, channels, reason codes, legacy compatibility, and
  deterministic decisions.
- Integration tests around messaging host and direct message routes proving no denied row
  is inserted.
- Chat and Telegram ingress/egress tests proving denied work does not cross side-effect
  boundaries.
- Scheduler tests for allowed wake, denied wake, and policy changes after queueing.
- Audit idempotency, pagination, filtering, auth, and concurrent policy-update tests.
- Full repository tests plus focused transport smoke tests.
