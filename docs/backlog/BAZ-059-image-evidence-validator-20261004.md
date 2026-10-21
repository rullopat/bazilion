# BAZ-059 — staged image evidence validator (2026-10-04)

## Disposition

**Historical stage:** subsequently [integrated and reviewed](BAZ-059-image-recovery-integration-20261004.md).
The standalone-only limitations below describe this earlier checkpoint, not current wiring.

Implemented and independently reviewed a **standalone, not-yet-connected** image evidence validator:

- `apps/daemon/src/lib/image-evidence.ts` — `CompletedImageEvidence` and closed errors.
- `apps/daemon/test/lib/image-evidence.test.ts` — **65 synthetic contract tests**.

**No production transport imports this module.** It does not enable empty-output recovery, change
existing omitted-output handling, generate an image or prove the previous response was recoverable.
No live calls, credential/home access, daemon restart or configuration change during this step.
Existing application bytes/request/limits and operator disabled posture are unchanged.

This implements the exact-predicate stage of the
[offline evaluation](BAZ-059-completed-image-evaluation-20261004.md), before exposing a new
acceptance path. Production integration and shared-host capture/reload/privacy remain gates.

## Executable contract decisions

- Caller supplies decoded JSON events from the strict bounded SSE parser. The validator is not
  another transport or SSE decoder. At most **512 events**, **128 slots (indices 0–127)**, **four
  image slots**. Existing response byte/deadline limits must remain outside it.
- Recovery only for output absent/undefined or an explicit empty array. Null/non-array refuses.
  JSON has no explicit undefined property; undefined is treated as absence in synthetic inputs.
- Recovery requires an observed `response.created`/`response.in_progress` envelope, bounded
  response identity and explicit terminal `status: completed`. Every supplied response ID must
  agree, including top-level `response_id`. Opening envelopes admit queued/in-progress status
  and absent/empty output only; nonempty opening output cannot silently disappear.
- Supplied response model must be `gpt-6-astra`; supplied image item model must be `gpt-image-2`.
  Missing model is not an attestation. Terminal/lifecycle error/incomplete details refuse.
- Sequence fields are **optional per event**. When supplied, a value must be a nonnegative safe
  integer strictly greater than the last supplied sequence. Gaps/omissions are allowed, reverse/
  duplicate/string/unsafe values refuse; no sorting or identity synthesis.
- Item IDs are 1–256 ASCII `[A-Za-z0-9._:-]` characters, true end checked (no newline/controls).
  Item index, ID and type are bijectively bound. Added events optional; done may directly supply
  a snapshot. Duplicate/reopened completed slots, changed identity/type/index, inconsistent
  `item_id`, or later progress/content on a done slot refuse.
- Image progress and partial-image events bind references but supply **no output bytes**. No
  image/text delta assembly. Unknown events/capabilities refuse, including `response.done`.
  Progress/content allowlists are literal sets in the module, not prefix-admitted families.
- Added snapshots may contain only absent/empty content/summary and absent/null/empty result;
  this conservative rule prevents refusal/partial evidence from being lost in later snapshots.
- Done image requires explicit completed status and nonempty result; supplied output format must
  be PNG. Message requires completed status, assistant role and output_text-only content with
  string text and absent/empty annotations. Reasoning requires summary array of summary_text
  strings; optional content is reasoning_text strings, optional encrypted content is a string,
  optional status must be completed. **No invented reasoning completion status.**
- Refusal events/content/error evidence abort. Annotation events and nonempty/malformed annotations
  in content-part events refuse, as do unknown content kinds. There is no admitted citation
  capability in this image-only path. The annotation checks were tightened after review.
- Recovery requires every referenced slot to be contiguous and done, with at least one image.
  It cannot drop an unfinished message/reasoning slot while selecting an available image.
- Nonempty final output remains authoritative, never merged/filled from the stream. Referenced
  terminal items must bind the same index/identity/type. Previously done snapshots must agree
  by **deep structural equality**, including metadata; added snapshots may evolve to completion.
  Extra/different metadata on a terminal done counterpart therefore refuses conservatively.
  Terminal-only image ID/status may remain omitted as in the separate current contract; supplied
  identities/status/model still validate. No claim of backend identity from absent metadata.
- `observe()` errors poison the collector: catching a failure cannot subsequently resolve success.
  Done/terminal snapshots and resolved output are copied to prevent caller mutation changing
  completed evidence. `resolve()` returns internal closed `outputSource: terminal|completed_stream`.
  It does not persist it, expose it to a worker or claim host capture succeeded.
- Error text comes only from a runtime-closed local code set; provider text/IDs/image bytes are
  not interpolated. Strict JSON/SSE input and host byte validation remain caller obligations.

## Review and tests

Independent isolated read-only review accepted the core recovery path, but found that the
`response.output_text.annotation.added` event was admitted and ignored despite annotations being
excluded. Removed that event from the allowlist; content-part annotations now also refuse when
nonempty/malformed. Two regressions prove those facts cannot disappear into a clean final snapshot.
Final review **accepted with integration limits**, no remaining candidate blocker. Review was static;
no test execution, account/home access or external research. Reviewer model inference was remote.

**236 focused tests / eight files passed**, including 65 new validator cases and existing codec,
transport, host, provenance, CLI image and crash fixtures. **Root/web typechecks passed**. An initial
test-only array cast failed typecheck; corrected the fixture array type rather than bypassing TS.
Scoped Biome completed with two non-null-assertion warnings (bounded array accesses), no errors;
`git diff --check` passed. This is not a full-suite/security/packed-release qualification claim.

Existing host tests still exercise the **old production path**, not this candidate. In particular,
synthetic strings accepted as candidate image `result` are deliberate: canonical base64/PNG/size
validation must happen in the shared host, not be inferred from these tests.

Artifacts: `/tmp/baz059-evidence-validator-FDpzLu/` — focused/type/format logs, independent initial
and final reviews, isolated input bundle and source manifest.

- Candidate manifest SHA-256: `f00b75fab14dc2d0169697661b7b3c6e0527134a26374d78415ae35b3e8bb02e`.
- Final review SHA-256: `c5cd847c6ddfcceba290da21a4bfb3d4b847425d41f5bf09e502d9592f3d58b6`.

## Remaining integration gates

1. Connect the validator to the **existing full-stream parser**, preserving framing/byte/deadline/
   failure/DONE precedence and closed diagnostics. Both empty and omitted recovery must go through
   it; do not retain the old weaker omitted-output bypass. No request/model/credential changes.
2. Decide and test how the closed output-source fact reaches canonical Pi tool details without
   inventing provenance on idempotent receipt replay. No schema shortcut or second transcript.
3. Prove actual host canonical PNG validation, private atomic Results capture, authorized disclosure,
   byte-for-byte reload, and no capture/retry after any refusal. Test malformed/oversized bytes and
   uncertainty, cancellation and account-route isolation through that composed path.
4. Add integration security requirements and run focused/full/security/types plus independent
   review of **the integrated candidate**. This standalone acceptance does not authorize wiring
   without those tests or qualify production behavior.
5. Only then propose another separately authorized bounded live trial. **No live authorization
   remains**, no image has been recovered from past attempts, and all image-route/human/release
   qualification remains open.
