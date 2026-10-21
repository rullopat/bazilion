# BAZ-059 — reviewed missing-MIME image codec repair and authorized attempt (2026-10-03)

## Disposition

**Missing-MIME Codex image decoding repaired and independently accepted.** One newly authorized
subscription attempt handled the missing MIME and recognized **`response.completed`**, but refused
at **evidence** validation. No saved image/Result; operation uncertain. Exactly one image request,
no retry/fallback, clean blocker completion. Authorization exhausted. Images restored off, Agent
archived/no worker, operator home and connected ChatGPT account preserved.

The closed diagnostic is **`phase=evidence; media=missing; terminal=completed`**. It does not
establish successful terminal metadata, presence of completed image bytes or which evidence
predicate failed. No response body/item inventory was retained; do not import BAZ-069's empty
terminal-search observation into this image attempt. BAZ-059 remains in progress/unqualified.

## Authorization and investigation

The operator requested “investigate and then do another attempt”. This was applied to **one fresh
attempt under the preceding ChatGPT-only brief, model/account, one-image/no-retry/eight-minute
scope**, contingent on a tested and independently reviewed narrow repair. No paid API/OpenRouter,
credential copying, browser/MCP/shell/research, publication or repeated attempts until success.

The [previous image attempt](BAZ-059-identity-repair-and-retry-20261003.md) retained HTTP 200 with
missing Content-Type but no body/phase. Offline inspection established that the current image
request already explicitly says **`stream: true` / `Accept: text/event-stream`**. The decoder
required MIME despite that contract. This is a decoder mismatch, not proof of prior SSE validity
or image entitlement. No speculative model/header/request changes were made.

Public OpenClaw source at pinned commit **`e1b8056605a912d45ef3329b3a70a3de81c973ed`** was fetched
without credentials or generation from raw GitHub for comparison:

- `extensions/openai/image-generation-provider.ts`, SHA-256
  `c3802bfd894672fe7bb13bb21fa27155e8c811509d3c806d607fe0035f0b9f51`.
- `extensions/openai/image-generation-codex-response.ts`, SHA-256
  `fd044256853474c8b0c902f6ce366b3e02c4eb9f4d2e0e6ed6f057d4b489d395`.

The consumer parses an SSE body without requiring MIME and recognizes `response.completed`.
Its broader empty-terminal recovery/permissive collecting/diagnostic behavior was **not copied**.
These are pinned-URL public-source comparisons, not installed OpenClaw tests or a Git-tree blob
verification. They neither establish the saved response contents nor grant credential/runtime
or capability substitutions.

## Narrow production repair

`apps/daemon/src/lib/image-transport.ts`:

- Missing/empty/whitespace Codex Content-Type follows the **explicit streamed request contract**,
  not body sniffing or retrying another codec after decode failure. Populated MIME must be bounded
  (256 chars) and exactly `text/event-stream` (case-insensitive; parameters allowed). JSON/HTML/text
  and misleading MIME prefixes refuse. The API-key JSON path is unchanged.
- Strict UTF-8 decoding and SSE framing: valid LF/CRLF/CR endings; terminated frames; closed field
  grammar; no prose/HTML hidden before data; label/data/type agreement; no duplicate labels;
  512-frame cap including comment frames; DONE only once after terminal; any substantive event
  after terminal/DONE refuses. Entire bounded stream is inspected before returning evidence.
- The existing **40 MiB** consumed response cap, fixed destinations, no retries/redirects, signal/
  deadline handling and final image projection remain. Only **`response.completed`** is recognized.
  No `response.done` alias, blank-terminal reconstruction, image delta assembly, model/status/ID
  synthesis or partial-output union was added. Existing omitted-terminal-output done-event recovery
  and optional terminal/item metadata behavior are inherited, not newly widened or independently
  attested. Terminal `incomplete_details` now refuses explicitly.
- `ImageProtocolFailure` contains only locally constructed **phase (`media|decode|evidence`),
  media (`missing|sse|other`) and terminal (`unseen|completed`)**. It discards original exception
  messages/stacks and includes no upstream body/header/ID/prompt/credential or image data.

`apps/daemon/src/lib/image-generation.ts` forwards that typed closed diagnostic; arbitrary errors
remain collapsed. Cancellation takes precedence; uncertain intent/no replay and private atomic
Results capture/release are unchanged. A parse refusal does not become fake successful storage.
No schema, request payload, account/model, credential supplier or worker capability change.

## Review, findings and regression evidence

