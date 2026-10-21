# BAZ-065 — evidence reconciliation and closure decision (2026-10-17)

**Status: limited option 1 independently accepted; BAZ-065 Done for that scope on 2026-10-17.**
See [current evidence](BAZ-065-limited-acceptance-20261017.md). Earlier failures below are retained.
The original requirement map below records why this explicit decision was needed. It is not a full
composed D/S acceptance claim. No new tests or production changes preceded the decision; historical
results below are not fresh passes.

[Story](done/BAZ-065-content-team-scheduling-and-recovery.md) ·
[Required CT cases and ownership](../testing/beta-readiness/content-team-acceptance.md)

## Required scope versus the headline remaining list

The story owns **D/S CT-08–13 and CT-16, plus S CT-02/14/15**. Its old headline list (cron approval
hold, restricted-tool negative, DST clocks) is stale: later slices provide source/recorded observations
for those narrower behaviors. But completing those three slices does **not** close every declared
composed D/S case. The protocol explicitly forbids composing separate component passes into a
composed journey pass and says ownership splitting did not lower its bar.

No live/human campaign is needed to identify this distinction: some still-open requirements are
already D/S, not merely unassigned L/H work. Native editorial *infrastructure* is not required by the
protocol; existing conversations and versioned files may express manual review. The missing evidence
must not be turned into a request for an editorial engine or scheduler redesign.

## Requirement-to-evidence map

All rows require current verification/review before a new acceptance claim. “Component evidence”
below means named source fixtures and historical observations, not a new passed case/lane.

| Required cell | Existing component evidence / source | What is not closed by that evidence |
|---|---|---|
| CT-02 S — actual policy-checked delegation | `apps/cli/test/content-team-scheduling.test.ts`: two actual cron minutes delegate to a specialist; Docker-gated inbox wakes. Occurrence-specific held/granted/denied ingress also exists. | Supports real scheduled delegation/communication controls; no complete four-role content journey or all cycle outputs are inferred from text markers. |
| CT-08 D/S — two scheduled cycles, fresh outputs, no inherited approval | Same suite: distinct dispatch instants and coordinator/researcher markers; separate communication-approval test checks distinct approval ids and provider-round counts. | The two-cycle test has images off and no cycle Results/hashes. Communication grants are not current text/concept/final-image editorial approval. |
| CT-09 D/S — timezone/invalid cron/DST semantics | `apps/cli/test/content-team-scheduling-lifecycle.test.ts`: UTC due instant. `apps/daemon/test/cron-timezone.test.ts`, `cron-scheduler-timezone.test.ts`, `lib/scheduler.test.ts`, cron/trigger suites: matcher and production tick/SQLite controlled-clock checks. | Controlled DST turns/preflight are stubbed: D calendar materialization, not a wall-clock DST S journey. No per-trigger timezone or catch-up promise. Invalid cron/timezone/display requirements must retain their own supported boundary. |
| CT-10 D/S — busy/deferred, retries and independent effects | `content-team-scheduling-recovery.test.ts`: busy blocking turn, one succeeded occurrence; actual provider rounds may retry. Lifecycle suite counts provider hits/terminal attempts. | One dispatch does not prove image/external exactly-once. Busy-Workspace combinations and recurring image-side-effect counters are not composed here. |
| CT-11 D/S — lifecycle plus cadence/brief amendments | Lifecycle suite: interval disable/re-enable/delete through supported management. Story documents cadence change as delete/recreate. | No between-cycle brief/destination amendment or current-version review oracle in these suites; future trigger changes are not cancellation of admitted work. |
| CT-12 D/S — restart before due, after claim and after image effect | Recovery suite: restart before due and downtime across a whole missed cron minute. Component image crash/retention tests exist separately (`apps/cli/test/image-crash.test.ts` and BAZ-059/064 records). | Scheduling/recovery fixture explicitly disables images. It does not execute the scheduled after-claim/after-image-side-effect fault boundaries or establish their recurring call-count/uncertainty outcomes. |
| CT-13 D/S — cutoff, rejection, missed slots | Lifecycle suite: bounded failed attempts. Recovery suite: missed-minute no-catch-up. Scheduling suite: communication hold → grant → execution → distinct hold → deny, zero extra provider rounds. | No text/concept review cutoff/rejected-draft scenario in these scheduled fixtures. Communication approval is not an editorial deadline decision. Manual reporting is not a reminder/timed-posting feature. |
| CT-14 S — image routing/credential/quota/deadline failures and aggregate counts | BAZ-064/059 have separate operator-turn image failure/route/counter fixtures. | Existing BAZ-065 suites have images off; those separate fixtures do not establish the scheduled recurring image-error/usage/deadline cell. |
| CT-15 S — held bytes/policy/membership/alternate reads/restart | Separate BAZ-064 deterministic boundaries; existing communication holds. [BAZ-068](done/BAZ-068-workspace-recovery-surface.md) now independently accepts limited recorded cleanup. | No composed scheduled image-byte disclosure/restart/membership cell established here. BAZ-068 does not make unknown host-command cleanup recoverable or pass this whole CT cell. |
| CT-16 D/S — protected scheduled/inbox posture, permitted research/images, negative | Scheduling suite: real container cwd/credential-minimal environment plus unadmitted host-read negative. `content-team-research.test.ts`: inbox posture/denied routes and synthetic daemon-owned discovery. BAZ-067 supplies protected discovery capability. | These scheduled fixtures do not execute admitted discovery plus source retrieval or image generation. An implemented search tool or SSRF refusal is not a positive selected-backend research observation. |
| CLI live-policy import repair | `apps/cli/src/team-interchange.ts`, `apps/cli/test/team-interchange.test.ts`; three required BAZ-065 security-manifest cases preserve `approval_required` and reject null/unknown posture. | Needs current focused verification and independent review. A successful repair does not qualify editorial judgment. |

