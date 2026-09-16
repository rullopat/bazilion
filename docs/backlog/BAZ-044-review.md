# BAZ-044 — in-depth defect review

Audit of the implemented story against its own scope, acceptance criteria and the surrounding system.
Every finding below was **verified in the code or with a throwaway probe**, not inferred from the
summary I wrote while building it. Probe scripts were deleted after use; their raw output is quoted.

Ordered by severity. **S1, S2, S7b and S8 are fixed** (with regression tests) in the commits following
this review; S3–S6 and S9–S12 remain open, with the fix sketched for each.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| S1 | Pruning a referenced receipt is impossible; breaks every later receipt save in the Team | high | **fixed** |
| S2 | Restart recovery written but never called; interrupted request stuck forever | high | **fixed** |
| S3 | A held request can be approved and still never run | high | open |
| S4 | Operator-created held request produces an invalid approval tuple (500, stuck) | high | open |
| S5 | Host-mode check runs with the daemon's ambient environment, receipt claims `protected` | medium-high | open |
| S6 | `writablePaths` captured but never enforced | medium | open |
| S7 | Cancel over-broad (aborts an unrelated turn) | medium | open |
| S7b | Cancel cannot cancel an `awaiting_approval` request at all | medium | **fixed** |
| S8 | Settlement mutates outcomes before validating ownership | medium | **fixed** |
| S9 | List route has a second report composer; captures the tree once per request | medium | open |
| S10 | Expired requests are never pruned | low-medium | open |
| S11 | A pruned receipt is indistinguishable from one that never existed | low | open |
| S12 | Dead code (`VerificationCheckWrite.label`) | trivial | open |

---

## S1 — A verification outcome makes receipt pruning impossible, which then breaks every later receipt in that Team (high, reachable by normal use)

`verification_check_outcomes.command_id` declares `ON DELETE SET NULL`, but the table also carries a
**bidirectional** CHECK:

```sql
CHECK ((command_id IS NOT NULL) = (state IN ('succeeded', 'failed', 'timed_out', 'cancelled')))
```

So when a referenced `coding_commands` row is deleted, the `SET NULL` action produces a row with
`state = 'succeeded'` and `command_id = NULL`, which violates the CHECK — and SQLite rejects the delete.
`saveCodingCommand` calls `pruneCodingCommands` on **every save**, so this is not an edge case in a
quiet system; it is a poisoned state that makes all further receipt writes fail in that Team.

Probe output (`pruneCodingCommands` after one verification outcome plus fillers):

```
outcome recorded: true
receipts: {"c": 206}
PRUNE THREW: CHECK constraint failed: (command_id IS NOT NULL) = (state IN ('succeeded', 'failed', 'timed_out', 'cancelled'))
```

The first probe attempt revealed a second, narrower trap on the way: `coding_commands` is unique on
`(agent_id, turn_id, tool_call_id)`, so filler receipts need distinct turn ids. Not a defect, but it
means a Team whose receipts share a turn id will conflict on insert.

**Impact.** A Team that has ever run one verification check cannot prune; the next command receipt save
throws. Verification checks would start failing as `blocked` (a thrown executor is mapped to a blocker),
and coding receipts would fail too — a cross-feature outage caused by a constraint I added.

**Fix.** Make the constraint one-directional, so it still refuses a receipt on a state that did not
execute but permits an executed state whose receipt was pruned:

```sql
CHECK (command_id IS NULL OR state IN ('succeeded', 'failed', 'timed_out', 'cancelled'))
```

Keep the two-way rule in `recordVerificationCheckOutcome`, which is where it is actually enforceable.
This is a schema change → `CANONICAL_SCHEMA_HASH` must be recomputed. **Test to add:** record an
outcome, fill past `CODING_COMMAND_MAX_PER_TEAM`, prune, assert the verifier's receipt is gone and the
outcome still reports its state and exit code.


**Status: fixed.** The CHECK is now one-directional; `CANONICAL_SCHEMA_HASH` recomputed to
`cb3811823a7dead88cce0beb08cd4066ea3143258af0f0b8ba329016465dda37`. Regression test added
("pruning a coding receipt leaves the verification outcome readable").
---

