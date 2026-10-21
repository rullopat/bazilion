# BAZ-068 — review contract for limited workspace recovery

**Updated 2026-10-17:** the operator accepted the limited 0.23.0 scope in
[the story](done/BAZ-068-workspace-recovery-surface.md). Guaranteed recovery from abnormal
host-command failures is explicitly deferred. The initial stronger-host design is not a release
prerequisite and must not be rebuilt under this story. Independent review's P1 was corrected;
fresh re-review accepted the limited scope on 2026-10-17. See [the review record](BAZ-068-independent-review-20261017.md).

## Review checklist

1. Normal admin/bearer and browser session/CSRF enforcement; CLI/API/web parity. No Agent recovery
   tool, force-clear flag, PID/root/engine override, proof-bearing request body or normal-exit claim.
2. Team-bound opaque writer selection and current canonical root validation. Active local leases,
   changed roots, restored authority and missing/inconsistent records remain blocked.
3. No new management worker signalling: only existing lifecycle-confirmed worker records can settle.
   Unconfirmed host commands report the deferred limitation, even if the worker/group disappeared.
   Obsolete phase labels must not authorize cleanup.
4. Existing recorded container teardown retains its identity/creation-ack checks. Every selected
   resource must have a persisted cleanup confirmation before releasing the writer; a callback's
   boolean alone is not enough.
5. Serialize before callbacks; keep admission blocked while cleanup awaits. Revalidate root,
   inventory and selection after cleanup, and recheck the selected resource at the effect boundary.
   Worker-signalling refusal must hold there too, not just in report/preflight. Concurrent or reentrant calls cannot replay a turn,
   duplicate management teardown or acknowledge a changed selection.
6. Reports are bounded, not cached, and contain no ownership internals or raw errors. CLI and web
   explain active, blocked, restored, changed and missing states; only `recovered` is a recovery
   confirmation. Status refresh itself never attempts cleanup.
7. Fixtures distinguish controlled real process/HTTP effects from modeled prior resource records.
   Do not claim real Docker, live Agent/provider, original-home or human walkthrough acceptance.

## Current source and tests

- `apps/daemon/src/lib/coding-environment/recovery.ts` and existing `resources.ts` / `workspace.ts`.
- Recovery routes in `apps/daemon/src/routes/teams.ts` and admin scope mapping in `lib/scopes.ts`.
- `apps/cli/src/commands/team-recovery.ts`, `apps/web/src/components/WorkspaceRecoveryCard.tsx`.
- Hermetic wire types in `packages/api-types/src/workspace-recovery.ts`; shared operator wording
  and HTTP helpers in `packages/client`.
- `apps/daemon/test/core/workspace-recovery.test.ts`, route/body/authz tests,
  `apps/cli/test/team-recovery.test.ts`, `packages/client/test/workspace-recovery.test.ts`.

Earlier temporary review packets were removed with the canceled experiment. They are not current
review evidence. Review the source and the fresh scoped test results, not an unavailable old packet.
Independent limited-scope acceptance is recorded in the linked review record. No whole-release
approval is claimed by this checklist.
