# BAZ-059 — exact evidence refusal and authorized attempt (2026-10-04)

## Disposition

**The fresh attempt pinpointed `terminal_output_empty`: `response.completed` supplied an explicitly
empty final `output` array.** The adapter refused instead of substituting earlier stream items.
One dispatched subscription image request, HTTP 200/missing MIME, no saved image/Result, operation
uncertain. Clean blocker completion, no retry/fallback. Images restored off, Agent archived, no
worker children, connected ChatGPT account and operator home preserved. Authorization exhausted.

This diagnoses **this attempt only**. The [previous attempt](BAZ-059-image-codec-and-trial-20261003.md)
retained only evidence/missing/completed; its exact predicate cannot be reconstructed. Neither
attempt retained upstream bodies. No evidence here establishes whether earlier completed image
items contained usable image bytes, or what image the backend generated. BAZ-059 remains in progress.

## Authorization and offline work

The operator requested: **“pinpoint the failed evidence, then try another live attempt (already
authorized)”**. The assistant explained before dispatch that the previous missing body made
retrospective pinpointing impossible, and treated this as one fresh guarded attempt under the
same exact ChatGPT-only scope. No rework, retry, paid route, other model/account/endpoint, browser,
MCP, shell, research or publication authorized. Whole-attempt limit eight minutes; image 180 seconds.

Offline review identified all existing predicates that could produce the preceding generic
phase/evidence diagnostic. Synthetic fixtures showed why `terminal=completed` alone cannot identify
the cause: terminal failure metadata, empty output, missing bytes and post-terminal events can all
report that state. **No speculative compatibility repair or acceptance relaxation was made.**

### Diagnostic-only implementation

`apps/daemon/src/lib/image-transport.ts` now distinguishes each local predicate through a private
`ImageEvidenceRefusal` and a fixed `ImageRefusalCode` tuple. Exported `ImageProtocolFailure` preserves
the existing phase/media/terminal bracket and appends `[reason=<closed code>]`. Examples:

- `terminal_error`, `terminal_incomplete`, `terminal_status`;
- `terminal_output_empty`, `malformed_output`, `no_image_items`, `too_many_image_items`;
- `invalid_image_identity`, `duplicate_image_identity`, `image_status`, `missing_image_bytes`;
- duplicate completion, done alias/item/failure/other event after completion, event after DONE;
- bounded framing/decoding and malformed-envelope refusals.

Reason provenance is **locally authored predicates**, not matching upstream message text. Unknown
exceptions remain `decode_failed` or `internal_failure`; no error body/message/stack, arbitrary event
type, ID, prompt, credential or image data enters the diagnostic. The exported constructor validates
**all four fields at runtime**, not just TypeScript unions; foreign values use fixed fallbacks and
are not coerced through `toString`. The unchanged host already forwards this typed closed error,
records uncertainty and prevents replay. Tests verify host forwarding and no secret echo.

Endpoint/body/credentials/models, 40 MiB response cap, 180-second deadline, no retries/redirects,
full-stream checks and image acceptance are unchanged. Explicit empty final output still refuses;
no `response.done` acceptance, partial-image accumulation or empty-output fallback added. Existing
optional terminal/item status/ID behavior remains inherited, not newly attested. API-key/OpenRouter
paths are unchanged. No schema, worker capability, disclosure or Results-persistence changes.

### Review and tests

- Independent isolated read-only static review accepted the diagnostic-only predicate split, with
  a note that the exported constructor should enforce its closed fields at runtime.
- That note was addressed for phase/media/terminal/reason, with hostile JavaScript constructor
  tests; final independent static review **accepted**, no blockers. It did not run tests or infer
  live success. Source/before/test bundles only; no credentials/home/runtime/network research.
  Reviewer model inference itself was remote.
- **171 focused tests / seven files passed**.
- **2,459 full passes / 47 skips**, 274 files passed / seven skipped, final serial run.
- **329 required security cases passed**, root/web typechecks passed; scoped Biome passed with
  two style infos, `git diff --check` passed. No whole-tree lint or packed-release qualification claim.
- Before constructor hardening, full/security/types passed. After hardening, the concurrent full
  run retained **one failure / 2,458 passes / 47 skips** in publication-e2e's “every refusal happens
  before anything is sent…” fixture: `ReviewUnavailableError ... source_changed` during snapshot
  capture. Six targeted publication tests subsequently passed, as did the entire serial suite.
  No publication code/test was changed. Failure cause beyond the reported snapshot refusal is not
  established; the original failure log remains, not relabelled as a pass.
