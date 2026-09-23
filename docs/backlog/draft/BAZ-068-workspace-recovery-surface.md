---
id: BAZ-068
title: Operator recovery for workspace rows after failed turns
status: draft
size: S
created: 2026-09-21
note: Found by the BAZ-064/065 acceptance harness; security-adjacent (BAZ-027/032/045 fail-closed contract) — refine with review before implementing.
---

# BAZ-068 — Workspace recovery surface

## User story

- As an operator, I want a supported way to resolve a Team's `workspace_recovery_required` state after
  a failed turn, so one bad turn does not make the Team permanently unusable.

## Finding (observed 2026-09-21, [evidence](../BAZ-064-acceptance.md))

A turn that ends abnormally — e.g. a `deliver_file` denial surfacing as a failed turn — leaves the
team's `workspace_writers` row in `state='recovery'` with its worker resource unconfirmed
(`terminateWorkerProcess` returns false for host-command workers when the exit was not observed
normal). The fail-closed contract ("unknown cleanup remains a durable admission blocker") is correct,
but:

- The next turn on that Team is refused with `workspace_recovery_required`.
- The state persists across daemon restart (restart maps other-identity rows to the same blocker).
- **No supported operator surface exists**: no CLI command, API route or doctor output acknowledges
  or resolves the row. `lifecycle.claim`'s automatic recovery loop cannot confirm the dead worker
  (its process group is gone; the recorded PID is unreapable), so the Team is unusable with no path
  back except out-of-band database surgery.

## Proposed scope (refine before Todo)

- A supported operator surface (CLI + API route + doctor/attention visibility) that lists recovery-
  required workspace rows and, for each, runs the existing `WorkspaceCoordinator.recover(id, teardown)`
  with the real resource teardown — plus explicit confirmation semantics for a worker that has
  demonstrably exited (group gone + outputs released) so a *dead* worker's row can be acknowledged
  without weakening the live-blocker rule.
- The confirmation must remain conservative: a live or unidentifiable process stays blocked; only
  observably-dead identities (same boot, group absent, output handles unheld by any newer process)
  become confirmable. Keep the admission-blocker contract for anything ambiguous.
- Attention/diagnostic visibility when a Team enters recovery-required, so the state is seen, not
  discovered as a mysterious turn refusal.
- Tests: failed-turn → row state → observed blocker → supported recovery → next turn succeeds;
  live-worker rows stay blocked; restored rows keep the audit trail.

## Out of scope

Changing the frozen admission-blocker semantics for live processes, per-row deletion tools that skip
teardown, or any new storage. The BAZ-064 harness's fresh-Team workaround stays until this ships.

## Dependencies

Follows the workspace-contract work (BAZ-032/045 boundaries); coordinate with the BAZ-059 release
sequence (any change moves the scoped fingerprint again). Not required for the 0.22.0
candidate unless the operator wants it folded in; the content-Team campaign's remaining cells
(CT-15's restart half) reference it as Blocked until then.