## Evidence availability and verification boundary

- Historical calendar record: [2026-10-05](BAZ-065-dispatcher-calendar-20261005.md), 28 focused tests;
  matcher record in the story: 41 related checks. Their named directories
  `/tmp/baz065-calendar-dispatch-evidence-PkWRKL` and `/tmp/baz065-clock-contract-V6x3hH`
  currently exist but are **empty**. Source fixtures remain available for an authorized fresh run.
- Historical [scheduled approval/CLI posture record](BAZ-065-scheduled-approval-and-cli-posture-20261005.md)
  and [restricted-host-read record](BAZ-065-scheduled-readiness-20261005.md) describe actual canned
  cron/Docker observations. `/tmp/baz065-scheduled-approval-I67GlO` retains a driver, restoration log
  and `tool-home`; the named pass reports have not been located/validated in this reconciliation.
  Old full/security counts are not a current-candidate gate. Removed temporary packets are not proof.
- The existing real-cron tests remain usable verification inputs, not blanket CT passes. Docker gates
  must actually run where required; a skipped test cannot qualify S. The controlled-calendar driver
  must remain distinguished from real worker/container execution.
- No original daemon, credentials or Results were inspected. Old daemon PIDs/path pointers in
  historical prose are not current ownership/cleanup authority.

## Explicit decision — operator selected option 1

The current closeout goal permits existing focused fixtures and bounded corrections, not silently
turning BAZ-065 into a new composed acceptance campaign or lowering its original case ownership.

Two honest options remain:

1. **Explicit limited 0.23.0 closure scope:** independently qualify the implemented scheduler/process,
   occurrence-specific communication approval, restricted posture, calendar and CLI-import contracts.
   Keep the missing composed D/S configurations above open in the broader-beta protocol, with future
   execution ownership explicitly unassigned/not scheduled until separately refined/authorized.
   Do not mark those CT cells Passed or claim the content Team journey is complete.
2. **Keep the original composed D/S scope:** leave BAZ-065 In Progress and separately authorize the
   additional composed fixtures/observations needed for the missing cells. Existing slice reruns alone
   cannot close it. No new product engine or live/human campaign is implied by identifying the gap.

The operator explicitly answered **“1”** after these options were presented. Limited scheduler/process
closure is authorized only after fresh isolated focused checks and independent acceptance. The missing
composed D/S configurations stay open with future execution unassigned/not scheduled. No full CT
family, editorial workflow, scheduled-image journey or broader-beta pass is claimed.

## Fresh verification attempt 1 — FAILED, not accepted

Artifacts: `/tmp/baz065-closeout-x9W3uJ/` — `source-inventory.json`, `check.sh`,
`focused.json`, `process.json`, `status.log`, `attempt-1-summary.json`, `prerequisite.log`,
`isolated-docker-probe.log`. Same-UID private network/PID/proc, read-only repo/system mounts,
scrubbed environment, disposable HOME/TMPDIR at host-identical paths for Docker mounts,
explicit UTC, images/browser off, cached `debian:bookworm-slim`; no image pull or account access.
The Docker engine was reachable inside isolation. Initial read-only image formatting failed on
an omitted Config.Volumes key; optional-map inspection succeeded, with no Docker state change.

- **87 focused checks passed**, zero failed. All **three BAZ-065 security-manifest cases**
  matched passed assertions. Named suites cover cron/calendar/dispatch repositories, trigger
  management and CLI policy-import preservation. This is not a whole-release gate.