Two independent read-only static reviews used isolated source/before/tests/public-comparison
bundles, no credentials/home/application execution/research tools. Review inference itself was
remote. Initial review found a valid **CR-only SSE line-ending regression**; it was fixed and
LF/CRLF/CR fixtures added, not waived. Final review **accepted with no blocking findings** and
retained the inherited optional-metadata limitations. The final reviewer noted it could not locate
the referenced initial review/prompt inside its restricted `input/` directory; it still reviewed
updated source/tests and pre-change transport. Initial report is retained separately, not erased.
Neither reviewer executed tests or independently established live behavior.

Final validation:

- **145 focused tests / seven files passed**.
- **2,433 full passes / 47 skips**, 274 files passed / seven skipped, bounded concurrency.
- **327 required security cases passed**, including three new codec/API-isolation/closed-diagnostic
  and host-uncertainty cases; no existing manifest requirement removed.
- Root/web typechecks, scoped Biome and `git diff --check` passed. One template-style info,
  not a new whole-tree lint claim.
- Initial full run before the line-ending fix: **2,430 passed / 47 skipped**. Its security run
  exited 1; the helper removed its transient JSON report, so the exact failed case is unavailable.
  Cause remains unknown. Initial logs retained; the subsequent final run passed, not a retroactive
  declaration that the initial gate passed or its cause was fixed.
- Owned idle operator daemon stopped gracefully only for full/security port-4321 fixtures, then
  restarted on the same home/environment; no resets, credential import or provider observation.

Review: `/tmp/baz059-image-codec-KVoVKB/review/review-final.md`, SHA-256
`d3b67f841ce02c02ae66a8cff68f85aa71a85d589640d918adf3ca720ea3c983`.
Candidate: `/tmp/baz059-image-codec-KVoVKB/candidate.sha256`, SHA-256
`610d932c850f48191851707b314e4cb41784b143cef5753c311a5bfa43b4836f`.
Reviewed production bytes and source pins matched before dispatch and after cleanup. This is
source-candidate validation, not a freshly qualified packed release or generic image entitlement.

## Authorized live attempt — 15:05 UTC

- **Window:** 2026-10-03 **15:05:10.604–15:06:02.826 UTC**, **52.222 seconds**.
- Dedicated selected-skills-empty, no-bootstrap Profile/Team `baz059-codec-trial-20261003`.
  Agent **`f8b83799-5a0c-427e-bd73-498390485910`**, now archived.
- Parent **`openai-codex:gpt-6.1-sol` / medium**; image requested **`openai-codex:gpt-image-2`**
  through unchanged **`gpt-6-astra`** orchestrator, exact robot/balcony prompt and `robot-balcony`
  optional filename. No other tool invoked; one composite canonical ID admitted.
- Checked test-only guard preserved exact endpoint/body admission and durable one-dispatch slot.
  No response modification. **One image_dispatch at 15:05:17.731 UTC**; response headers
  **15:05:18.631 UTC / HTTP 200 / missing media**. No refresh/blocked/second-dispatch event.
- Tool refused with closed **evidence/missing/completed** facts. A recognized completed terminal
  was reached, not proof that terminal metadata/output passed. Exact failure predicate unknown:
  possible late/contradictory events, terminal/error/incomplete state, missing/excessive/invalid
  image output etc. are not distinguished by these facts. No raw body/terminal output/image bytes
  retained and no automatic accumulator/alias enabled to try to make it pass.
- One operation **uncertain**, usage unknown/null; **zero Results/files**. One clean `done`/EOF,
  no fatal/parent error/cancellation, no retry/fallback. Stream **5,462 bytes**. This is clean
  blocker completion, not successful generation or proof of zero image consumption.
- Parent **two responses / 11,804 tokens** (6,089 input, 83 output, 5,632 cache read, zero cache
  write). Catalog estimate **$0.0135712**, not a bill or combined image cost. Dispatched generation
  may have consumed subscription usage; unknown image usage/cost remains unknown.

## Cleanup and next work

The guard's arm file was removed. The idle Agent was archived; no worker children remained before
trial daemon retirement. Original environment restored on the same home: images/scheduler/browser
off, ChatGPT connection preserved. Current owned daemon PID **180778**, control files updated.
No home reset, OAuth/profile copy, account/model fallback, public exposure or publication.

Artifacts: `/tmp/baz059-codec-trial-Sx3IFO/` — checked guard/harness, prepared/trial/settled safe
records, exclusive attempt and image-dispatch markers, final pins. Do not replay. Canonical Pi
session remains private in the operator home. No saved image exists for human inspection.

Next: **offline evidence-contract investigation and, if necessary, closed structural/refusal
reason diagnostics** before deciding on a further compatibility repair. Use public contracts and
actual bounded synthetic fixtures, never infer missing image evidence from search behavior or
progress/prose alone. Any new repair needs review/revalidation. **Fresh explicit bounded live
authorization is required for another attempt**; this authorization is exhausted. All four image
selections, human image quality and broader BAZ-059/Content Team/release qualification remain open.
