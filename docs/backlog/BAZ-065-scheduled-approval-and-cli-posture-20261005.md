# BAZ-065 — actual scheduled approval holds and CLI posture repair

## Subsequent authorized full validation and restart

Operator explicitly authorized **“stop and restart as needed.”** Supervised wrapper
`regression-with-restart.mjs` checked idle Agents/no workers and the accepted Results first,
SIGTERMed the owned daemon normally (no forced kill), ran isolated checks, and restored the same
executable/home/environment in `finally`. No credential copied to any fixture/reviewer; auth token
only used in memory for authorized loopback management/download verification.

- **Whole-tree regression: 2,550 passed / 49 skipped**, 276 files passed / seven skipped,
  271.72 seconds (`full-regression.log`). Required Docker scheduling checks separately exercised.
- **Security gate: 339 required adversarial cases passed** (`security-with-daemon-paused.log`).
  Earlier timeout/collision failures below retained, not retrospectively called passes.
- **Root/web typechecks pass** (`types-final.log`); scoped Biome/diff pass. Runtime-source pins stayed
  stable through validation (`runtime-source-before.sha256`, `runtime-source-check.log`).
- **All four current real-cron/Docker scheduling scenarios pass together**, 384.37 seconds
  (`scheduling-composed-final.log`): two-cycle delegation, container positive, host-read negative,
  occurrence-specific communication hold/grant/denial. Not four live-model content cycles.
- Original daemon PID **1509495** retired normally; current PID **1462656**. Pointer:
  `/tmp/baz066-operator-daemon-current`. Identity-file bytes unchanged and all three accepted Result
  SHA-256s match before/after; images/scheduler/browser remain off, no public origin/preload/worker
  children, private search services stopped. No version/release/publishing action.

Independent source/evidence review of this policy repair remains pending. Full validation does not
resolve editorial concept approval, dispatcher calendar/recovery, aggregate live guards, isolated
credential setup or the live/human campaign. No live allocation consumed. The read-only
[BAZ-068 safety refinement](BAZ-068-recovery-safety-refinement-20261005.md) identifies why an abnormal
host-command writer cannot safely be cleared from group/output absence alone; no bypass implemented.

## Original scope and observations

Operator approved continuing the prerequisite checks. All transports here are local canned fixtures,
with disposable homes and cached Docker. **No live campaign or budget allocation consumed.**
No social posting, credential copying, operator daemon restart or recovery-row deletion.

Artifacts: `/tmp/baz065-scheduled-approval-I67GlO/`.

## Failure and cause

New real-cron test configured coordinator ingress as `approval_required` using supported CLI export/
import. First attempt timed out waiting for a hold (`approval.log`). A closed diagnostic repeat
(`approval-diagnostic.log`) showed no approval records, first occurrence executed and later provider
rounds: the intended policy had not survived import.

**Production defect:** `apps/cli/src/team-interchange.ts:parseTeamPolicyDocument` validated endpoints
but discarded the `posture` field. The API default then turned an explicit `approval_required` into
`allow`. Template parsing/export already preserved posture; live-policy parsing did not. This is an
actual operator-policy downgrade, not a valid editorial approval or approved campaign operation.
Only synthetic local-provider work occurred in the failing tests; neither first failure is erased.

## Repair and observed scheduled behavior

Live-policy parser now preserves `allow`/`approval_required`, defaults **only omitted** posture to
`allow` (existing canonical optional-field contract), and refuses malformed/unknown values rather
than dropping them. No schema/API/management-version change, legacy adapter, detached policy or
second authorizer. Added 12 unit configurations, including null/booleans/numeric/object/array/
unknown strings, plus required security cases for approval preservation/null/unknown refusal.

**32 focused tests / three files pass**: interchange, full CLI policy suite, neutral recipe. The updated
real-process/Docker cron test **passes** (`approval-fixed.log`, 107.41 seconds):

- Actual due occurrence captured as pending communication approval; zero provider rounds and
  zero dispatch attempts while held across ticks.
- CLI `approval approve --yes` grants that occurrence. Scheduler—not a manual chat/tick—executes
  exactly one canned-provider round, dispatch `succeeded`, one attempt.
- Next real minute creates a **different** approval/attempt identity and again remains pending with
  zero new provider calls. First grant cannot carry over.
- CLI denial yields terminal `failed` without a worker/provider call. Exactly two occurrence records.
- Supported trigger disable and revision-aware policy restore in `finally`; no later provider calls.

This establishes **scheduled communication approval** isolation, not current-version editorial
text/concept/image approval or novice/creator UI acceptance. No image is generated in this fixture;
images explicitly off. Editorial approval holds and exact image-version observations remain separate.

Also corrected the neutral template's stale USER.md claim that protected search is absent: it now
requires admitted daemon-owned SearXNG and forbids ordinary/browser fallback. No backend auto-enabled.
Updated recipe pin is required; old installed-artifact evidence is not a current-candidate rerun.

## Validation limitations and first failures

- Root/web typechecks pass (`typecheck.log`); scoped Biome/diff checks pass.
- At this earlier checkpoint, required security manifest **339 cases** (previously 336) was
  **not passed**; the subsequent authorized run above passes. First attempt
  exceeded tool timeout at 180 seconds; subsequent full gate exited failed. To preserve actual
  failure detail (runner removes its temporary report), repeated identical manifest-file selection
  with retained JSON: **1,223 passed / 25 failed**, all 25 failures in backup tests.
- Retained `security-diagnostic.json` and log show offline restore/rotation tests encountering the
  **already-running operator daemon on default :4321** and refusing before their intended archive/
  restore assertions. This is an environment collision, not evidence these archive checks passed.
  Custom-port expectation likewise encounters the default listener first.
- Do **not** weaken production liveness refusal, delete ownership markers or stop the operator daemon
  without consent just to get green tests. Current daemon remains unchanged. Either an isolated test
  runtime or separately authorized idle-daemon pause/restart is needed for complete gate evidence.
- At that checkpoint whole-tree regression and independent evidence review were outstanding.
  Subsequent full regression passes above; independent evidence review still pending. Focused/partial
  results do not replace those gates. BAZ-068 remains Draft: inspected its proposal,
  found no supported recovery surface; no security-adjacent implementation without refinement/review.

live qualification still needs a reviewed current D/S path/recovery disposition, dispatcher calendar evidence,
aggregate cross-Agent guards, pinned backend/candidate, exact timing/brief and normal isolated-home
credential setup. Creator/operator nomination is resolved; independent-user evaluation deferred.