## S2 — Restart recovery is written and tested but never called, so an interrupted request is stuck forever (high, missed implementation)

`recoverInterruptedVerificationAttempts` exists and is covered by a unit test, but nothing calls it:

```
$ grep -rn "recoverInterruptedVerificationAttempts" apps/daemon/src apps/cli/src --include=*.ts | grep -v verification-requests.ts
(nothing)
```

The codebase has an established place for exactly this — `apps/daemon/src/lib/ctx.ts:104-109` runs
`recoverInterruptedQueue`, `recoverInterruptedQuestions`, `recoverInterruptedNotifications`,
`interruptCodingCommands`, `recoverInterruptedResultDeliveries` at startup. Verification recovery is
absent from that block.

**Impact.** After a crash or restart with an attempt open, the attempt stays `claimed`/`running`
belonging to a dead process identity, the request reads `running` while nothing runs, and the unique
index `verification_attempts_one_open_per_request` means **no new attempt can ever be claimed** for it.
The story's "resume only eligible pending work after restart; an interrupted claimed execution remains
uncertain and is never automatically replayed" is not actually satisfied end to end.

**Fix.** Call `recoverInterruptedVerificationAttempts(db, <daemon identity>)` in that startup block. The
identity used by claims today is a module-level `VERIFICATION_DISPATCH_OWNER` random UUID — which is
*re-created on every process start*, so it already behaves as "this process". Recovery compares against
it correctly, but the name is misleading; a comment or an explicit process-identity value would be
clearer.


**Status: fixed.** Wired into the daemon's startup recovery block in `ctx.ts`, beside
`interruptCodingCommands`.
---

## S3 — A held request can be approved and still never run (high, missed implementation)

`admitVerificationRequest` sets `awaiting_approval` when the edge requires approval (confirmed: the only
writer of that state is `admission.ts:145`). The delivery plan recognises the request and `deliver()`
treats it as a durable grant, and `grantVerificationRequest` exists with an `onGranted` hook that would
release the request — **but no caller exists**:

```
$ grep -n "verification_request\|grantVerificationRequest" apps/daemon/src/routes/approvals.ts
324:  if (plan.kind === 'verification_request') {
```

The scheduler-trigger analogue has a dedicated branch in the approve route (`pendingPlan.kind ===
'scheduler_trigger'` → `grantSchedulerTrigger`). There is no equivalent branch for verification, so
approving the request marks the approval complete while the request state never advances — and
`dispatchPendingVerifications` selects only `state = 'pending'`.

**Impact.** Any request on an `approval_required` edge is permanently stuck in `awaiting_approval`. The
story lists approval-held as a state that completes, so this is a missing leg of criterion 2.

**Fix.** Add the branch mirroring `grantSchedulerTrigger`: revalidate policy, validate that the request
is still dispatchable, and pass `onGranted` to move `awaiting_approval → pending`. **Test to add:**
hold on a real edge, approve through the route, assert `pending` and that the next tick dispatches.

---

## S4 — An operator-created request that needs approval produces an invalid approval tuple (high)

`admitVerificationRequest` captures the attempt for an operator requester via `authorizeUserIngress`,
whose operation is **`user_to_agent`**, while the payload kind is `verification_request`. But
`planApprovalDelivery` requires both to match the verification pair:

```ts
approval.operation !== 'request_verification' → invalid('verification_request_payload')
```

So an operator request on an approval-required edge yields an approval the plan validator rejects. The
approve route then treats that as a terminal delivery failure and returns **500** — the request is stuck
in `awaiting_approval`, and the operator sees a delivery failure rather than a decision they can act on.

Agent-requester requests are unaffected (they go through `authorizeVerificationRequest`, which uses
`request_verification`).

**Fix.** Either capture the operator case with the same `request_verification` operation (the authorizer
already distinguishes user→agent by its source/target, so the operation name need not encode it), or
accept both operations for the verification payload kind in the plan validator. The first is cleaner and
keeps one operation per attempt kind.

---

## S5 — A host-mode check runs with the daemon's ambient environment while its receipt claims `posture: 'protected'` (medium-high, security-relevant)

The executor passes the daemon's environment to the command:

