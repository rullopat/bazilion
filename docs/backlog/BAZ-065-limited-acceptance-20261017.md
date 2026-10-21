# BAZ-065 — limited scheduler/process acceptance evidence (2026-10-17)

**Independent limited-scope ACCEPT; BAZ-065 Done, not yet released. No whole-release approval.**

## Explicit scope decision

After [reconciling the original CT requirements](BAZ-065-evidence-reconciliation-20261017.md), the
operator selected **option 1**: qualify the existing scheduler/process contract for 0.23.0. Missing
composed D/S configurations remain open under the broader-beta protocol, with future execution
unassigned/not scheduled. No CT family, editorial workflow, full scheduled-image journey, live/human
qualification or broader-beta acceptance is inferred. BAZ-068's abnormal-host limitation remains.

The scoped claim covers actual preparation cron/delegation, busy deferral, supported trigger lifecycle,
bounded dispatch attempts, before-due restart/no-catch-up, UTC/controlled calendar semantics,
occurrence-specific communication approval, protected posture/restricted controls and the CLI
live-policy import repair. This is not publication scheduling or an editorial spending gate.

## First failures and correction

All first failures are retained under `/tmp/baz065-closeout-x9W3uJ/`:

- Initial run: **87 focused passes**, including all three BAZ-065 security cases; process fixtures
  **2 pass / 12 fail**. No positive protected-turn acceptance inferred from the two passes.
- Authorized diagnostic 1: one selected case failed, three unselected. Fixture dispatch: three
  attempts, zero observed provider rounds; public failure/stderr remained deliberately sanitized.
- Authorized fixture-only worker diagnostic 2: three workers closed with code 0, each emitting
  connection-error events before the mock received an observed round. The raw observer was test-only;
  it never changed public failure mapping and was removed from source afterward.
- **Demonstrated fixture cause:** `startLmStudioMock` advertised `localhost`; isolated lookup returned
  `EAI_AGAIN` because the minimal namespace has no ambient DNS/NSS host files. The shared synthetic
  mock now binds and advertises `127.0.0.1`. No product endpoint fallback or public/runtime change.
- Same isolated selected case after that correction: **1 pass**, three unselected; two provider
  rounds, one successful dispatch/one attempt, absent unadmitted read, no sentinel disclosure.
- Final runner also stops forcing a global `BAZILION_BASH_SANDBOX=docker` onto ordinary configured
  operator fixtures, restoring their declared configuration. Each scheduled/inbox origin is still
  `protected` by `executionSurfaceForInvocation`; positive Docker environment/tool controls pass.
  The dead-Docker negative's ordinary coordinator can deliver, while the protected inbox cannot run.
  Private network/PID/proc, read-only source and default-denied live access are unchanged.
- Tightened the existing retry fixture to require nonzero actual provider requests. A preflight-only
  failure can no longer masquerade as the intended provider-error/attempt test. No assertion weakened.

## Fresh verification

Runtime: Linux, Node **26.7.0**, existing Docker **29.7.2**, cached `debian:bookworm-slim`
`sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a`, no declared image volumes.
No installation/image pull, original-home access, connected account, live provider request, daemon
restart outside disposable fixtures, commit or publication.

Same host UID with private network/PID/proc; scrubbed environment, explicit UTC, disposable homes and
host-identical temporary paths for Docker bind sources, read-only repository/system, DEVNULL stdin.
Fixture text/image/search traffic is local/canned; images and browser are off. No production source
was changed by this goal; the existing CLI import repair is part of the candidate under review.

- **101 unique selected tests / 14 files passed**, zero failures/skips: 87 focused checks plus 14
  actual-process cases. Controlled-calendar children are not counted again as separate parent tests.
- All **three required BAZ-065 security-manifest assertions** matched passed test results.
- After adding the nonzero-provider assertion, the affected retry case separately passed (two other
  cases unselected); it is a rerun of one case, **not a 102nd unique test**.
- Root/web typechecks passed; root types reran after that test-only assertion. Scoped Biome: 11
  files, exit 0, no warnings/errors. Diff whitespace checks passed. No additional production build
  is required by these test/document-only corrections; final packed/build release checks stay separate.
- Raw logs/commands, results and facts: `/tmp/baz065-closeout-x9W3uJ/post-fix/` and `retry-proof/`.
  Reproducible outer isolation: `run-verification.sh`; bounded source identities are in the supplied
  inventories, not a claim of complete artifact/build identity. Eighteen process fact records retained;
  [durable synthetic process/retry facts](evidence/BAZ-065-process-facts-20261017.json) contain no
  tokens, environment dumps or conversation payloads.

## Observed process facts (synthetic providers, real processes/cron/Docker)

