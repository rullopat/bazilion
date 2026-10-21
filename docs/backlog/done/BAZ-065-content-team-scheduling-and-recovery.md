---
id: BAZ-065
title: Content Team scheduling and recovery acceptance
status: done
size: M
created: 2026-09-20
refined: 2026-09-21
target_release: 0.23.0 (operator-approved limited scheduler/process scope)
note: Limited option 1 explicitly approved. Fixture DNS failure diagnosed and corrected without production changes; 101 unique focused/process checks and 3 story security cases pass, actual counters retained, root/web types and scoped lint pass. Retry positive-control assertion strengthened/retested. Independent native review ACCEPT on 2026-10-17; parent matched all 35 reviewed hashes. Released0.23.0 for limited scope; composed D/S remains open/unassigned.
---

# BAZ-065 — Content scheduling and recovery

Released2026-10-21 in [v0.23.0](https://github.com/rullopat/bazilion/releases/tag/v0.23.0).
[Release closeout](../../testing/0.23.0-release-status.md) preserves the accepted limited scope;
composed D/S remains unqualified and unassigned.

## Historical limited-scope verification — 2026-10-17

[Fresh evidence and retained first failures](../BAZ-065-limited-acceptance-20261017.md): 101 unique
checks/14 files pass (87 focused + 14 real-process cases), zero failures/skips; all three required
story security assertions match. Actual cron/approval/provider/cleanup facts retained; root/web
types, scoped Biome and whitespace checks pass. A strengthened provider-hit assertion passed an
affected-case rerun. Fixture `localhost` resolution failed in isolation; the synthetic mock now
uses literal loopback. No production guard/error mapping or isolation weakened. Independent
native review **ACCEPT**, run `e288ac48-bd75-4bd1-b4ab-5fcb0259f0dc`, found no issues; all 35 reviewed
source digests matched before closure. [Retained review](../BAZ-065-independent-review-20261017.md).
Done for the approved limited scope only; broader CT cells remain open and release is separate.

## Current evidence reconciliation — 2026-10-17

[Requirement/evidence map and closure decision](../BAZ-065-evidence-reconciliation-20261017.md).
The old three-item remaining list is stale: communication holds, a scheduled host-read negative
and deterministic DST dispatcher coverage have later fixtures/recorded observations. They do not
close the original composed D/S ownership. Scheduled image fault/counter/disclosure cases,
between-cycle brief/review-cutoff behavior and admitted research/image work remain distinct gaps.
This is not merely unrun L/H qualification. Historical artifacts are incomplete.

## Operator-approved limited 0.23.0 scope — 2026-10-17

The operator explicitly selected **option 1**: qualify/review the implemented scheduler/process
contract for 0.23.0, leaving missing composed D/S qualification open for broader beta. Required
here: actual cron/delegation, busy deferral, supported trigger lifecycle, bounded attempts,
before-due restart/missed-minute behavior, UTC/calendar semantics, occurrence-specific communication
holds/grants/denials, protected posture/restricted-tool control and CLI policy-import preservation.
Current source passed the focused fixtures and independent review; the evidence record retains
first failures and exact reviewed-source/result readbacks. No whole-release approval is implied.

This does not qualify scheduled image crash/error/usage/disclosure journeys, brief/editorial-cutoff
judgment, or admitted research/image composition. Those original CT configurations remain open
under the broader-beta protocol, with future execution **unassigned and not scheduled**. They are
not silently transferred to BAZ-063's consolidation-only role or marked Passed. BAZ-068's explicit
abnormal-host recovery limitation remains. No new product engine, live campaign or publication.

The original composed contract below remains the broader qualification target, not the acceptance
claim made by limited 0.23.0 closure.

## Deterministic dispatcher calendar slice — 2026-10-05

[New evidence](../BAZ-065-dispatcher-calendar-20261005.md): fresh explicit-TZ Node/fork fixtures now
exercise production tick + SQLite materialization in New York/Berlin gaps/repeated hours, three ticks
per minute. No invented gap/catch-up rows; fall's two UTC instants produce distinct dispatches once
per instant. Adjacent-day positives, exact watermark/attempt counts and unchanged parent TZ.
**28 focused tests/four files**, root/web types/Biome pass. Turn/preflight stubbed: **D only**, not real
S/L/H DST or external exactly-once. No runtime changes/live allocation; remaining editorial/recovery/
review/aggregate-guard and composed campaign gates stay open.

## Actual scheduled communication holds / CLI posture repair — 2026-10-05

[Evidence, first failures and limits](../BAZ-065-scheduled-approval-and-cli-posture-20261005.md):
real cron exposed CLI live-policy import silently discarding `approval_required`. Parser now preserves
valid posture and rejects malformed values; 32 focused tests/root/web types pass. Actual scheduled
hold → supported grant → one execution → distinct next-cycle hold → supported denial passes with
local canned providers, zero live budget. This is communication approval, **not editorial concept
approval**. Earlier gate collision with the live operator :4321 listener is retained (1,223 pass / 25 failed
diagnostic). Subsequent explicitly authorized idle-daemon pause: **2,550 full passes / 49 skips,
339 required security cases, root/web types all pass**; four current real-cron/Docker cases pass
together. Daemon restored PID 1462656 with identity/three Results verified, settings unchanged.
Independent source review and remaining calendar/recovery/editorial/composed evidence stay open.

## Current scheduled readiness / restricted-host-tool negative — 2026-10-05

[Bounded evidence and first failures](../BAZ-065-scheduled-readiness-20261005.md): existing real-cron/
Docker suites **8 passed**, then the updated scheduling suite **3 passed** including a new actual
scheduled-worker unadmitted host `read` negative. Permitted `coding_command`/container `bash` stay
admitted; host `read/edit/write`, browser navigation and MCP absent from the observed projection.
One refused-tool continuation, no outside-mount non-secret sentinel disclosure, one durable attempt,
normal disable/teardown. Explicit fixture UTC; root/web types/scoped Biome pass. First oracle/type
failures retained. No live budget consumed. Editorial approval-hold, dispatcher DST, recovery and
live qualification composed L/H still open; no full-suite/security rerun or release.

## Latest offline clock slice — 2026-10-04

`apps/daemon/test/cron-timezone.test.ts` adds **six deterministic tests** of the actual production
cron parser/matcher in fresh Node subprocesses with explicit `TZ`. No daemon, Agent/provider,
operator home, Docker, scheduled turn or machine-wide timezone/clock change:

- New York and Berlin spring gaps: no real instant matches the nonexistent 02:30; both adjacent
  normal days still match, with the expected offset change. No synthetic catch-up instant.
- Fall repeated hours: both distinct UTC instants match the same local scheduled minute, one hour
  apart. **This proves matcher semantics, not two dispatched turns or exactly-once side effects.**
- A 09:00 Berlin request does not silently translate in a UTC daemon; winter and summer offsets
  differ. There is still no per-trigger timezone feature.
- Parent `TZ` remains untouched. Environment is explicit and fixture processes import only `cron.ts`.

**41 focused tests / four files passed** (cron, new timezone cases, scheduler and dispatch repo);
root/web typechecks, scoped Biome and diff check passed. Artifacts:
`/tmp/baz065-clock-contract-V6x3hH/`. No full-suite/security rerun for this test-only slice.

This partially advances **CT-09's deterministic calendar contract**, not its complete D/S acceptance.
Actual controlled-clock scheduler materialization/deduplication across gaps/repeated hours,
real-cycle held approvals, restricted-tool negatives and recovery integration remain open. Existing
real-cron evidence remains separate; do not label matcher tests as an S-lane positive control.

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

## Original composed tests and acceptance — still open

Original ownership was **D and S for CT-08–13 and CT-16**, plus **S for CT-02, CT-14 and CT-15**, in the
[shared protocol](../../testing/beta-readiness/content-team-acceptance.md). The operator's explicit limited
0.23.0 decision leaves missing composed D/S configurations open with execution unassigned, as L/H
already was. This original bar is retained for broader qualification, not claimed by release closure.

- Two actual occurrences, fresh outputs, exact handoffs and no inherited final approval.
- Controlled clocks supplement real wall-clock cron; barrier-driven faults supplement existing unit
  tests. Keep first failures, retries, actual counters and cleanup observations.
- Positive permitted work plus denied/restricted controls; failing every invocation cannot pass safety.
- Truthful late/missed/uncertain outcomes, actual authorized Results surviving restart, no private-byte
  disclosure to hide loss, no blind image replay to obtain a green run.
- Stop test triggers after the bounded window, inspect open dispatches and verify test-owned resource
  cleanup. Disabling future occurrences does not by itself prove active work stopped.

Completion of the original composed qualification requires reproducible real-process scheduler tests,
per-case/lane evidence and documented timing/
posture limits on the reviewed recipe/candidate. Unmet required behavior is Failed or Blocked, not waived
by successful lower-level tests. Size M excludes product fixes and live qualification.

## Original composed dependencies and open prerequisites

BAZ-064's versioned recipe/fixtures; existing scheduler, policy, protected runtime and BAZ-059.
Protected discovery capability is implemented by [BAZ-067](../done/BAZ-067-protected-web-discovery.md);
its actual selected backend/scheduled-fixture qualification remains a prerequisite. BAZ-064's management preflight is not the real-worker journey required here.
Resolve safe scheduled discovery, actual daemon timezone, controlled-time fixture and expected DST/
overdue behavior before qualification. Use a disposable Linux home, fake services and no social grants.
Name execution ownership/reviewer before scheduling remaining composed qualification. No paid usage or machine-wide timezone change authorized.

Live/human execution is unassigned and not scheduled.

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
cycles (CT-13's other half), broader restricted-capability checks beyond the now-observed scheduled host-read negative,
DST dispatcher gap/repeat (controlled clocks), and composed L/H cycles. No live usage, publication or per-trigger
timezone work is authorized or implied.

## Product findings filed from this story's slices (2026-09-21)

- Fixed: the worker lingering ~30s after its turn (see the BAZ-064 acceptance record).
- Originally a failed turn left the Team `recovery`-blocked with no operator recovery surface.
  [BAZ-068](../done/BAZ-068-workspace-recovery-surface.md) is independently accepted for limited recorded cleanup with
  CLI/API/web explanations. The operator accepted deferring guaranteed abnormal host-command
  recovery for 0.23.0 on 2026-10-17; those unknown writers remain blocked, not counted recovered.
- Open (design note): the user communication channel requires both ingress and egress edges; chat
  ingress fails closed when only egress is revoked.
