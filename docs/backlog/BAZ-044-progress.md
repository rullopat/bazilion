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
| 5 | Restricted test capability | Worker surface that can inspect the request and invoke each captured command once | |
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
