# BAZ-044 — implementation progress

Specialist verification of a captured code change. Story: [BAZ-044](in_progress/BAZ-044-specialist-verification-handoff.md) ·
refined 2026-09-09 · size L · priority high.

The story is one L because restricted dispatch, execution and evidence return form **one security
boundary** and one end-to-end user outcome. It is delivered in slices that each stay reviewable and
testable on their own, without ever shipping a path that routes the typed request through an ordinary
unrestricted inbox turn.

## Slice plan

| # | Slice | Outcome | State |
|---|-------|---------|-------|
| 1 | Typed request store | Schema, bounds, single-owner claims, per-attempt outcomes, restart/recovery and restore semantics | **done** |
| 2 | Request capture | Capture contract from an Agent or the operator: snapshot binding, ≤8 checks, admitted environment facts, blockers instead of substitution | **done** |
| 3a | Authorization and release | Verification authorizer on the canonical peer edge, a closed approval tuple, and a durable grant whose release commits with the decision | **done** |
| 3b | Dispatch | The preclaimed verification invocation is defined; claiming and admitting the tester turn is not wired yet | **in progress** |
| 4 | Admission | Revalidate, hold, reserve the workspace and refuse drift — with a settled claim when nothing ran | **done** |
| 5a | Capability tool surface | Two tools — read the request, run one captured check once — with no way to express a command | **done** |
| 5b | Daemon capability host | Captured values only, receipts always, and settle reports evidence availability | **done** |
| 5c | Worker spec + IPC transport | The verification turn is a real restricted worker kind, wired end to end | **done** |
| 5d-1 | Restricted invocation + IPC host binding | The turn identity is a restricted invocation; the daemon re-checks the worker's request/attempt | **done** |
| 5d-2 | Protected check executor + dispatcher | Running a captured command daemon-side with a BAZ-041 receipt, then claim/spawn/settle | **not started** |
| 4 | Workspace and snapshot revalidation | Reserve the workspace for the interval; block on drift before execution; unknown after source mutation | |
| 5 | Restricted test capability | Worker surface that can inspect the request and invoke each captured command once — no Bash/edit/write/browser/MCP/deploy | |
| 6 | Evidence return and surfaces | Per-request access, API/CLI/web, cancellation, expiry, Telegram notices | |
| 7 | Acceptance | End-to-end acceptance evidence, adversarial gate cases, defect and gap closure | |

## Slice 1 — typed request store (done)

**What landed.** Four tables in `0001_init.sql` (`verification_requests`, `verification_checks`,
`verification_attempts`, `verification_check_outcomes`) and
`apps/daemon/src/core/repos/verification-requests.ts`, with 12 unit tests plus one restore-integration
test in `apps/cli/test/backup-coding-recovery.test.ts`.

**Decisions worth keeping.**

- **The captured contract is immutable; outcomes belong to an attempt.** A second attempt writes its
  own outcome rows beside the first attempt's, so a rerun never rewrites the history of a receipt. The
  original layout (outcome columns on `verification_checks`) was rejected while implementing the rerun
  test, because it forced a rerun to either overwrite or be refused.
- **Claiming is transactional and leased, and settled is settled.** A claim persists *before* any
  command runs, which is what makes an interrupted execution recoverable as `uncertain` instead of
  replayable. Only the lease owner can finish an attempt, and an attempt cannot be finished twice, so
  a late writer cannot revise an outcome.
- **An interrupted claim becomes `uncertain` — never `pending`.** Recovery settles another process's
  open attempt as `uncertain` with its unreported checks `unknown`; nothing is auto-replayed. A live
  claim held by the current process is left alone.
- **Executor facts are not model claims.** `command_id`/`exit_code` are written only by
  `recordVerificationCheckOutcome`, which requires a receipt for executed outcomes and refuses one for
  `skipped`/`blocked`/`unknown`, refuses an exit code outside `succeeded`/`failed`, and is refused a
  second time for the same ordinal. A fabricated receipt reference fails the foreign key: provenance
  cannot be invented.
- **The request is bounded before anything is written.** ≥1 and ≤8 checks, non-empty command and
  purpose, 1–300 s timeouts, bounded summary, no self-verification, and an operator request carries no
  requester Agent (enforced in both the repo and the schema, so a forged row cannot exist either).
