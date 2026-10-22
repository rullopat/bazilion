---
id: BAZ-068
title: Operator workspace recovery with explicit cleanup limits
status: done
size: S
created: 2026-09-21
refined: 2026-10-17
target_release: 0.23.0
note: Limited scope accepted and independently reviewed for 0.23.0. Guaranteed abnormal host-command recovery remains deferred; unknown ownership stays blocked.
---

# BAZ-068 — Supported, limited workspace recovery

Released2026-10-21 in [v0.23.0](https://github.com/rullopat/bazilion/releases/tag/v0.23.0).
Unknown ownership stays blocked; release does not expand the accepted cleanup scope or
establish abnormal host-command recovery.

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

## Tests and As-built limits

Limited-scope implementation and independent review were accepted before 0.23.0 publication.
Required coverage remains:

- Team/admin selection; active, restored or changed identity; missing/inconsistent inventories.
- Concurrent/reentrant attempts, resource substitution and absent cleanup confirmations.
- Final confirmation/identity/registration drift, including nested microtasks, must retain the
  blocker. Validation and writer deletion share the coordinator's synchronous transaction.
- Controlled owned-child cleanup, HTTP/client transport and CLI/web presentation.
- No signalling unconfirmed workers, force unlock, turn replay, credential/path/PID disclosure or
  caller-supplied cleanup assertion.

A controlled child is not full Agent/provider/container qualification; seeded confirmation records
are not proof of an actual Docker teardown. No original-home failure experiment, account access,
reboot or unsafe ownership recovery is authorized. Done covers the limited contract only.
