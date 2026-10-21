# BAZ-059 — completed-image recovery integration (2026-10-04)

## Disposition

**Integrated, tested offline and independently accepted with limits. No live attempt.**
The [standalone validator](BAZ-059-image-evidence-validator-20261004.md) now runs inside the existing
strict Codex image SSE parser. Explicit-empty and omitted terminal output use the same validated
completed-snapshot path; the old weaker omitted-output fallback is removed.

**244 focused tests, 2,532 full passes / 47 skips, 336 security cases, root/web types passed.**
The real daemon/worker/Pi/CLI fixture captures synthetic recovered images and persists the selected
source fact in canonical session tool details. Private capture, policy-mediated delivery, byte
validation, reopen and no replay are exercised. No live entitlement, human image quality, recovery
of historical bytes, packed-release validation or release authorization is claimed.

The previous actual `terminal_output_empty` observation did not retain its earlier image snapshots.
This implementation does not prove that response would satisfy the new prerequisites. No image
was recovered from the operator's previous uncertain attempts and none were replayed.

## Changes and preserved boundaries

### One strict evidence path

`apps/daemon/src/lib/image-transport.ts` creates `CompletedImageEvidence`, feeds parsed events only
after existing framing/type/terminal checks, and resolves only after the entire bounded stream.
The validator remains image-specific; no search accumulator or broad upstream fallback imported.

- Missing/blank MIME still follows the explicitly streamed request, never sniffing/fallback.
- Keep fixed endpoint/body/models/credentials, 40 MiB raw response cap, 512 SSE frames, 180-second
  request deadline, maximum four images, no redirects/download URLs/retries or billing-route switch.
- Existing UTF-8/framing/DONE/duplicate-terminal/late-failure checks retain precedence. Closed
  `evidence_*` refusal families cover the collector, without upstream text/IDs/image data.
- Explicit empty array and omitted output both require bound lifecycle identity, explicit completed
  terminal status, contiguous completed slots, actual final image bytes, and no error/refusal or
  identity/model contradiction. Null/malformed output refuses. No progress/partial-image assembly.
- Nonempty terminal output stays authoritative with no union. Existing precise projection refusals
  run before cross-stream reconciliation; previously done snapshots must agree with final ones.
- Terminal-only images may still omit per-item ID/status; supplied contradictory metadata refuses.
  Streamed done items now require indices, IDs and explicit image completion; no legacy bypass.
  Conservative nonimage/annotation/unknown-event restrictions remain as documented in the standalone
  contract. Extra completed-snapshot metadata differences also refuse by deep equality.
- API-key/OpenRouter transport contracts remain unchanged. This is not an endpoint/model/schema change.

### Honest evidence-source propagation

Fresh validated Codex `GeneratedImages` carries `outputSource: terminal|completed_stream`. The host
returns it only for the Codex route and only for those two closed values. `ImageGenerationOutput`
adds an optional source field over private IPC; the worker already returns the full IPC result.
`image_generate` maps the fact to `imageEvidence` and the Pi adapter preserves it in canonical
`toolResult.details` beside opaque Results references, never alongside inline generated-image bytes.

**Receipt replay omits the source fact.** The DB receipt stores no such fact, so a replay cannot
claim it observed a new provider response or guess terminal versus streamed evidence. It still
returns the same captured files without a new request. A fresh turn's canonical Pi result retains
its actual fact; no migration, extra transcript, durable event store or fabricated model attestation.
Existing history/UI image Results behavior is unchanged; no new badge or frontend evidence claim.

### Capture, privacy and lifecycle

The shared host still checks canonical base64, size and PNG signature before atomic private Results
capture plus completed-operation settlement. The image request asks for PNG; signature validation
is not full PNG decoding, exact dimensions or visual-quality validation. Failed/uncertain work
leaves no new captured Results and cannot dispatch again. Bytes go through the unchanged file
source-owned authorizer; tool details contain references and source metadata only.

## Offline evidence

