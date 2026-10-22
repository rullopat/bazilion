---
id: BAZ-065
title: Content Team scheduling and recovery — limited scheduler/process scope
status: done
size: M
created: 2026-09-20
refined: 2026-10-17
target_release: 0.23.0
note: Operator-approved limited scheduler/process closure. Composed D/S and live/human journey qualification remains open, unassigned and not scheduled.
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

See [BAZ-063's acceptance cases](../draft/BAZ-063-content-team-real-world-acceptance.md#acceptance-cases)
for the remaining original composed D/S and live/human configurations. They are **not passed,
assigned or scheduled** by this closure. BAZ-063 consolidates, not secretly executes them.

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

## Original composed work still open

Original ownership was D/S CT-08–13 and CT-16, plus S CT-02/14/15. The broader target still needs:

- Complete [BAZ-064's recipe](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md)
  and observe fresh outputs/approvals across actual recurring cycles.
- Model-level brief/cadence amendments, editorial cutoff/withheld/stale approval judgment and no
  inherited concept/final approval. Canned scheduler turns cannot demonstrate that judgment.
- Scheduled image crash/ACK, usage/error/disclosure, admitted research/image composition and
  protected/inbox configurations with independent provider counters and actual retained bytes.
- Truthful late/missed/uncertain outcomes, policy changes and authorized Results after restart;
  no private disclosure or blind image replay to hide lost output.
- Explicit execution/reviewer ownership, bounded isolated fixtures and separately authorized live/
  independent-user observations. No original-machine timezone changes, spend or social grants.

Protected discovery exists through [BAZ-067](BAZ-067-protected-web-discovery.md), but actual selected
backend and composed scheduled qualification remain prerequisites, not inferred entitlement.

## Tests and exclusions

Use actual daemon scheduling/dispatch state and supported management interfaces; controlled clocks
supplement real cron, barriers supplement unit tests, and independent side-effect counters supplement
dispatch rows. Keep the first failed observations distinct from later corrected checks. Resource
cleanup is verified only for owned fixtures, not arbitrary host descendants or personal homes.

No new timezone/catch-up/reminder/search engine, social publisher, general workflow runtime or
independent human recruitment belongs to this limited story. Preparation cron is not publication
scheduling. New live/provider usage requires separate authorization.