- **Process suites: 2 passed / 12 failed**, across scheduling, lifecycle, recovery and researcher
  fixtures. Scheduled/protected positive cases predominantly timed out before expected provider
  rounds; an ordinary delegation in the deliberately dead-protected-runtime case returned 500.
  Communication hold/grant reached its later settlement wait but did not complete successfully.
- The two reported passes do not establish positive protected execution or complete process
  acceptance. Raw output/failed assertions are retained; no first failure was replaced by a rerun.
- Added opt-in, test-only counter/cleanup logging without changing assertions; the JSON-reporter
  output retained no `BAZ065_EVIDENCE` facts. Required actual-counter/cleanup evidence is therefore
  **not established** by this attempt. The test daemons' stderr is suppressed by the existing
  fixture, leaving the underlying protected-turn failure unexplained.
- The runner stopped before typechecks; **root/web types and affected final lint are not a fresh
  pass for this attempt**. Scoped formatting and diff whitespace checks ran before execution.
- All 29 bounded source/test inventory entries remained unchanged through the run. No production
  code, runtime authority, owner state or original daemon was changed. No stronger claim about
  Docker resource cleanup is made from fixture shutdown alone.

The operator authorized one bounded diagnostic of a failing existing case, with test-owned
stderr/dispatch evidence and no weaker isolation or production-guard changes.

## Authorized diagnostic 1 — reproduced failure, cause still unknown

`/tmp/baz065-closeout-x9W3uJ/diagnostic-1/` retains `check.sh`, `diagnostic.json`,
`fixture-facts.jsonl`, `daemon-stderr/`, `status.log` and `source-inventory.json`.
Exactly one existing case ran: the scheduled unadmitted-host-read negative. Result: **0 passed,
1 failed, 3 unselected/skipped**, the same timeout. It is not a new process qualification pass.

- Opt-in append-only fixture facts now survive the JSON reporter. Actual observation: **0 provider
  rounds**, one dispatch `e1528937-e2d9-423d-abf5-62f0153a6afd`, terminal `failed`, attempt count **3**.
- Last error: `Protected Agent turn failed. Check Bazilion Config or bazilion doctor.`
  Captured test-daemon stderr contains only sanitized `scheduled_trigger_failed` events, not the
  underlying worker failure. `lib/protected-failure.ts` deliberately maps failing worker frames to
  that closed owner-facing message; it was not weakened or changed.
- Fixture facts record awaited daemon/mock shutdown. This does not independently prove cleanup of
  every Docker resource or infer arbitrary process-tree termination.
- Only three test-support files changed for this diagnostic: scheduling test, evidence helper and
  opt-in stderr capture in `server-fixture.ts`; production source hashes are unchanged. Assertions,
  selected Docker image, scrubbed environment and isolation stayed unchanged.
- No further suite/case rerun or product correction has been performed. Root cause remains
  unexplained; independent review/Done closure have not occurred. Further test-only worker-startup
  diagnostics require an explicit bounded decision, not public error-disclosure changes.

## Authorized worker diagnostic 2 and corrected verification

The operator authorized fixture-only worker fatal capture and a demonstrated in-scope correction.
A temporary test preload observed only this fixture's worker error frames/bounded stderr; it did
not capture stdin or change stream flow/public redaction. Three workers emitted `Connection error.`
without an observed provider round. The original-error observer was removed from source afterward;
its diagnostic source/output remains under `diagnostic-2/`.

The mock advertised `localhost`; lookup in the minimal private namespace returned **EAI_AGAIN**.
Binding/advertising the synthetic mock on **127.0.0.1** fixes that dependency without adding host
DNS/configuration, exposing original-home data, relaxing the namespace or changing product endpoints.
The same selected case then passed: two provider rounds, one succeeded dispatch/attempt, unadmitted
host read refused and no sentinel disclosure. The global sandbox override was also removed from the
outer runner so each fixture uses its declared configuration; scheduled/inbox origins remain protected
and the actual Docker positives/restricted negative pass. No host fallback or production guard change.

Fresh verification without the temporary observer: **87 focused + 14 process = 101 unique passes**,
zero failures/skips; all three story security assertions match. Actual facts and fixture closure are
retained, root/web types and scoped lint pass. The existing retry fixture additionally requires a
nonzero provider counter; its affected-case rerun passes (one existing case, not an extra unique case).
[Current scoped evidence and explicit limits](BAZ-065-limited-acceptance-20261017.md).
Fresh native independent review ACCEPT, run `e288ac48-bd75-4bd1-b4ab-5fcb0259f0dc`, found no issues;
parent matched all 35 reviewed hashes. [Acceptance and durable evidence](BAZ-065-limited-acceptance-20261017.md).
The original failed attempts above are not reclassified as passes; original composed CT cells stay
open/unassigned, and no whole-release approval is implied.