```ts
const env = input.env ?? process.env
…
...(isContainer ? {} : { env }),
```

and stamps the receipt `posture: 'protected'`. A protected *coding* worker, by contrast, runs with
`minimalWorkerProcessEnv(scratch)` — the minimal allowlisted environment BAZ-031 established for
protected execution. So a captured check in host mode (the default, `BAZILION_BASH_SANDBOX=off`) inherits
whatever credentials the operator's shell exported to the daemon, and reports that it ran in a protected
posture.

**Impact.** A check — including one a peer agent asked for — can read ambient provider credentials that
the equivalent protected coding command cannot see. It contradicts the receipt, which is supposed to be
the evidence of the environment.

**Fix.** Build the host-mode environment the same way a protected turn does: the scrubbed allowlist env
(or `minimalWorkerProcessEnv` with the turn's scratch), never `process.env`. Note the container path is
already correct (`buildSandboxContainerEnv` applies the allowlist and pins container paths).

---

## S6 — `writablePaths` is captured but never enforced (medium, missed implementation)

The request records declared writable output paths, `VerificationCheckExecutor.run` receives them, and
the executor **ignores them entirely**:

```
$ grep -c "writablePaths" apps/daemon/src/lib/verification/executor.ts
0
```

The story's scope is explicit: "Test processes may write declared generated output/cache locations in the
approved workspace and temporary environment." Today the declaration is decorative — in host mode a check
may write anywhere the daemon can, and in container mode the mount is the whole Team workspace
read/write regardless. It is also shown to the specialist in the brief, which implies it constrains
something.

**Fix (bounded).** Either enforce it (host mode: reject a command whose cwd is outside the workspace and
document that host mode cannot confine writes; container mode: mount only the declared paths read/write
and the rest read-only) or stop presenting it as a constraint. Enforcing partial confinement honestly is
better than implying full confinement.

---

## S7 — Cancel is both over-broad and incomplete (medium)

```ts
const aborted = cancelAgent(record.recipientAgentId)
if (!aborted) {
  if (record.state === 'pending') setRequestState(db, record.id, 'cancelled')
  else return c.json({ error: 'Verification request is not cancelled yet; retry' }, 409)
}
```

Two problems:

1. **Over-broad.** `cancelAgent` aborts whatever turn that agent is currently running. The dispatcher
   registers the verification turn under the agent id, so normally that is the right turn — but if the
   request row is `running` while the agent's active turn is something else (an ordinary chat turn
   started after an unsettled verification attempt), cancelling the request kills unrelated work. There
   is no check that the active turn belongs to *this* attempt; `ownsActiveAgent(agentId, controller)`
   exists but the route has no controller reference.
2. **Incomplete.** An `awaiting_approval` request with no active turn falls into the `else` and returns
   409 **without cancelling anything** — so a held request can never be cancelled, although it is listed
   as cancellable by the UI and by the story's state table.

