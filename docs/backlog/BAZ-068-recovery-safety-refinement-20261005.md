# BAZ-068 — recovery safety refinement before implementation

**Historical audit.** The operator subsequently accepted limited recovery scope on 2026-10-17;
see [the current story](done/BAZ-068-workspace-recovery-surface.md). Its explicit deferral of
guaranteed abnormal-host recovery supersedes the original stronger-host implementation gate below.
The safety conclusions remain: unknown cleanup cannot be force-cleared. This audit is not current
implementation/acceptance status.

Read-only prerequisite audit during the authorized live qualification preparation. No recovery implementation,
new endpoint, force-clear, daemon-row mutation or live failure experiment. Story remains Draft.

## Existing contract inspected

- `lib/coding-environment/workspace.ts`: old-daemon/recovery writers block overlapping roots;
  `recover` keeps the blocker throughout asynchronous teardown; active local leases cannot recover.
  **Restored rows return false** because backup metadata is not live termination authority.
- `lib/coding-environment/resources.ts`: daemon-captured worker/container identities, creation ACK,
  worker-first teardown, no success if resource references are missing; restored resources denied.
- `runtime/worker/process-identity.ts`: boot/start/session/group matching, bounded process/output
  inspection, PID-reuse refusal and unknown cleanup blocked. For `hostCommands`, same-boot group
  absence/output release is insufficient: success additionally requires observed normal exit.

## Important correction to the initial proposal

**Do not treat “dead worker + absent group + released output handles” as sufficient evidence to
acknowledge an abnormal host-command writer.** Host commands may start independently detached
process groups and redirect every output handle; the recorded worker group/outputs do not prove those
commands stopped writing. The existing `hostCommands` condition is deliberate, not an inconvenience
to bypass with an operator checkbox or a forged `observedNormalExit=true` during recovery.

An operator surface may invoke existing authoritative teardown and report its result. It must not
invent termination evidence from elapsed time, user assurance, vanished PID or backup metadata.
Clearly separate safely recoverable recorded protected workers/containers from **unknown host-command
cleanup**, which remains blocked unless a reviewed stronger ownership proof exists. Do not silently
shrink the promised host-failure recovery goal to a protected-only pass.

## Refinement/review gates

1. Decide whether the implementation covers abnormal host-command failures; if so, design and review
   actual command ownership/cleanup evidence first. A UI around `recover` alone cannot satisfy the
   original failed-host-turn finding.
2. Keep Team-bound owner-only management, opaque safe status (not credentials/PIDs/private host
   paths), revision/root-identity/current-row checks and serialized recovery. API/CLI/web parity.
3. Execute only stored, daemon-owned resource identities. Unknown/missing/restored authority remains
   visible and blocked; no imported termination authority or generic force-clear capability.
4. Define restored-row reporting separately: never signal archive-supplied identities and never call
   a restored blocker recovered merely because copied process metadata looks old.
5. Review deterministic faults: same-boot dead versus live/escaped descendant, PID reuse, output
   holders, inspection denial, missing records, changed root, concurrent recovery/admission, restored
   rows and no replay. Positive recovery must use actual trustworthy teardown, not fabricated success.
6. Add composed failed-turn → truthful blocker → supported recovery → next permitted turn only after
   the safe mechanism exists. Keep first failures and independently review the source/claims.

This audit **does not resolve** BAZ-068 or its BAZ-064/065 dependencies. Operator-authorized normal
pause/restart for test-port isolation is not workspace recovery and must never be reported as such.
