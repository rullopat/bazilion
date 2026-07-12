---
id: BAZ-014
title: Human approval gates for teamPolicy communication
status: done
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: medium
shipped: 2026-07-11
note: Optional follow-up after BAZ-016 allow/deny enforcement and BAZ-017 production UI. Adds approval-required delivery without adding general workflow execution.
---

# BAZ-014 - Human approval gates for teamPolicy communication

**Status:** Done.

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
- Pause before message insertion, turn start, or transport send at the BAZ-016 enforcement
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
- Ordinary allow and deny paths retain BAZ-011/016 behavior and latency within test tolerance.
- Queue/history access is authenticated and payload content is not exposed in list views or
  logs.

## Tests

- State-machine tests for every transition, idempotency, expiry, cancellation, and
  concurrency.
- Enforcement integration tests proving no pre-approval side effects and at-most-once
  delivery across agent, chat, and Telegram paths.
- Policy-change and member-removal race tests.
- Web queue Playwright tests plus API auth/audit tests and the full repository suite.

## As-built (2026-07-11)

- Added `allow` / `approval_required` posture to canonical Team-template revisions and the
  one effective live Team policy. Snapshots, spawn/adopt, portable CLI documents, diffs,
  and production editors preserve the posture; missing edges remain deny-by-absence.
- Added durable, payload-holding communication approvals keyed by typed attempt identity
  and semantic fingerprint. The state machine records payload-free audit events and uses
  optimistic pending-to-delivering claims, expiry, policy/member revalidation, and terminal
  delivered, denied, cancelled, expired, or delivery-failed outcomes.
- Integrated the hold before Agent message insertion, inbox exposure, HTTP/worker turn
  start, scheduler execution, and Telegram ingress/egress transport. Telegram media is not
  downloaded before approval. Approval dispatch delivers the captured attempt at most once;
  no workflow, transformation, retry engine, or shell-command approval coupling was added.
- Added authenticated `/api/approvals` queue/detail/approve/deny/cancel endpoints. List
  responses exclude payloads; detail disclosure is explicit. HTTP/chat, CLI send, Agent
  tools, scheduler, and Telegram receive structured pending/final state. Agents may query
  only approval attempts they requested through `approval_status`.
- Added `bazilion approval list|show|approve|deny|cancel`; mutating decisions require
  explicit `--yes`. Added the production web queue with status/history filters, expiry,
  payload disclosure, audit history, and approve/deny actions.
- Verification passed 95 files / 743 tests, root and web typechecks, lint with existing
  warnings only, root and web production builds, and `git diff --check`. In-app Playwright
  verified queue/detail/filter, payload disclosure, approve-once, deny, and final audit at
  1440x900, 1024x768, and 390x844 in light and dark with zero document overflow. The
  isolated fixture used held Agent messages only and sent no real Agent/model messages.