- **Expiry is seven days and reads as absence.** An expired request is not served, in the repo or
  through the Team-scoped read, because its evidence window closed.
- **`purpose: 'verification'` is a new `CodingPurpose`, owned by the runner.** The `coding_command`
  tool keeps its explicit five-value enum, so an Agent cannot label an ad hoc command as someone
  else's verification.

**Restore semantics** (`apps/cli/src/backup-coding-recovery.ts`, in the staged-restore transaction):

- Requests past their window are dropped; requests whose captured snapshot did not survive are
  `blocked` rather than silently run against an unknown tree.
- Open attempts become `uncertain`; outcomes left `not_executed` become `unknown`.
- Receipt-backed outcomes are invalidated to `unknown` (with `command_id`/`exit_code` cleared), and
  their attempts and requests become `uncertain`, because the restore invalidated the receipts those
  outcomes refer to. A copied home must not present another home's evidence as current.

**Schema obligations handled.** `CANONICAL_OBJECTS` extended (110 objects, verified to match
`sqlite_schema` exactly) and `CANONICAL_SCHEMA_HASH` recomputed to
`2fd72d3d59186e9f99a04de117db32aac0a348bac9f05b334d31169c8daa74fd`.

**Verification.** `pnpm typecheck` clean; `pnpm format`/`pnpm lint` clean; 53 tests across the
verification, restore, coding-log and coding-redaction suites pass.

## Slice 2 — request capture (done)

`apps/daemon/src/lib/verification/capture.ts` plus hermetic wire shapes in
`packages/api-types/src/verification.ts` (19 exported types, including the closed
`VerificationBlockerReason` list). Five tests in `apps/daemon/test/lib/verification-capture.test.ts`.

**Decisions worth keeping.**

- **Capture validates the inputs, not the caller's description of them.** The snapshot must exist in
  this Team inside its window *and* have complete coverage; the specialist must be a live,
  non-archived member of the same Team; the requester must be a member and never the specialist
  itself; the environment is the one the Team is admitted into right now, resolved passively so a
  capture can never have side effects on the repository.
- **A blocker is a result, not an exception to be smoothed over.** Every refusal carries a reason
  from a closed list and a detail, and a refused capture leaves nothing behind — verified by asserting
  zero rows after ten different refusals.
- **`readVerificationReport` composes contract + attempts + three-valued applicability**, and reports
  `unknown` — with no tested snapshot id — when there is nothing to compare. Editing the source flips
  it to `changed`, never to a pass.

**A test that passed for the wrong reason, caught by typecheck.** The incomplete-coverage test passed
`limits: { maxFileBytes: 16 }`; `maxFileBytes` does not exist on `ReviewLimits` (it is `fileBytes`),
so the limit was silently ignored and the assertion happened to hold through a different path. It now
includes an untracked file explicitly with `fileBytes: 16` and asserts *which* entry could not be read
(`tooLarge`), so the refusal is about coverage and nothing else. Vitest strips types, which is exactly
why `pnpm typecheck` is part of the loop.

## Slice 3a — authorization and approval release (done)

`authorizeVerificationRequest` (`lib/communication.ts`), the `verification_request` delivery-plan kind
(`lib/approval-delivery-plan.ts`), a `grantVerificationRequest` grant path
(`core/repos/communicationApprovals.ts`), and the preclaimed `specialist_verification` invocation kind
(`lib/turn-invocation.ts`). 16 further tests across the invocation, approval-plan and authorization
suites.

**Decisions worth keeping.**

- **The request id *is* the attempt id.** Policy evaluation, a held approval and dispatch all key on the
  same identity, so a released approval cannot be replayed onto a different request. Enforced in the
  plan validator and in the invocation validator.
- **A verification turn is always the protected surface**, even on a loopback daemon, and its
  `bashApprovalMode` is `auto_deny`: it has no operator authorization to inherit, and an unattended
  command needing shell approval stays blocked rather than being auto-approved.
- **The invocation is a closed nominal value.** Rebinding the claim to another Agent or attempt, adding
  a key, or downgrading the approval posture all fail validation; the preclaimed turn is consumed
  exactly once at preparation handoff, like a scheduler or inbox claim.
- **One durable grant, with the release committed inside the decision.** `grantDurableApproval` was
  extracted so verification and scheduler grants share exactly one implementation; an `onGranted` hook
  runs inside the decision transaction, so a granted approval cannot be delivered without its guarded
  effect having happened. A request whose inputs no longer hold is refused as `delivery_failed`, and a
  policy or membership change denies rather than grants.
