# BAZ-044 — acceptance record

Specialist verification of a captured code change. Story:
[done/BAZ-044-specialist-verification-handoff.md](done/BAZ-044-specialist-verification-handoff.md) ·
progress and slice plan: [BAZ-044-progress.md](BAZ-044-progress.md).

Status at this record: **implemented and covered, kept in `in_progress` until it ships** — like
BAZ-041, every story in `done/` carries `shipped:` and `release:`, and this one is unreleased.

## How this was verified

| Source | What it establishes |
| --- | --- |
| 43 new tests across ten files | Bounds, single ownership, refusal-not-substitution, capability closure, receipt rules, restore and dispatch settlement |
| Adversarial release gate | 33 new cases (`83 → 116`), all passing: `pnpm security:acceptance` |
| Defect review | [BAZ-044-review.md](BAZ-044-review.md) — 12 findings, all fixed with regression tests |
| Typecheck / format / lint | Clean (root and web) |
| Web typecheck and build | Clean; the route tree regenerates with the new section |
| Full suite | 1713 passed / 7 skipped (1720) before the last web and manifest edits; 109 gate cases after |

## Acceptance criteria

### 1. A coder can request checks from an existing same-Team tester against a captured dirty change; the returned receipts identify exactly the requested code, commands, environment, and outcomes

**Covered, and partly observed.** Capture validates the real inputs (snapshot in-window and complete,
specialist a live member of the same team, requester a member and never the specialist) and freezes
the admitted environment; a refusal writes zero rows. The executor runs the *captured* command with
the captured cwd, timeout and purpose — verified by asserting the executor saw exactly
`pnpm test failing` at `/workspace` for 5,000 ms — and writes a BAZ-041 receipt naming the agent, team,
attempt, purpose and the **snapshot it was verified against** (`sourceBefore`). An executed outcome
without a receipt is refused rather than stored, and a fabricated receipt reference fails the foreign
key.

**Observed end to end** (`apps/daemon/test/lib/verification-e2e.test.ts`): a real repository with a
real dirty change is captured, the request is dispatched through the real path — claim, workspace
reservation, drift revalidation, restricted worker, IPC, executor, receipt, settle — and the receipts
read back identifying the captured snapshot, the captured command, the frozen environment and the
observed exit code. A second run with a check that exits non-zero records `failed` with `exit 4` and
the request `completed`, which is the distinction the story requires.

**What that test deliberately replaces, stated precisely:** the worker is a fixture that performs only
what the capability allows (read the request, then run each declared check), and the model runtime is
stubbed — **no provider is contacted and no model decides anything**. So what is observed is the
daemon-side boundary; what is still not observed is a live agent choosing to request verification and
its summary being checked for the absence of a deployment recommendation.

**Not observed:** a Docker-posture check actually executing. The Docker branch is exercised only through
the frozen-environment refusal (a container request on a host daemon is blocked), so container
execution itself is **implemented but unobserved**.

### 2. Busy waiting, delayed approval, inbox wake, and restart preserve the typed request and sole dispatch owner

**Covered.** One owner per request: a claim is transactional and leased, refunded as `null` to a second
claimer; the daemon refuses the worker's request/attempt identity unless it matches the bound attempt;
a live claim is never adopted; a busy specialist defers while the request stays `pending` and unclaimed.
An interrupted claim becomes `uncertain` with its unreported checks `unknown` and is **not** replayable
— only an explicit rerun creates a second attempt that links to the one it supersedes. The request is
never a peer message (asserted: zero `messages` rows), so an inbox wake has nothing to consume, and the
invocation validator refuses a verification turn smuggled through the inbox path in **either**
direction.

**Partially observed:** the delayed-approval path is covered at the authorizer, approval-plan and grant
level (hold captured once, release not replayable, release committed inside the decision), not as a
live end-to-end held-then-approved run.

### 3. Concurrent Bazilion writes cannot change the shared workspace during verification; a mismatch before execution blocks it; source mutation during checks or later edits invalidates applicability

**Covered.** Admission reserves the workspace exclusively for the verification interval and refuses a
mismatch: `changed` → blocked (`source_changed`, naming a fresh capture as the remedy), unverifiable →
blocked (`source_unverifiable`), evidence gone → `snapshot_evidence_gone`. A claimed-but-unstarted
attempt is settled `failed` with its checks `blocked`, never `succeeded` and never left `running`.

**Docker and host both inherit the same coordination**, which is why the claim is taken only after the
workspace is reserved and released only after the attempt is settled.

**Not observed:** a genuine two-writer race (a real second Bazilion writer mutating the tree mid-check).
The refusal is verified against a real drift, and the coordination it relies on is BAZ-040's existing
lease, not a new one.

### 4. The tester cannot widen its commands or privileges; missing tools/services/approval stay explicit blockers; generated test output is supported without calling modified source verified