**Fix.** Track the dispatch owner per request (a small registry keyed by `requestId`, or the open
attempt's id checked against the running turn) so cancel targets the right turn; and treat
`pending`/`awaiting_approval` as directly cancellable states, clearing any held approval.


**Status: partially fixed.** A `pending` or `awaiting_approval` request is now cancelled directly.
The over-broad abort remains open, because targeting the right turn needs a dispatch-owner registry keyed
by request id.
---

## S8 — Settlement mutates outcomes before validating ownership (medium, latent)

In `settleVerificationAttempt` the `state = 'skipped'` update runs **before** `finishVerificationAttempt`
checks the lease owner, so a call by a non-owner writes `skipped` outcomes onto another owner's attempt
and only then returns `uncertain`. The dispatcher always passes the right owner, so it is latent today —
but the function's own contract says it must not overwrite another owner's work, and the check exists.

**Fix.** Validate ownership first, or perform the skipped-marking and the attempt finish inside one
transaction gated on `lease_owner`.


**Status: fixed.** Settlement now performs an ownership gate before writing anything, and returns
`uncertain` without touching the attempt when it does not own it.
---

## S9 — The list route has a second report composer, and it captures the tree once per request (medium)

`readVerificationReport` composes request + checks + attempts + applicability, and `show` and `cancel`
use it. The **list** route builds its own equivalent inline (`teams.ts:884`, with a local
`applicabilityFor`):

```
$ grep -n "readVerificationReport|applicabilityFor(db" apps/daemon/src/routes/teams.ts
78:  readVerificationReport,
884:        applicability: await applicabilityFor(db, paths, team.id, record),
940:    const report = await readVerificationReport(
```

Criterion 6 is precisely "API/CLI/web agree", and this is where they can silently diverge: the list
composer and the single-request composer must be kept in step by hand. It also makes listing expensive —
`readSnapshotApplicability` performs a full in-memory tree capture, so a Team with 20 requests runs
**20 whole-tree captures** to render one page, whether or not anyone looks at a request.

**Fix.** Reuse `readVerificationReport` in the list path, and either compute applicability per request
lazily (on demand, like the BAZ-042 chat card) or omit it from the list and let the detail view ask.

---

## S10 — Expired requests are never pruned (low-medium)

`pruneVerificationRequests` exists but has no caller outside tests:

```
$ grep -rn "pruneVerificationRequests" apps/daemon apps/cli --include=*.ts | grep -v core/repos/verification-requests.ts
(nothing)
```

Coding commands, coding logs and source snapshots all have retention sweeps; verification requests,
checks, attempts and outcomes do not. Reads filter by `expires_at`, so nothing is *served* past its
window — but rows, their manifests and their outcomes accumulate for the life of the home.

**Fix.** Add a sweep to the same retention path the other evidence tables use.

---

## S11 — A pruned receipt is indistinguishable from a check that never had one (low, honesty gap)

After S1 is fixed, an executed outcome whose receipt was pruned shows `succeeded` with `commandId: null`
and no indication that evidence existed and is gone. My acceptance record claims "lost or deleted
evidence stays visibly unavailable"; for this case the report cannot tell "no receipt was recorded" from
"the receipt was deleted". The `coding_command_logs` table keeps its own tombstone states
(`expired`/`deleted`) precisely to avoid this ambiguity; outcomes have no equivalent.

**Fix.** Either keep a tombstone (a nullable `receipt_pruned_at`) or surface `not recorded` vs
`no longer available` as distinct in the report.

---

## S12 — Dead code (trivial)

`VerificationCheckWrite` and its optional `label` field in `core/repos/verification-requests.ts` are never
referenced. Either wire the label (a harness-supplied hint on a check) or delete it.

---

## Verified sound (so the audit is not only a list of faults)

- **Capability closure.** Tool schemas are asserted closed (`additionalProperties: false`, no
  `command`/`cwd`/`timeoutMs`/`env`/`shell` key), a widened request is refused rather than trimmed, and
  the daemon re-checks the worker's request/attempt identity against its own binding before the host is
  reached. Verified by tests, and the failure mode is a refusal, not a silent run.
- **Claim discipline.** Claims are transactional and leased, persist before execution, refuse a second
  claimer, refuse to settle twice, and refuse to settle for a non-owner (`finishVerificationAttempt`).
  The live-claim path is untouched by recovery.
- **Refusal over substitution.** Capture leaves zero rows on refusal (asserted); admission refuses drift
  with `source_changed` and names a fresh capture as the remedy rather than re-capturing; a container
  request on a host daemon is blocked; a receiptless executed outcome is refused rather than stored.
- **Prompt masking.** The internal snapshot/receipt references are masked out of replayed transcripts
  (`events.ts`), so a replay cannot render withheld paths.
- **Restore revalidation.** Expired requests are dropped, requests whose evidence did not survive are
  `blocked`, open attempts become `uncertain`, and receipt-backed outcomes are invalidated to `unknown`
  with their attempts and requests — asserted by a restore test.
- **Redaction.** Retained output is redacted with a live secrets supplier read at command start, and a
  command containing credential material is refused before execution.

## Not defects, but limits already recorded

No live-model run (the end-to-end test uses a fixture worker and a stubbed runtime); container execution
implemented but unobserved; the requester's peer receipt access reuses BAZ-040's authorized path rather
than a per-request grant; the web section is typechecked and built, not browser-observed.