- **Operation and payload kind are a pair.** They differ for verification
  (`request_verification` / `verification_request`) but must both match, so an approval cannot be
  released by a handler other than the one that captured it. Conflating them was a real bug caught by
  the grant test.
- **Adding a plan kind fails closed at the delivery site.** The Telegram delivery block now narrows
  through `isTelegramDeliveryPlan` instead of assuming the remaining kinds are Telegram ones; the guard
  is statically unreachable today and becomes live the moment a kind is added without a handler.

## Slice 4 — admission (done)

`apps/daemon/src/lib/verification/admission.ts` and four tests in
`apps/daemon/test/lib/verification-admission.test.ts`.

**The order is the security property**, and it is deliberate:

1. **Revalidate before claiming anything durable.** The specialist must still be a live member of the
   same Team, the captured evidence must still be inside its window, and the canonical edge must still
   permit the request. A request that can no longer be honoured is refused without leaving an attempt
   behind — asserted by checking there are zero attempts after a refusal.
2. **Claim the single dispatch slot** through the leased, transactional claim, so an execution that is
   interrupted is recoverable as `uncertain` rather than replayable.
3. **Reserve the workspace exclusively, then prove the reserved tree is the captured one.** A coder or
   an external editor may have moved the tree while the request waited; running here would test a
   different change and call it verified.

**Decisions worth keeping.**

- **Policy is re-evaluated on every attempt, and the gate is respected.** A request that was allowed
  when captured is not allowed forever, but with Team Policy enforcement off the edge is an
  unconditional allow — otherwise admission would invent a policy decision the runtime is not making.
- **A `deny` blocks; an `approval_required` holds.** The latter captures the attempt through the
  canonical approver (agent→agent or user→agent, matching who asked) and returns `held`; release never
  executes anything. A policy that reports `approval_required` *without* capturing the attempt is
  treated as a contract breach and blocks rather than running.
- **A busy workspace is a deferral, not a failure.** A claimed-but-unstarted attempt is settled
  honestly: `failed` with its checks `blocked`, and the request `blocked` with `source_changed` or
  `source_unverifiable` — never `succeeded`, and never left `running` holding the slot.
- **Nothing is substituted**: not a different tree, not a relaxed policy, not a fresh snapshot. The
  drift refusal names the remedy (a fresh capture) instead of quietly re-capturing.
- **`unknown` applicability is refused as `source_unverifiable`, not assumed to match**, so "we could
  not prove the tree is the captured one" and "the tree changed" stay distinguishable.

**Still unwired, deliberately.** Admission is not yet reachable from the scheduler, and that stays true
until slice 5 exists: a dispatcher that claims a request without being able to execute its checks would
leave work stuck in `running`. The repo therefore still contains no path that can execute a
verification request end to end.

**Verification.** 1048 tests pass across daemon lib/core/routes; typecheck, format and lint clean.

## Slice 5a — the specialist's capability (done)

`apps/daemon/src/runtime/tools/verification.ts` and six tests in
`apps/daemon/test/runtime/verification-tools.test.ts`.

**The property that matters is negative.** There are exactly two tools and neither can express a
command, a cwd, a timeout, an environment change, or a second run of a settled check. The tests assert
that as a fact about the tool schemas rather than trusting the description: `verification_check`'s
parameters are exactly `{ ordinal }` with `additionalProperties: false`, and no `command`, `cwd`,
`timeoutMs`, `env` or `shell` key exists to be passed.

**Decisions worth keeping.**

- **The daemon host is authoritative for all three rules** (declared ordinals, once-only, receipt per
  outcome). The tool layer repeats them as defence in depth, so a specialist gets a clear refusal
  instead of a silently different run — and a widened request is *refused*, not trimmed to fit.
- **Two distinct refusals, for two distinct situations.** A tool instance that already ran a check
  refuses with "already running"; a reloaded instance refuses from the settled state recorded on the
  request ("already reported 'succeeded'"). Conflating them would hide which rule fired.
- **A refused invocation stays runnable, but only because nothing executed.** A refusal (for example a
  missing toolchain) clears the in-flight guard; a reported outcome never does. A check that reported
  a failure is not rerunnable to get a better answer.
