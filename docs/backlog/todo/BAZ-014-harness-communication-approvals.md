---
id: BAZ-014
title: Human approval gates for harness communication
status: todo
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: medium
note: Optional follow-up after BAZ-011 allow/deny enforcement and BAZ-012 production UI. Adds approval-required delivery without adding general workflow execution.
---

# BAZ-014 - Human approval gates for harness communication

**Status:** Todo. Ready to pull after BAZ-011 and BAZ-012 validate production allow/deny.

## User stories

- **As an operator**, I want selected communication paths to require approval, so sensitive
  handoffs can be reviewed without permanently denying them.
- **As a sender**, I want a clear pending/approved/denied result, so approval does not look
  like recipient failure.
- **As an approver**, I want one durable queue with expiry and audit history, so retries do
  not create duplicate deliveries.

## Goal

Extend the communication decision model with approval_required for explicitly configured
edges. Hold the payload before the protected side effect, allow one authenticated decision,
then deliver at most once or expire visibly.

## Decisions

1. Approval is an edge effect, not a workflow stage.
2. Pending attempts are durable and idempotent by attempt id.
3. Payloads are retained only as long as needed for approval and follow existing secret/data
   handling rules.
4. Expiry defaults to deny. Non-interactive callers never wait indefinitely.
5. Approving authorizes one captured attempt, not future communication on the edge.
6. BAZ-006 shell-command approval is a separate subsystem and cannot approve communication.

## Scope

- Extend policy/API types and persistence with allow, deny-by-absence, and
  approval-required edge posture.
- Add durable pending attempts with payload reference, requester, policy revision, expiry,
  status, and idempotency key.
- Pause before message insertion, turn start, or transport send at the BAZ-011 enforcement
  boundary.
- Add authenticated approve/deny endpoints with optimistic state transitions and at-most-once
  delivery.
- Add web queue, per-attempt detail, filters, badges, expiry, and approve/deny actions.
- Stream or return structured pending/final status to web, CLI, agent tools, and Telegram.
- Revalidate membership and policy when approval is submitted; changed/removed policy
  fails closed.
- Add audit events for requested, approved, denied, expired, cancelled, and delivery-failed
  outcomes without logging sensitive payload contents.

## Out of scope

- Multi-step workflows, approver assignment engines, conditional routing, retries after a
  terminal delivery failure, or arbitrary payload transformation.
- Shell-command approvals from BAZ-006.
- Federation or cross-install approval.

## Acceptance criteria

- A protected attempt performs no guarded side effect before approval.
- Duplicate requests with one idempotency key create one pending attempt and at most one
  delivery.
- Approve, deny, expiry, cancellation, and policy-change outcomes are explicit to sender
  and operator.
- An approval after expiry or after a terminal decision cannot deliver.
- Concurrent approvals result in one winner and one conflict response.
- Policy/member changes are revalidated immediately before delivery.
- Ordinary allow and deny paths retain BAZ-011 behavior and latency within test tolerance.
- Queue/history access is authenticated and payload content is not exposed in list views or
  logs.

## Tests

- State-machine tests for every transition, idempotency, expiry, cancellation, and
  concurrency.
- Enforcement integration tests proving no pre-approval side effects and at-most-once
  delivery across agent, chat, and Telegram paths.
- Policy-change and member-removal race tests.
- Web queue Playwright tests plus API auth/audit tests and the full repository suite.
