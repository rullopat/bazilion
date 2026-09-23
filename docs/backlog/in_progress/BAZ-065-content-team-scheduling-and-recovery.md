---
id: BAZ-065
title: Content Team scheduling and recovery acceptance
status: in_progress
size: M
created: 2026-09-20
refined: 2026-09-21
note: First real-cron slice implemented (two due minutes, disable semantics, wake handoff); recovery/DST/contested coverage remains.
---

# BAZ-065 — Content scheduling and recovery

## User stories

- As an operator, I want recurring preparation early enough for review, with understandable frequency,
  publication slots/timezone and approval deadlines, so that drafts are ready when I need them.
- As an operator, I want pause, changes, busy work and restarts to preserve truthful state without
  silently duplicating costly generation or treating an old approval as permission for another cycle.

## Goal

Apply the [BAZ-064 recipe](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) to actual cron-triggered
Team work. Qualify scheduling/recovery independently of live provider quality. This is a child of
[BAZ-063](../draft/BAZ-063-content-team-real-world-acceptance.md), not a general scheduler rewrite.

## Why

Interactive integration passes do not establish protected scheduled/inbox behavior, durable occurrence
ownership, deadlines or restart handling. Test the actual boundaries before running unattended paid work.

## Scope

- At least two real due cron minutes through a running daemon, with approved test-only acceleration
  distinct from the operator's intended publication cadence. Retain trigger/dispatch/conversation and
  specialist handoff identities; a manual chat or direct tick call is not the S-lane positive control.
- Actual scheduled/inbox posture, provider credentials, container/resources and permitted research/image
  tools. Configured-operator Docker is not a substitute; unavailable discovery remains Blocked.
- Daemon-local timezone, invalid cron, DST gap/repeated hour and requested-zone mismatch tests. Pin
  expected semantics; do not silently translate with a fixed UTC offset or add per-trigger timezone support.
- Busy Agent/workspace, repeated ticks, bounded retry/deferral and independent provider counters.
  One dispatch identity is not proof of exactly-once image generation or external side effects.
- Disable/resume, amended brief/cadence and already-admitted work; no overlapping replacement trigger
  or approval reused across cycles. Manage triggers through existing supported interfaces.
- Crash/ACK barriers, restart before/after claim and after image side effects, late/rejected approval
  and missed slots. Distinguish missed cron minutes from durable admitted dispatches.
- Recurring-test attempt/usage stop conditions, held/denied delivery, policy changes and teardown.
  Preserve the known captured-private-image loss limitation; no guaranteed refund or recovery claim.

## Out of scope

Live provider experiments, independent usability recruitment, new timezone/catch-up/reminder/search
features or social publishing. Preparation cron is not publication scheduling. Missing capabilities
become bounded implementation issues; do not disable security or fake the scheduled origin to pass.

## Tests and acceptance

Own **D and S for CT-08–13 and CT-16**, plus **S for CT-02, CT-14 and CT-15**, in the
[shared protocol](../../testing/beta-readiness/content-team-acceptance.md). BAZ-066 owns their required
live/human configurations; no duplicate claim that this story completed those lanes.

- Two actual occurrences, fresh outputs, exact handoffs and no inherited final approval.
- Controlled clocks supplement real wall-clock cron; barrier-driven faults supplement existing unit
  tests. Keep first failures, retries, actual counters and cleanup observations.
- Positive permitted work plus denied/restricted controls; failing every invocation cannot pass safety.
- Truthful late/missed/uncertain outcomes, actual authorized Results surviving restart, no private-byte
  disclosure to hide loss, no blind image replay to obtain a green run.
- Stop test triggers after the bounded window, inspect open dispatches and verify test-owned resource
  cleanup. Disabling future occurrences does not by itself prove active work stopped.

Done requires reproducible real-process scheduler tests, per-case/lane evidence and documented timing/
posture limits on the reviewed recipe/candidate. Unmet required behavior is Failed or Blocked, not waived
by successful lower-level tests. Size M excludes product fixes and live qualification.

## Dependencies and open prerequisites

BAZ-064's versioned recipe/fixtures; existing scheduler, policy, protected runtime and BAZ-059.
Protected discovery is now confirmed absent from the tool projection; [BAZ-067](BAZ-067-protected-web-discovery.md)
tracks that prerequisite. BAZ-064's management preflight is not the real-worker journey required here.
Resolve safe scheduled discovery, actual daemon timezone, controlled-time fixture and expected DST/
overdue behavior before qualification. Use a disposable Linux home, fake services and no social grants.
Name an owner/reviewer before moving from Draft. No paid usage or machine-wide timezone change authorized.

Next: [BAZ-066](../draft/BAZ-066-content-team-live-and-human-acceptance.md) consumes the qualified path.