- **The brief labels an incomplete capture** (`INCOMPLETE COVERAGE`) and reports applicability
  verbatim, so the specialist cannot mistake a three-valued comparison for a pass.

## Slice 5b — the daemon-side capability host (done)

`apps/daemon/src/lib/verification/runner.ts` and six tests in
`apps/daemon/test/lib/verification-runner.test.ts`.

**This is where the captured contract meets execution**, and it is the authority for the three rules
the worker also enforces: only declared ordinals run, each runs once, and every reported outcome
carries the receipt that produced it.

**Decisions worth keeping.**

- **The captured values are used verbatim.** The executor receives the captured command, cwd, timeout
  and purpose, and the request's declared writable paths — there is no parameter through which a
  caller could widen them, so the test asserts the executor saw exactly `pnpm test failing` at
  `/workspace` for 5,000 ms as purpose `verification`.
- **An executed outcome without a receipt is refused, not stored.** Provenance is never fabricated;
  the check stays `not_executed` and the refusal is raised to the caller, so a failed bookkeeping
  path cannot masquerade as a verification result.
- **A blocked check is explicit and stays runnable.** It records `blocked` with no receipt and its
  reason text, which is distinct from `skipped` (the specialist chose not to run it), `unknown`
  (interrupted) and `failed` (it ran and exited non-zero).
- **Settling reports evidence availability, never a verdict about the change.** A check that exited
  non-zero is a *result*, so the attempt completes with evidence and the per-check facts carry the
  failure — conflating that with "the verification could not run" would erase the distinction the
  story requires. Only when nothing executed at all does the attempt fail, with
  `no captured check executed`.
- **A partial run never reads as a full one.** Checks the specialist never ran are settled as
  `skipped` with a timestamp, so a report cannot present an unrun check as if it had passed.
- **Settling never overwrites another owner's claim.** A mismatched lease owner returns `uncertain`
  and leaves the attempt open for its real owner.

**Verification.** 1386 tests across daemon lib/core/routes/runtime; typecheck, format and lint clean.
One failure appeared in the first full run and did not reproduce on re-run — consistent with the
pre-existing load-related flake recorded in the BAZ-042 acceptance caveats; not claimed deterministic.

## Hardening pass — the two open notes (done, before 5c)

### Note 1: the flake is found, explained and fixed

The flake was **not** in the product: it was a test fixture that depended on git's stat cache.

`apps/daemon/test/routes/git-review.test.ts` simulated a modification by writing `'changed\n'` over a
file committed as `'one\ntwo\n'` — **the same eight bytes**. Git decides dirtiness from recorded stat
data (size, mtime, ctime) plus its racy-git rules, so when the write landed in the same filesystem
timestamp tick as the stat git had recorded during `git add`/`commit`, git reported the entry clean.
The capture then honestly listed no changed path, and the test failed.

**How it was proven, not guessed.** A throwaway probe (`/tmp/snap-probe.mts`, deleted after use) looped
the exact capture twice in a fresh repository and dumped both manifests on any id mismatch:
**8 mismatches in 400 iterations**, and every one showed the second capture listing `entries: []` while
the first listed `app.txt`. After changing the fixture to an unambiguous edit of a different length:
**0 mismatches in 600 iterations.**

Two further failures appeared only under the harness's artificial 3×-concurrent full suites, and both
were load-sensitive *test* timeouts, not product behaviour:

- `bootstrap-identity-startup` / `legacy-schema-startup` capped the spawned daemon at 5 s with
  `kill('SIGKILL')`, so a loaded machine turned a correct `exit 1` into a spurious `SIGKILL` mismatch.
  Both caps are now 30 s, because the cap exists to stop a hung child, not to bound a legitimate boot.
  The comment says so at both sites.
- `apps/web/test/security-gateway.integration.test.ts` builds the web UI in `beforeAll` under a 60 s
  timeout, which three concurrent suites cannot meet. Raised to 240 s.

**Two sequential full suites now pass cleanly: 1698 passed / 7 skipped (1705), twice.** Before this
pass, the same suite failed roughly 1 run in 7.

**The limit is documented rather than hidden.** `snapshot.ts` and `docs/coding-evidence.md` now state
that a snapshot enumerates what git reports as changed, that a same-size same-tick edit can therefore
compare `identical`, and why Bazilion does not re-hash the whole tree to second-guess git — evidence
that disagrees with the repository's own view would be worse, not better.

