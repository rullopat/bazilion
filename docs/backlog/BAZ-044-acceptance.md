# BAZ-044 — acceptance record

Specialist verification of a captured code change. Story:
[in_progress/BAZ-044-specialist-verification-handoff.md](in_progress/BAZ-044-specialist-verification-handoff.md) ·
progress and slice plan: [BAZ-044-progress.md](BAZ-044-progress.md).

Status at this record: **implemented and covered, kept in `in_progress` until it ships** — like
BAZ-041, every story in `done/` carries `shipped:` and `release:`, and this one is unreleased.

## How this was verified

| Source | What it establishes |
| --- | --- |
| 41 new tests across nine files | Bounds, single ownership, refusal-not-substitution, capability closure, receipt rules, restore and dispatch settlement |
| Adversarial release gate | 26 new cases (`83 → 109`), all passing: `pnpm security:acceptance` |
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

**Not observed:** a full coder→tester→receipts run against a real model, and a Docker-posture check
actually executing. The Docker path is exercised only through the frozen-environment refusal
(a container request on a host daemon is blocked), so container execution itself is **implemented but
unobserved**.

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

**Covered.** One composition function builds the report for all three surfaces, so they cannot disagree:
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

1. **No end-to-end real-model verification run.** The pieces are covered individually and the fake-provider
   harness from BAZ-041 exists, but I did not run a live coder→tester turn through it. This is the
   largest gap: criterion 1's "returned receipts identify exactly…" is proven at the executor and store
   level, not as one continuous observed run.
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

`pnpm security:acceptance` → **109 required adversarial cases**, all passing, including 26 added here.
Schema change: the alpha contract gains four tables, so this release is clean-install-only.
