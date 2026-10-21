# BAZ-069 — ordered parser review and terminal assessment (2026-10-03)

## Subsequent implementation

[The strict Codex-only terminal alias](BAZ-069-native-terminal-alias-implementation.md) was
subsequently implemented at the operator's request, independently accepted and revalidated.
Both terminal names now pass only with unchanged completed evidence; status synthesis, early
return and API-key alias remain refused. The assessment below records the **pre-alias** source
behavior; its fixture-only substitutions have since been replaced by direct production-alias
regressions. No live research or T18(b) pass occurred.

The operator requested two steps **in sequence**: independent review of the missing-MIME repair,
then offline assessment of `response.done` compatibility. Both are complete. This is not a new
T18(b) attempt, protocol implementation or research authorization.

## Step 1 — independent missing-MIME review: accepted

A separate ephemeral Codex reviewer (`gpt-6.1-sol`, medium) reviewed exact copies of the affected
source/tests and the [repair report](BAZ-069-native-missing-mime-repair.md). It ran read-only,
approval never, user config/rules ignored, hosted search disabled, in an isolated input bundle.
Instructions prohibited home/credential/session inspection, network/tool-provider calls,
daemon APIs and modifications. Normal reviewer model inference was remote; **this was not
zero-network model inference**, but no live research/provider compatibility request was issued.
No credential was copied/imported into the bundle.

- **Disposition: accepted for the offline Step 1 delta; no actionable findings.**
- Reviewed: provider/request-bound missing-MIME selection, refusal of other populated Codex
  types, new field/label framing checks, strict evidence/privacy/limits/no-replay paths.
- Reviewer independently reports **15 adversarial parser inputs rejected / three valid framing
  variants accepted**, via self-contained JavaScript without importing application code or
  opening sockets. Repository suites were not independently run; our validation is separate.
- Two nonblocking coverage suggestions were implemented after review: explicit SSE field/label
  attacks on **both** routes, and cancellation only **after** the Codex missing-MIME reader is
  demonstrably stalled, with reader cancellation asserted. No production change followed review.
- The known `response.done` gap was explicitly excluded from Step 1 and assessed next, not
  ignored as a finding or claimed fixed by the review. Existing tolerance of unknown preterminal
  event objects was noted as unchanged; successful terminal evidence remains mandatory.
- Review artifacts: `/tmp/baz069-mime-review-THPLQs/` (`review.md`, prompt, input hashes,
  before/after source-pin checks, private execution log). Report SHA-256:
  **`c996539cf11ecbd1e4a0978015133654e14177a28e87ce80422a02e474a03a07`**.
- Reviewed `native-search.ts` SHA-256 still matches production:
  **`772e940ff044a0239514c395621bcb0ae6b4743727bc9919046262750f0ef5cd`**.
  Scope is this parser repair, not whole-tree approval, later aliases, live entitlement or packing.

## Step 2 — actual pinned transport assessment: compatibility gap confirmed

Inspected installed Pi **1.0.0** `openai-codex-responses.js` (`mapCodexEvents`,
`normalizeCodexStatus`) and `openai-responses-shared.js` (`finalizeResponse`, `mapStopReason`).
Read the SDK/custom-provider/model/provider docs and model-selection example; no ambient runtime,
resource discovery, login or catalog refresh was invoked.

New `apps/daemon/test/lib/native-search-terminal-assessment.test.ts` exercises the **actual
exported pinned Codex `stream()`**, `normalizeContext()` and bundled model metadata. Every
request uses a synthetic JWT/account, injected in-memory fetch, forced SSE, zero retries and a
five-second abort signal. No provider/DNS/socket is needed. It compares the same fixture with
Bazilion's native parser, including missing MIME and explicit SSE.

| Synthetic terminal | Pi 1.0 result | Native strict search result |
| --- | --- | --- |
| `response.completed`, fully completed search + citations | `stop` | Accepted |
| `response.done`, identical fully completed payload | `stop` | **Refused: no successful terminal** |
| `response.done`, absent/unknown/queued/in-progress status | `stop` | A fixture-only name alias to `completed` still refuses the unchanged payload |
| `response.done`, failed/cancelled/incomplete status | error (length for max-output truncation) | Name-only alias still refuses |
| `response.done`, completed but no search evidence | `stop` | Name-only alias still refuses missing execution evidence |
| Completed `response.done`, followed by a failed event | `stop` (Pi returns at first terminal) | Equivalent `completed` stream refuses the later failure |
| `response.incomplete` event with contradictory completed payload | `stop` | Refused as an incomplete event |

The fixture-only name substitution is test input, **not production normalization**. Pi's
chat terminal handling is not a native search-evidence verifier: it can normalize an unknown
status to undefined, map missing/queued/in-progress to `stop`, normalize `response.incomplete`
and stop reading on its first terminal. Do not copy that behavior wholesale or equate SDK
`stop` with validated search. There is no evidence that the prior live search body contained
`response.done`; its body was deliberately not retained. This is a confirmed **protocol
compatibility difference**, not a retrospective live-cause claim.

## Recommendation before another T18(b) attempt

**One small follow-up repair is advisable:** admit `response.done` as an alternate terminal
name for **Codex only**, while leaving the response object untouched and running the existing
complete bounded-stream and evidence checks. Require explicit `status: completed`, same model,
consistent response identity, completed hosted search and valid scoped citations. Never infer
success from the terminal name, fill in status, accept `response.incomplete`, return before
checking trailing events, or relax framing/privacy/byte/deadline checks.

A future implementation must test duplicate/mixed terminal names, identity changes, later
failure/data, error/incomplete/missing-status payloads, both MIME forms, API-key alias refusal,
secrets, budgets and the turn-bound host. It should receive a narrow independent follow-up
review and new pins before requesting another bounded attempt. **That alias repair is not
implemented in this assessment**, and the new assessment test deliberately records the current
refusal. Packed qualification remains outstanding; no further trial is authorized.

## Validation / preserved operator state

- Added **six** required cases: two review coverage gaps and four pinned terminal assessment
  cases. No production source/dependency change: **416 production/dependency pins** still match
  the reviewed missing-MIME candidate; only tests/acceptance manifest/docs changed.
- Focused native/format/transport/terminal/real-worker suites: **121 passed / five files**.
- Root/web typechecks passed. Scoped Biome passed with three preexisting template-style infos;
  `git diff --check` passed. No whole-tree lint claim.
- Full bounded-concurrency suite: **2,333 passed / 47 skipped**, **270 files passed / seven
  skipped**. Security acceptance: **293 required cases passed**, exit 0.
- Logs/current source+test manifest: `/tmp/baz069-terminal-assessment-J5vw2Z/`.
  `candidate.sha256` SHA-256:
  **`468c1868c784405364218bbd4af2c1560c5e742ebd8701d0a818812a33891303`**.
  Pinned installed transport sources are separately hashed in `terminal-source.sha256`.
- Owned idle daemon gracefully stopped for default-port test isolation, restarted with the
  same disabled scheduler/browser/image and native auto/cached posture. Operator home/account
  preserved; passive status reports connected, without a provider refresh/compatibility probe.
  No new Agent or research harness was dispatched. T18(b) remains unchecked.