- First added diagnostic fixture accidentally used literal backslash-n instead of SSE newlines;
  test failed as expected on decode, fixture corrected before final checks. No production workaround.
- Owned idle daemon was stopped gracefully only for full/security fixtures and restored on the same
  home/environment. No reset, credential copying or ambient provider use in these tests.

Artifacts: `/tmp/baz059-evidence-code-fogSLi/` — before snapshots, focused/full/security/types logs,
initial-validation logs, publication recheck, serial full run, independent reviews and candidate.

Final review SHA-256: `91da22dd51c918f1558581216e0f16df4888090d6a12478be815d85d395c5c1b`.
Candidate manifest SHA-256: `1e9bf245d85e50a8ae8385b6a5f6c284d01b4e6a29e77ea4acec68625b58d1b9`.
Reviewed production bytes matched dispatch source; manifest checked before attempt/after cleanup.

## One authorized live attempt

- **2026-10-04 07:33:07.392–07:33:48.769 UTC**, **41.377 seconds**.
- Dedicated Team/Profile **`baz059-evidence-trial-20261004`**, Agent
  **`e7bf16c8-e378-4f19-bca9-9bf2d60b4b36`**, now archived. No attached skills/bootstrap.
- Parent **`openai-codex:gpt-6.1-sol` / medium**; requested image **`openai-codex:gpt-image-2`**
  through pinned **`gpt-6-astra`**, one 1024×1024 PNG. Exact unchanged brief:
  “A friendly small robot watering three potted plants on a sunny balcony; flat editorial
  illustration, soft green and cream palette, no text, logos or people.” Optional name robot-balcony.
- Tested durable exclusive pre-dispatch guard: exact request/destination; a consumed slot survives
  failures/concurrency/wrapper recreation. Other tools prompt-restricted with post-event watchdog,
  not hard tool removal. No response read/rewrite or alternate parser in the guard.
- One **image_dispatch 07:33:12.650 UTC**, response headers **07:33:13.359 UTC**, **HTTP 200 / missing
  media**. No second dispatch/blocked attempt/OAuth-refresh guard event. One canonical composite
  tool ID, one `image_generate`; no other tool.
- Closed diagnostic **`phase=evidence; media=missing; terminal=completed; reason=terminal_output_empty`**.
  Independently checked against the canonical Pi tool-result text without exporting the transcript.
- This predicate occurs after the bounded stream loop: terminal envelope is an object, the existing
  error/incomplete/status gates passed, final output is present and is an array of length zero.
  No earlier post-terminal/identity/framing refusal was encountered. Optional status remains
  optional, so this is not a claim that an explicit successful status was observed.
- Crucially: no recorded inventory of earlier done items or their bytes. The diagnosis does **not**
  prove a recoverable image existed, and no fabricated image or search accumulator was substituted.
- One operation **uncertain**, image usage null/unknown, **zero Results/files**. Clean one `done`/EOF,
  no cancellation/fatal/parent error, no retry/fallback. **5,686 bytes** of client NDJSON (not upstream
  body size). Clean blocker completion is not image success or zero subscription consumption.
- Parent **two responses / 11,823 tokens**: 6,106 input, 85 output, 5,632 cache read, zero cache write.
  Catalog estimate **$0.0136252**, not a bill or combined image cost. Image usage/cost stays unknown.

## Cleanup and next work

Guard disarmed, Agent archived, trial daemon retired only after no workers remained. Original
same-home daemon environment restored; images/scheduler/browser off, connected ChatGPT preserved.
Current owned daemon PID **823564**. No credentials printed/copied, home reset, publication or
account/model/endpoint substitution. Trial exclusive markers remain consumed; **do not replay**.

Trial artifacts: `/tmp/baz059-evidence-trial-lGQO8v/` — prepared/trial/settled safe records,
checked guard/harness, exclusive attempt/image markers, final pins, `canonical-diagnostic.json`.
There is no saved image for human inspection. Historical attempts retain their own narrower facts.

Next is **offline evaluation of a narrowly bounded completed-image evidence contract** for explicit
empty terminal output, compared with pinned image-specific upstream code and adversarial fixtures.
Any proposal must require actual complete image evidence, preserve terminal failure precedence,
full-stream/identity/model/bounds checks, and reject conflicting or missing bytes; no progress/delta/
prose guessing or blanket reuse of search semantics. The current diagnostic does not establish
those prerequisites. New repair needs independent review/revalidation; **another live call needs
fresh explicit bounded authorization**. All advertised live routes and human image inspection,
remaining original 0.23.0 stories and release gates remain open.
