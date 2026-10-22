---
id: BAZ-065
title: Content Team scheduling and recovery — limited scheduler/process scope
status: done
size: M
created: 2026-09-20
refined: 2026-10-17
target_release: 0.23.0
note: Operator-approved limited scheduler/process closure. This does not establish the composed live/human journey; no further qualification campaign is scheduled.
---

# BAZ-065 — Content Team scheduling and recovery

## User stories

- As an operator, I want recurring preparation early enough for review, with understandable
  frequency, publication slots/timezone and deadlines.
- As an operator, I want busy work, pause/change and restart to preserve truthful state without
  duplicate costly generation or an old approval carrying into another cycle.

## Accepted scope

Released in [v0.23.0](https://github.com/rullopat/bazilion/releases/tag/v0.23.0). The operator
explicitly chose limited scheduler/process acceptance, **not the entire original composed content
journey**. That slice received independent acceptance and 101 unique focused checks.

- Actual cron occurrence/delegation through the running daemon, not a manual-turn substitute.
- Busy Agent/workspace deferral, supported trigger disable/resume/removal and bounded retries.
- Before-due restart and honest missed-minute/no-catch-up behavior.
- Daemon-local timezone/calendar semantics, including deterministic parser/dispatcher gap/repeated-
  hour controls. Those controls do not establish real S/L/H DST execution or external exactly-once.
- Occurrence-specific communication holds, supported grant/denial and a distinct next-cycle hold.
  **Communication approval is not editorial concept approval.**
- Protected scheduled posture and restricted-tool negative controls; permitted work must actually
  run too. No host/browser/MCP fallback to compensate for missing capability.
- CLI policy import retains `approval_required` instead of silently discarding it.

This acceptance does **not** qualify the complete content-Team live/human workflow. The
[experimental recipe](../../../examples/content-team/README.md) is an example of existing
capabilities, not an active implementation/acceptance programme. Retiring its former tracking
items does not broaden this story's accepted scope.

## Product contract

- Materialize one durable occurrence identity, then claim under the existing lease/state machine.
  Busy deferral does not imply a failed provider attempt. Dispatch deduplication is not proof of
  exactly-once image generation or other external effects.
- Observe at least two actual due cron minutes for the scheduler lane. Test acceleration must be
  explicit and separate from requested real-world publication cadence; stop test triggers afterward
  and inspect already-admitted work.
- Cron follows the daemon timezone. There is no arbitrary per-trigger timezone or automatic replay
  of every missed minute. A minute entirely missed during downtime is not manufactured on restart.
- Trigger changes/disable affect future admission, not an implicit cancellation of every active or
  durable dispatch. Manage admitted work through the supported controls; avoid overlapping replacements.
- Retain truthful failure, lease, attempt and terminal status. Interrupted provider/image effects
  must not be retried merely to obtain a successful output.
- Required protected discovery uses its own admitted backend. Container/credential/tool claims need
  observation in the actual scheduled/inbox posture, not configured-operator Docker evidence.
- Recovery concerns recorded owned resources only. [BAZ-068](BAZ-068-workspace-recovery-surface.md)
  does not guarantee arbitrary abnormal host-command cleanup; unknown writers remain blocked.

## Limits of the accepted scope

The focused scheduler/process checks do not establish:

- Complete recurring content preparation with model-level brief amendments, editorial cutoffs,
  withheld/stale approval judgment or independent human usability.
- Composed scheduled image crash/ACK, usage/disclosure and research/image behavior across every
  protected/inbox configuration. Source receipts and actual side effects need their own observations.
- General live-provider quality, account entitlement, exact-once external effects or arbitrary-host
  cleanup. Policy, Result privacy and no-blind-replay contracts remain mandatory regardless.

Protected discovery exists through [BAZ-067](BAZ-067-protected-web-discovery.md); a configured backend
is not proof of live access or a successful composed workflow. No validation campaign is scheduled.
If use exposes a concrete missing capability or defect, file that bounded product work separately.

## Tests and exclusions

Use actual daemon scheduling/dispatch state and supported management interfaces; controlled clocks
supplement real cron, barriers supplement unit tests, and independent side-effect counters supplement
dispatch rows. Keep the first failed observations distinct from later corrected checks. Resource
cleanup is verified only for owned fixtures, not arbitrary host descendants or personal homes.

No new timezone/catch-up/reminder/search engine, social publisher, general workflow runtime or
independent human recruitment belongs to this limited story. Preparation cron is not publication
scheduling. New live/provider usage requires separate authorization.