### Note 2: the "no ordinary inbox turn" invariant is now checked

It was previously true by construction. It is now asserted twice:

- Capture writes **zero** `messages` rows — including on a blocked capture — so an inbox wake has
  nothing to consume. A request that carries a peer message id only references one.
- A verification turn cannot be smuggled through the inbox path, **in either direction**: an
  inbox-wake origin with the verification kind is refused, and a verification attempt id cannot drive
  an inbox wake. A genuine verification turn is never a user turn, owns no user authorization, and is
  always the protected surface.

**Harness note (not committed).** The repeat-run harness lives in `/tmp/flake-hunt.sh` and is
deliberately not a repo artifact: it runs N concurrent *full* suites, which is a load amplifier rather
than a normal invocation. Under 3× concurrency, two further environment-heavy tests contend for shared
resources (`browser-live` for Chromium, `shell-docker` for the Docker daemon). Those did not appear in
sequential runs and are not claimed fixed.

## Slice 5c — the verification turn is a real restricted worker (done)

`SpecialistVerificationWorkerSpec` + input validation in `runtime/worker/runtime.ts`, two IPC methods
(`verificationRead` / `verificationRun`) and a `VerificationHost` in `runtime/worker/ipc-protocol.ts`,
the tool assembly in `runtime/worker/entry.ts`, and the host-clearing/isolation rules plus
`spawnVerificationWorker` in `runtime/worker/spawn.ts`. 908 tests pass across the daemon runtime and
lib suites; typecheck and lint clean.

**Decisions worth keeping.**

- **The worker input is closed.** `VERIFICATION_KEYS` is exact, so a verification turn cannot smuggle
  an extra field — there is no `codingHost`, `repositoryContext`, `resultHost`, `containerNamespace` or
  `questionEnabled` for it to carry, and `assertProtectedProviderRuntime` plus bound API key refresh
  are still required.
- **The request identity is bound in the worker, not sent by the tool.** `createIpcVerificationHost`
  closes over `input.verification`, so a call carries only an ordinal and **cannot address another
  request's attempt**. Only the two methods exist; there is no generic invoke.
- **Every restricted host is cleared in one place.** `isRestrictedWorkerKind` is now a type guard used
  for all of them, and it clears `messagingHost`, `userMdHost`, `browserHost` and `mcpHost` for
  restricted kinds as well as the coding/container/context/result hosts. Previously those four were
  left to the caller simply not to pass; a verification turn does not message peers, edit USER.md,
  drive a browser or call MCP, so the spawner refuses to hand them over.
- **The session is a restricted session with an injected tool list.** `createRestrictedReviewSession`
  is reused deliberately: the difference between a review turn and a verification turn is the tool
  list, and neither path can reach a general coding surface. The system prompt states the boundaries —
  one declared ordinal, once each, no shell or editor or browser or network, generated output only to
  declared paths — and asks for a recommendation-free summary, since a specialist's conclusion is not
  authorization for anything.
- **Questions and images are excluded by kind**, not by convention, in the same places restricted
  reviews already were.

## Slice 5d-1 — restricted invocation and the bound capability (done)

**A design correction, found by reading the code this would have to fit into.** Slice 3a gave the
verification turn a `TrustedTurnInvocation` variant carrying a **preclaimed lifecycle turn**. That is
the shape used by scheduler and inbox turns, which go through `prepareAgentTurn` — and `prepareAgentTurn`
would have consumed the claim and built a *coding* session (system prompt, repository context, session
directories, coding tools) that a verification turn must not have. Worse, a restricted turn is
dispatched directly, like a restricted review, so nothing would ever have consumed that claim: the
preclaimed turn's `releaseLease` would simply have leaked.

It is now a **restricted invocation** (`restricted_verification`, authorization
`{kind: 'request', requestId, attemptId}`), mirroring the restricted review one — one restricted-turn
pattern instead of two, no claim to leak, and no turn payload to inherit authorization from. The
contract is closed: the kind, the `auto_deny` posture and the exact authorization keys are all
validated, a raw or cloned value is never trusted, and a verification invocation cannot be asserted as
a normal turn or vice versa.