## First implementation slice — 2026-09-21

`apps/cli/test/content-team-scheduling.test.ts` exercises the real daemon scheduler (200 ms ticks) with
a cron trigger created through the normal CLI: **two actual due cron minutes**, one minute apart —
the explicitly recorded test acceleration; the recipe's requested cadence stays an operator decision
(daemon-local timezone, no per-trigger timezone). Each occurrence ran a real coordinator turn that
delegated through policy; with `BAZILION_TEST_DOCKER=1` each delegation also produced a protected
researcher wake (single-round, no-tool wake turns asserted). Afterward the trigger was disabled and
several fast ticks produced no further rounds, and the dispatch history showed both occurrences with
distinct `scheduledAt` values. Run without Docker, the wake refusal keeps the delegated message
unread (preflight-before-provider-use). The turn-settle marker exists because the disable assertion
must not race occurrence 2's in-flight final round.

## Second slice — busy/deferred and restart semantics (2026-09-21)

`apps/cli/test/content-team-scheduling-recovery.test.ts` covers three behaviors with real cron
minutes, all canned-model plumbing:

- **CT-10:** while the coordinator runs a genuinely blocking turn (`wait_for_reply` tool — no LLM
  round during the wait), the due minute arrives and the cron dispatch does not run concurrently;
  after the busy turn ends the cron turn runs **exactly once**, and the dispatch history shows one
  occurrence, terminal `succeeded`, `attemptCount` 1. The trigger is disabled afterward.
- **CT-12a:** a trigger created well before its due minute survives a daemon restart
  (`stop({keepHome})` → `restartTestServer` with the same env) and fires exactly once after restart.
- **CT-12b:** a cron minute that fully passes while the daemon is down does **not** replay after
  restart (zero dispatches) — the documented no-catch-up limitation, now observed where it is claimed.

First-failure notes: deferral does not increment `attempt_count` (the claim does), so mid-busy attempt
assertions were racy and were replaced by the single-run/history assertions; a restart inside the due
minute correctly materializes the occurrence, so CT-12b waits out the whole minute plus margin; mock
handlers must drain the request body before responding or the worker's request is reset.

## Third slice — lifecycle, retry bounds, daemon-timezone contract (2026-09-21)

`apps/cli/test/content-team-scheduling-lifecycle.test.ts` runs the daemon with a dedicated `TZ=UTC`
(the operator's machine timezone is untouched; cron fields are computed in UTC to match):

- **CT-11:** through supported management only — disable pauses cycles, re-enable resumes, `rm`
  stops them permanently; each transition verified against actual rounds. In-place cadence editing
  is not supported (`PATCH /api/triggers/:id` only toggles `enabled`); a cadence change means
  delete + recreate — documented as a limitation, not worked around.
- **CT-13 retry half:** a turn whose provider always fails retries with `attemptCount` 1→2→3 and
  then goes terminal `failed` with a populated `lastError`; no provider attempts occur after
  terminal. Bounded retries with truthful history, observed.
- **CT-09 partial:** a `TZ=UTC` daemon fires the cron at the UTC minute (dispatch `scheduledAt`
  equals the expected UTC instant). DST gap/repeat hours still need controlled clocks and stay open.

## Fourth slice — scheduled turn posture (CT-16 partial, 2026-09-21)

`content-team-scheduling.test.ts` gains a Docker-gated test: a scheduled turn's canned model runs
`coding_command` `env > scheduled-env-dump.txt && test "$PWD" = /workspace`. The dump's existence
proves the container working directory; its contents prove credential minimality — no daemon token,
no provider/search credentials. The scheduled occurrence then goes terminal `succeeded`. Scheduled
turns execute in the protected container posture where that is claimed, observed directly.

Not yet covered: brief amendments between cycles at model level (the supported chat path carries
them; canned models cannot demonstrate judgment), approval-hold/missed-slot behavior with real
cycles (CT-13's other half), the restricted-tool negative at scheduled level, DST gap/repeat
(controlled clocks), and composed L/H cycles (BAZ-066). No live usage, publication or per-trigger
timezone work is authorized or implied.

## Product findings filed from this story's slices (2026-09-21)

- Fixed: the worker lingering ~30s after its turn (see the BAZ-064 acceptance record).
- Open: a failed turn leaves the team workspace `recovery`-blocked with **no supported operator
  recovery surface** (observed in CT-15's slice; fail-closed by design but unusable in practice).
  [BAZ-068](../draft/BAZ-068-workspace-recovery-surface.md) now holds the scoped recovery-surface work —
  security-relevant, not changed inside this acceptance work.
- Open (design note): the user communication channel requires both ingress and egress edges; chat
  ingress fails closed when only egress is revoked.