**Covered.** The capability is exactly two tools and the schemas are asserted closed: no `command`,
`cwd`, `timeoutMs`, `env` or `shell` key exists to pass, `additionalProperties: false`, and a widened
request is refused rather than trimmed. The worker input keys are exact, so there is no coding host,
container host, repository context, result host, resource lifecycle, messaging, USER.md, browser, MCP or
question host to reach — and the spawner now refuses those options outright for a restricted kind rather
than trusting the caller. A missing toolchain, an unavailable service or an unattended approval need
becomes `blocked` with a typed reason and no receipt; risky commands are blocked rather than
auto-approved. Split outcomes stay distinct: `succeeded` / `failed` / `skipped` / `blocked` /
`timed_out` / `cancelled` / `unknown`, with a check the specialist never ran settled as `skipped` so a
partial run never reads as a full one. Settling reports **evidence availability**, not a verdict: a
non-zero exit is a result, and only "nothing executed at all" fails the attempt.

### 5. Only authorized participants can access captured inputs and evidence; denied/held peer or user delivery remains inaccessible through new endpoints, result libraries, and Telegram references

**Covered.** Access is bounded by request identity: the specialist may read only the request it was
admitted for, and the daemon re-checks the worker's identity against its own binding before the host is
reached. Retained diagnostics follow BAZ-041's release rule — bytes stay private until something
source-owned releases them, and a command carrying protected credential material is refused outright.
Output is redacted with a **live** secrets supplier read at command start, so a credential learned
mid-run cannot survive in a diagnostic.

**Not observed:** the per-request access grants for *peer* reads of returned receipts. The requester's
access goes through the existing authorized-message/receipt path (BAZ-040's peer access), and this
story did not add a second one; the negative direction — that a denied or held delivery stays
inaccessible — is covered by the existing BAZ-041/042 disclosure tests rather than by new ones here.

### 6. API/CLI/web agree on request and evidence status after reconnect/restart, cancellation, expiry, and backup/restore; model summaries never replace executor facts or imply deployment acceptance

**Covered.** One composer builds the surfaces from the same facts — `readVerificationSummary` for list rows
and `readVerificationReport` (that summary plus applicability) for the detail — so they cannot disagree.
Applicability is deliberately **not** in the list: establishing it compares the live tree against the
capture, so computing it per row would walk the repository once per request, and a list never implies that
anything was checked. Surfaces:
`GET|POST /api/teams/:id/verifications`, `.../:requestId`, `.../:requestId/cancel`; `@bazilion/client`;
`bazilion team verify create|list|show|cancel`; and the Team **Verifications** section. Cancellation is
settled as `cancelled` (not left `running`), an unknown request is 404 and a finished one is a state
conflict, expiry reads as absence, and restore revalidates: expired requests are dropped, requests whose
snapshot did not survive are `blocked`, open attempts become `uncertain`, and receipt-backed outcomes are
invalidated to `unknown` along with their attempts and requests. The specialist's system prompt asks for
a recommendation-free summary, and the prompt mask keeps the internal snapshot reference out of the
replayed transcript.

**Not observed:** a live reconnect/restart/cancellation race against a running container, and a
real-model run whose summary is checked for the absence of a deployment recommendation. The web
section is typechecked and built, not browser-observed.

## Caveats, stated rather than implied

0. **Two honesty fixes from the review are worth reading as behavioural claims.** A check's declared output
   paths are *advisory*: they are validated and recorded, and the receipt and the specialist's brief both say
   they do not confine writes. And an executed check whose receipt was pruned reports
   `receiptUnavailable` rather than silence, so "the evidence is gone" is distinguishable from "no receipt
   was recorded".
0. **Two gaps from the v0.19.0 gap work, both closed.** A container check now runs with the posture its
   receipt claims (read-only team memory, recovery-registered container), declared output paths are
   *checked* rather than trusted (the attempt records writes outside the declaration, and the requester
   is told), and — the substantive one — an agent can now request verification at all, which is what
   makes the result delivery reachable. `scripts/verification-live-run.mjs` observes the whole loop
   (coder asks → capture → restricted specialist → daemon-executed check → receipt → result → coder
   woken) against a real daemon and repository.
1. **No live-model verification run.** The end-to-end path *is* now observed as one continuous run with
   a fixture worker and a stubbed model runtime (no provider contacted). What is still unobserved is a
   real agent deciding to request verification, and a model-authored summary being checked against the
   boundaries in its system prompt. The fake-provider harness from BAZ-041 exists for that, and it was
   not wired up here.
2. **Container execution is unobserved.** The Docker branch of the executor is implemented against the
   same preflighted path a coding turn uses, and its *refusal* is tested; its successful execution is not.
3. **Peer receipt access was not extended.** Criterion 5's positive direction for the requester reuses
   BAZ-040's existing authorized path rather than adding the per-request grant the story described.
4. **Two-writer race and restart races are covered by construction and unit tests, not by live races.**
5. **The suite is not claimed deterministic.** The pre-existing load-related flake was found and fixed
   during this work (a fixture whose edit was the same byte length, so git's stat cache reported the file
   clean); sequential full runs are clean, but 3×-concurrent runs still surface contention in the Docker
   and Chromium integration tests. Recorded in the progress doc.

## Release gate

`pnpm security:acceptance` → **111 required adversarial cases**, all passing, including 28 added here.
Schema change: the alpha contract gains four tables, so this release is clean-install-only.