**The daemon does not take the worker's word for its identity.** `bindVerificationCapability` checks the
request and attempt the worker sends against this turn's own binding and refuses anything else before
the host is reached, so a compromised worker still cannot read another request or run its checks. The
capability host is also required for a verification turn and forbidden for every other kind, so a
misconfigured spawn fails closed rather than starting a worker with the wrong surface.

**A tightening for the review path too.** The restricted-spawn guard now rejects `codingHost`,
`containerHost`, `repositoryContextHost`, `resultHost` and `resourceLifecycle` along with the messaging,
USER.md, browser, MCP and question hosts. A restricted review previously failed *later* (when the worker
refused to run without a context host); it now fails before the child starts. The existing test asserting
that property was updated to the earlier, clearer refusal — the property it checks is unchanged and the
host is still never called.

## What 5d-2 needs

The dispatcher itself is unremarkable: it mirrors `review-dispatcher.ts` — busy check, lifecycle lease,
`registerAgent`, admit, resolve, prepare, drain frames, settle, release the workspace.

What blocks it is the **executor**: `VerificationCheckExecutor.run` must execute one captured command
in the Team workspace under the admitted posture and produce a BAZ-041 receipt. The existing coding
path runs commands *inside the worker* through `codingHost`; a verification turn deliberately has no
`codingHost`, so the daemon needs its own protected check executor — command execution, timeout,
cancellation, redaction and receipt publication — before the dispatcher can be wired. Shipping the
dispatcher without it would claim requests that could never run their checks, which is exactly the
half-wired state this story must not ship.

## 5d-2 handoff — what the daemon-side check executor must be

Written after reading the code it has to fit, so the next chunk starts from facts rather than
re-derivation. **No half-wired code was committed for this**: a dispatcher that claims requests whose
checks cannot run is the one state this story must not ship.

**Why a daemon-side executor is needed at all.** Today a coding command is executed by pi's bash tool
*inside the worker*, with the daemon's `codingHost` only creating the receipt (`action: 'start'`), the
worker running the process, and the host finishing it (`action: 'finish'`) — see
`lib/coding-environment/agent-host.ts:149-302`. A verification turn deliberately has no `codingHost`,
so its captured checks must be run by the daemon itself.

**There is no generic "run this command" helper to reuse.** The only daemon-side spawns are
`lib/git/capture.ts` (git) and `runtime/shell/docker.ts` (the protected container path). So the
executor must assemble the spawn itself from the existing, already-hardened pieces:

- `resolveShellSecurityConfig(env)` for the admitted posture and `buildScrubbedShellEnv(...)` for the
  container/host environment allowlist (`runtime/shell/security.ts`);
- `buildDockerRunSpec(...)` for the Docker path (`runtime/shell/docker.ts:193`) — already validates
  the docker path, image, container name and mount arguments;
- `codingContainerCwd(cwd)` for the contained cwd (`runtime/shell/coding.ts`);
- `requireBashApproval(...)` and the approval host for the dangerous-command gate
  (`runtime/shell/approval.ts:37`) — a check needing an unavailable approval must stay an explicit
  `blocked` outcome, never an auto-approve;
- the BAZ-041 receipt lifecycle it must feed: `saveCodingCommand(...)` running → terminal, and
  `saveCodingCommandLog(...)` for the retained 64 KiB tail, with the secrets supplier shared between
  the receipt and mid-turn redaction (BAZ-041 gap 3).

**Contract to satisfy.** `VerificationCheckExecutor.run` returns
`{commandId, state, exitCode, output, truncated}` — `commandId` only for the states that executed
(non-negotiable: `runner.ts` refuses an executed outcome without a receipt), `blocked` with no receipt
and a reason when a toolchain, service or approval is unavailable. The state must come from the observed
process outcome, never from the model's description of it.

**Then the dispatcher is mechanical**, mirroring `review-dispatcher.ts`: busy check →
`acquireAgentLifecycleLease` → re-check → `registerAgent` → `admitVerificationRequest` (which already
revalidates, reserves the workspace and refuses drift) → `prepareVerificationTurn` →
`bindVerificationCapability` → drain frames → `settleVerificationAttempt` → release the workspace →
`unregisterAgent`. Cancellation must settle the attempt `cancelled` rather than leaving it `running`,
and an interrupted process must keep the `uncertain` semantics already implemented in the store.

**Schedule wiring last.** A scheduler tick that dispatches eligible `pending` requests is the final step,
after the executor and dispatcher exist — not before.
