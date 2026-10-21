---
id: BAZ-068
title: Operator workspace recovery with explicit cleanup limits
status: done
size: S
created: 2026-09-21
refined: 2026-10-17
target_release: 0.23.0
note: Limited scope explicitly accepted by the operator on 2026-10-17. Implemented; 94 focused tests, 21 required BAZ-068 security cases, root/web types and web build pass. Initial independent review's P1 corrected with synchronous final release and regression tests; fresh re-review ACCEPT on 2026-10-17. Not yet released. Guaranteed abnormal host-command recovery is deferred.
---

# BAZ-068 — Supported, limited workspace recovery

## Accepted 0.23.0 scope — 2026-10-17

The operator explicitly accepted: finish and review the existing CLI/API/web recovery surfaces;
recover only when recorded cleanup is authoritatively confirmed; explain blocked, unknown and
restored states; **defer guaranteed recovery from abnormal host-command failures**. No new C code,
sandbox or runtime redesign. This is an explicit narrowing of the original promise, not evidence
that the original abnormal-host case passed.

## User story

As an operator, I can inspect a Team's recorded workspace writers, attempt supported recorded
cleanup and understand why a workspace remains blocked, without editing the database or guessing
which processes to kill.

The original finding remains relevant: a failed host-command turn can leave detached commands
outside the worker's group. A missing worker PID, absent group, released outputs, elapsed time,
daemon restart or an operator acknowledgement does not establish their cleanup.

## Implementation contract

- Owner/admin-only Team-bound HTTP, CLI and web surfaces; no Agent tool or IPC recovery capability.
- Select only an opaque writer id. No request body, PID, root override, container engine, normal-exit
  assertion or caller-supplied cleanup acknowledgement.
- Reports contain safe postures and closed blocker codes, never raw resource identities, host paths,
  credentials, PIDs or low-level errors. Reports and responses are not cached.
- Live local leases, changed roots and restored/imported authority refuse recovery. Unknown or
  inconsistent resource inventories remain blocking and are explained rather than force-cleared.
- Management does not signal workers. Worker records must already carry the existing lifecycle's
  cleanup confirmation. Unconfirmed host-command workers explicitly report the deferred limitation;
  other unconfirmed workers remain blocked too. Obsolete phase labels confer no authority.
- Existing recorded container teardown may be attempted. Success requires the exact resource
  inventory, every recorded cleanup confirmation and unchanged Team/root/selection after teardown.
  The effect boundary rechecks the selected resource record and enforces confirmed-workers-only
  cleanup, so a concurrent substitution cannot introduce worker signalling. Final inventory,
  confirmation and selection checks run synchronously with writer deletion in one transaction,
  with no intervening await/microtask gap.
- Serialize before invoking teardown, including synchronous re-entry. Keep the writer blocking
  throughout cleanup; never replay a turn or infer success from a missing selection.
- Ordinary execution/automatic lifecycle cleanup is unchanged. A management result is evidence about
  the selected recorded writer, not a general filesystem verification or a guarantee no other
  writer can start afterward.

## Surfaces

- `GET /api/teams/:id/workspace/recovery`
- `POST /api/teams/:id/workspace/recovery/:writerId` (empty body)
- `bazilion team recovery list <team> [--json]`
- `bazilion team recovery attempt <team> <writer> [--json]`
- Team page **Workspace recovery**, with explicit explanations and read-only status refresh.
- [Operator instructions and limitations](../../workspace-recovery.md).

## Qualification / closeout — 2026-10-17

- **94 tests / seven files pass**, with all **21 current BAZ-068 security-manifest cases** matched
  to passed assertions in the Vitest JSON report. Root/web typechecks and the web production build
  pass. Scoped Biome has no errors (two pre-existing unused-import warnings in the shared Teams
  route); diff whitespace checks pass. This is not the whole-tree/security release gate.
- Isolated same-UID test home, private network/PID/proc, read-only repository/system mounts,
  scheduler/browser/images off and no connected-account access. Final logs:
  `/tmp/baz068-reviewed-5MNQpr/{tests.json,status.log,security-match.json,web-build.log,lint.log}`.
  Earlier implementation evidence and fixture failures remain in `/tmp/baz068-final-vVDtwq`
  and `/tmp/baz068-check-9aYFWo`:
  missing daemon-test client dependency, JSON schema rejection, and first-run setup refusal.
  Fixes stay in tests; production schema/setup gates were not weakened.
- Removed obsolete security entries for the canceled supervision path and replaced them with
  current limited-scope cases; no claim that the removed behavior is still qualified.
- Focused tests cover Team/admin selection, active/restored/changed identity, missing or changed
  records, concurrent/reentrant attempts, recorded confirmations, refusal without confirmations,
  real controlled child cleanup, real HTTP/client transport and CLI/presentation behavior.
- A controlled child is not a full Agent/provider/container qualification. HTTP fixtures with prior
  confirmations model those records; they do not prove a real Docker teardown occurred.
- No live operator failure experiment, account access, reboot, original-home mutation or unsafe
  cleanup is required or authorized by this story.
- Initial independent review found a P1 finalization microtask gap; final validation now shares
  the coordinator's synchronous deletion transaction. Three nested-microtask regressions refuse
  confirmation, identity and registration drift while retaining the blocker.
- **Independent re-review ACCEPT**, native fresh-context reviewer run
  `30329d53-b614-4b6c-8e8f-63e1c2d5891c`: original P1 resolved, no remaining P0/P1/P2 findings
  within the accepted scope/fix blast radius. Parent confirmed every reviewed source digest
  unchanged before closing; only acceptance documentation/backlog bookkeeping changed afterward.
  [Durable review/evidence record](../BAZ-068-independent-review-20261017.md).
- **Done means limited-scope story acceptance, not release.** Whole-release validation, packaging
  and publication remain separate; scoped passes do not approve 0.23.0.

Historical safety rationale: [audit](../BAZ-068-recovery-safety-refinement-20261005.md).
Current review checklist: [contract](../BAZ-068-recovery-review-contract-20261005.md).