**Focused:** 244 passes / eight files, including the 65 evidence-validator tests and all existing
codec/transport/source/provenance/CLI/crash coverage.

New composed host fixtures prove:

- Actual missing-MIME synthetic SSE with completed image snapshot and explicit-empty terminal
  passes strict evidence and host byte validation, captures expected PNG bytes and provenance.
- Allow releases through the real HTTP file authorizer; deny and approval_required leave captured
  bytes private with no tool-result preview bypass. Each fixture sends exactly one request.
- Backup/open of the fixture DB preserves identical bytes and release state.
- Duplicate IPC receipt replay returns identical files, omits outputSource and never sends again.
- Omitted-output recovery uses the same strict path through successful capture.
- Invalid base64, non-PNG bytes, a decoded image over 25 MiB, and a post-terminal error cannot
  capture or retry (including a new tool ID in the same turn); operation stays uncertain.

The **existing real one-shot Agent/daemon/worker/Pi/CLI test** now uses two Codex fixture turns:
one explicit-empty and one omitted terminal, both missing MIME and backed by actual done-image
snapshots/lifecycle IDs. Other four fixture turns retain API-key/OpenRouter coverage. It verifies
six real persisted Pi tool results, exactly two `completed_stream` facts, no inline PNG payload or
credentials, delivered image files, Results and restart behavior. This is synthetic upstream
transport with a real local application path, not a live model or subscription entitlement test.

**Full:** 2,532 passes / 47 skips; 275 files passed / seven skipped.
**Security:** 336 required cases, including seven new recovery/privacy/oversize/late-error/
real-worker/poisoned-collector requirements. No prior requirement removed.
**Types:** root and web passed. Scoped Biome completed with two inherited non-null-assertion warnings
and two style infos, no errors. `git diff --check` passed. No whole-tree lint or package claim.

Initial focused integration run retained 14 failures from old fixtures lacking newly mandatory
stream indices/lifecycle, legacy refusal-code expectations and replay equality assuming a fresh
source fact. Fixtures were updated explicitly, not the validator weakened. One new failure fixture
expected every host error to include the no-retry phrase; the existing non-PNG error is a safe
local type message instead. The assertion was corrected; subsequent explicit replay/new-ID checks
prove no dispatch, rather than treating error wording as enforcement. Initial logs retained.

## Independent review

An isolated read-only reviewer inspected the integrated parser/validator, host, wire types, tool/
Pi mapping and tests. **Accepted with limits, no blocking finding.** It did not run tests, access
operator credentials/home, execute the application or qualify upstream behavior. Reviewer model
inference was remote. No live generation or research/provider request occurred in this step.

Review: `/tmp/baz059-image-integration-NdbLkM/review/review.md`, SHA-256
`a5dd29ffab89ae3e9957e888c5bfb78e91a07f8b7cb197de8c9b34ed7f61de13`.
Candidate: `/tmp/baz059-image-integration-NdbLkM/candidate.sha256`, SHA-256
`b5754cf9f5bc412df63398a21e901663f0d43fd1066bc864a4ca79a92cdc9ed4`.
Logs and review bundle retained there; reviewed production bytes matched validation candidate.

## Operator posture and next gate

The owned idle daemon was stopped gracefully only for full/security fixture port ownership, then
restored on the same home/environment. Local-only postcheck: **PID 716696**, images off, scheduler
off, browser disabled, no trial preload, no worker children, ChatGPT still connected. No operator
home reset, OAuth import/copy, new operator Agent turn, uncertain-operation replay or publication.

Next is a **separately authorized, one-dispatch ChatGPT-only live trial**, if the operator chooses,
with exact prompt/model/account/time bounds and independent durable guard as before. No such
attempt is authorized or performed by this integration work. Unknown prior image bytes stay
unknown; insufficient future evidence must refuse rather than trigger automatic retry or relaxing
predicates until an image appears. All advertised live routes, human image acceptance and the
remaining original 0.23.0 release gates remain open.
