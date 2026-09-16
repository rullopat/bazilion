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
| 2 | Request capture | Capture contract from an Agent or the operator: snapshot binding, ≤8 checks, admitted environment facts, blockers instead of substitution | |
| 3 | Dispatch owner | One trusted invocation kind for verification, preclaimed turn, approval release, no inbox-wake consumption, no replay | |
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