| Contract | Actual observation | Limit |
|---|---|---|
| Two cron occurrences | Two UTC instants 60 seconds apart; four coordinator and two inbox-wake provider rounds; each dispatch succeeded, attempt 1; trigger disabled. | Not a two-cycle text/image Results journey. |
| Busy deferral | One post-busy provider round, one succeeded occurrence, attempt 1. | No external/image exactly-once claim. |
| Trigger lifecycle | Provider rounds 2 at disable, 4 at removal, still 4 afterward; disable/enable/remove exit 0. | Existing admitted work is distinct from future trigger configuration. |
| Bounded failed attempts | Two terminal dispatches, each failed after 3 attempts with error recorded; actual provider hits 18 at check, 21 after wait. Strengthened-case rerun observed the same 18→21. | SDK/provider calls are not dispatch attempts; recurring triggers can admit later work. Not a global three-request cap. |
| Before-due restart | One provider round and one succeeded occurrence/attempt 1 after restarting only the disposable fixture. | Not an after-image-side-effect crash test. |
| Missed minute | Zero provider rounds/dispatches after downtime across the full due minute; trigger removed. | No historical catch-up guarantee. |
| UTC/calendar | UTC scheduledAt equals expected instant, one provider round/attempt 1. New York/Berlin matcher and production tick/SQLite controlled-calendar cases pass. | D calendar facts, not wall-clock DST worker or external exactly-once qualification. |
| Communication approval | Two distinct approval/occurrence ids; first grant delivered, second denied; one total provider round; first dispatch succeeded/attempt 1, second failed/attempt 1. | Not editorial concept approval or deadline enforcement. |
| Scheduled Docker positive | Two provider rounds; actual container `/workspace`/environment assertions pass; dispatch succeeded/attempt 1; trigger disabled. | One selected fixture/provider posture, not every provider. |
| Scheduled tool negative | Two provider rounds; coding/container tools admitted, host read absent and refused, no sentinel disclosure; one succeeded dispatch/attempt 1. | No claim that all tools or arbitrary host commands are contained. |
| Inbox unavailable runtime | Coordinator used two rounds; no additional rounds across ticks, delegated message unread, zero fixture-page hits. | Ordinary configured operator delivery is not a protected-inbox fallback. |
| Inbox refusal/credential controls | Five rounds for private-fetch/peer refusal, zero page hits/writer messages; four rounds for container env credential assertions. | Fixture private page was not read; no injection-judgment claim. |
| Inbox admitted discovery | Four provider rounds, one daemon-owned SearXNG-shaped backend query, zero page fetches. | Synthetic inbox discovery only; not scheduled source retrieval/images or live research. |
| Teardown | Each fixture reports awaited daemon/mock closure; triggers disabled/removed through supported controls; private namespace exits. | Not independent proof of every Docker resource or arbitrary escaped writer termination; no manual owner acknowledgement. |

## Independent acceptance

Fresh native read-only reviewer run **`e288ac48-bd75-4bd1-b4ab-5fcb0259f0dc`**: **no issues found**,
limited-scope ACCEPT, merge verdict OK for the explicitly approved slice. The reviewer inspected
CLI authority preservation, scheduler/protected-origin contracts, fixture corrections, raw results
and actual facts. It executed nothing and did not independently recompute supplied source hashes.
[Verbatim retained review](BAZ-065-independent-review-20261017.md).

Its sole closure condition was the parent's hash comparison. **All 35 reviewed entries matched**
before acceptance bookkeeping. No code/test/security-manifest change followed that check. The
separately strengthened lifecycle case has SHA-256
`e2f5b72a5367ba69f3a9e6c15abfe307ae72e0c6033fbf2921d31562f824be6e`.

## Evidence retention and source identity

The temporary run directory was absent at closure. It is not asserted to remain available. Instead,
parent recovered the **exact previously recorded inventory and complete result JSON** from this
reviewer's saved `read` tool results—never by recomputing missing expected hashes from current code.
Only after recovery were current source bytes compared against those recorded expected hashes.

- [Reviewed 35-file inventory](evidence/BAZ-065-reviewed-source-20261017.json).
- [87 focused result records](evidence/BAZ-065-20261017/post-fix/focused.json).
- [14 process result records](evidence/BAZ-065-20261017/post-fix/process.json).
- [Verification summary](evidence/BAZ-065-20261017/post-fix/verification-summary.json).
- [Strengthened existing retry result](evidence/BAZ-065-20261017/retry-proof/tests.json).
- [Exact recorded status/lint/command readbacks](evidence/BAZ-065-20261017/recorded-reads.json).
- [Actual synthetic process/retry facts](evidence/BAZ-065-process-facts-20261017.json).

Source: native reviewer session
`/home/patri/.pi/agent/sessions/--home-patri-coding-bazilion--/2026-10-03T06-18-37-608Z_01a1006a-20a8-7629-ab4f-72fa0c5d594a/e288ac48-bd75-4bd1-b4ab-5fcb0259f0dc/run-0/session.jsonl`.
Recovered JSON retains recorded values, serialized for durable readability; it is not a new run or
an independently recomputed reviewer digest. Original failure counts/diagnoses above remain truthful
historical observations; vanished temporary files are not claimed as current proof.

**Done means the operator-approved limited slice is independently accepted**, not full CT or broader
beta. Node 24/platform/packaging and the final whole-release gate remain separate. No installation,
account change, original-daemon restart, commit, publication or release was performed.
