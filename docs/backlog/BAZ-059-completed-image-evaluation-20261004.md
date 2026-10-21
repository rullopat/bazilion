# BAZ-059 — offline completed-image recovery evaluation (2026-10-04)

## Decision

**A narrow image-specific completed-snapshot recovery contract is justified for implementation
and review, but a permissive `output.length === 0 ? done : output` patch is not.** No production
code/acceptance behavior changed in this evaluation. No live request, credential access, daemon
restart, account/config change or trial replay occurred. The current operator images-off posture
remains intact. This evaluation is not image entitlement, successful recovery or human acceptance.

The [authorized attempt](BAZ-059-evidence-refusal-and-trial-20261004.md) establishes only an explicitly
empty final `response.completed.output`. It did **not** retain the earlier image item inventory,
identities, completion states or bytes. Whether that particular response was recoverable remains
unknown. No retrospective image can be produced from the retained facts.

## Sources and executable comparison

Read the already-downloaded image-specific OpenClaw source pinned by URL to
`e1b8056605a912d45ef3329b3a70a3de81c973ed`:

- `extensions/openai/image-generation-codex-response.ts`, SHA-256
  `fd044256853474c8b0c902f6ce366b3e02c4eb9f4d2e0e6ed6f057d4b489d395` (verified before evaluation).
- Provider request source remains separately pinned by the preceding codec investigation.
- Local OpenAI **7.19.0** `resources/responses/responses.d.ts`: image progress/completed events carry
  `item_id`/`output_index`/sequence number, **not final image bytes**; partial-image events carry
  `partial_image_b64` explicitly labelled partial. `ResponseOutputItem.ImageGenerationCall` carries
  `id`, `status`, `result: string | null` and optional output format/size. Public API type declarations
  are useful structural reference, **not a guarantee the subscription backend implements them**.
- Current Bazilion `image-transport.ts` and host `decodeImages()`; search accumulator read only to
  compare ownership principles, not imported or executed as an image implementation.

Executed **24 synthetic comparisons** against:

1. Bazilion's actual `generateOpenAIImages` transport, with an injected fixture-only fetch.
2. The pinned upstream parser/collector function, TypeScript-transpiled without changing its body.
   Its three runtime helper imports were replaced with explicit local test doubles for base64
   canonicalization, text sanitation and truncation; schema uses installed Zod **4.4.3**.

**Limits:** this is the actual collector control flow, not a fully installed OpenClaw integration.
Helper doubles do not qualify upstream base64/sanitization behavior. Tests use synthetic canonical
PNG strings except the expressly conflicting-byte fixture. Bazilion transport acceptance does
not mean host image validation/Results capture succeeded. Global fetch was replaced with a
throwing stub; all adapter invocations used local Response objects. No provider/account calls,
operator auth/home reads, external research or upstream raw body replay.

Artifacts: `/tmp/baz059-image-evaluation-jp7wIR/{evaluate.mts,helpers.mjs,upstream-collector.mjs,
results.json,evaluation.log}`. **24/24 expected outcomes passed, zero network calls.** The script
asserts one injected fixture fetch per Bazilion invocation; no retry. No whole-suite rerun was
needed for this documentation/evaluation-only change; previous source validation remains separate.

### Key observed differences

| Synthetic case | Current Bazilion transport | Upstream collector with helper doubles |
| --- | --- | --- |
| Complete image snapshot + populated final | Accept 1 | Accept 1 |
| Complete image snapshot + empty final | `terminal_output_empty` | Accept 1 |
| Empty final, no image | Refuse | Refuse |
| Image progress-completed event only / partial-image event only | Refuse | Refuse |
| Complete image snapshot + omitted output | Accept 1 | Accept 1 |
| Null output + prior image | Refuse | Accept 1 |
| Terminal refusal-only output + prior image | Refuse | Accept 1 |
| Terminal error / incomplete details / failed status + empty output | Refuse | Accept 1 |
| Error event after populated terminal | Refuse | Accept 1 |
| Duplicate terminal | Refuse | Accept 1 |
| Duplicate completed image identity | Refuse | Accept 2 |
| Five completed image items | Refuse | Accept first 4 |
| `response.done` without `response.completed` | Refuse | Refuse |
| Missing item status/ID on existing omitted-output fallback | Accept 1 | Accept 1 |
| Changed response identity on omitted-output fallback | Accept 1 | Accept 1 |
| Two different IDs at same output index on omitted fallback | Accept 2 | Accept 2 |
| Unfinished nonimage slot on omitted fallback | Accept 1 | Accept 1 |
| Streamed refusal message on omitted fallback | Accept 1 | Accept 1 |
| Same completed image ID, different final bytes | Accept terminal bytes | Accept terminal bytes |
| Unexpected terminal model with populated image | Accept 1 | Accept 1 |
| Malformed JSON frame before valid image evidence | Refuse | Accept 1 |

These are adversarial synthetic observations, not claims that the provider emitted those bodies.
The upstream collector selects terminal **image** entries if any, otherwise prior done images;
it does not require the terminal array itself to be empty. It breaks out at completion, slices
image counts, and its schema omits several identity/status fields. Those choices explain the
observed over-broad fallback. Copying the helper would discard Bazilion's stricter boundaries.

**Existing gap:** Bazilion's omitted-output path already accepts completed-item recovery without
response/index/full-output reconciliation and allows missing per-item completion metadata. Only
fixing explicit-empty handling would leave that parallel weaker path. The comparison also exposes
terminal/stream contradictions and supplied model drift as gaps, not newly introduced defects.
Do not describe these as guarantees already enforced by the current implementation.

## Proposed bounded contract — not implemented

### 1. Preserve request, credential and lifecycle boundaries

No request/body/model/header/account/endpoint changes, decoder fallback, retries, additional
provider discovery or worker capabilities. Codex-only; API-key/OpenRouter untouched. Keep 40 MiB
upstream, 512 SSE frames, 180 seconds, at most four images and existing 25 MiB/image private capture
and release semantics. Entire stream must pass before any image is returned/captured; failure or
uncertainty still consumes the operation and never automatically replays.

### 2. Completion and response identity are independent prerequisites

- Exactly one `response.completed`; no new `response.done` alias. Existing full-stream UTF-8/
  framing/DONE/late-failure checks remain. Error/incomplete/cancelled state always overrides bytes.
- **Recovery requires explicit terminal `status: completed` and a bounded nonempty response ID.**
  Do not synthesize either from event names. For the new recovery path require an observed
  `response.created` or `response.in_progress` envelope binding the same response ID. Check every
  observed response/response_id reference; identity changes refuse, never reset accumulation.
- Supplied terminal/lifecycle model must match the pinned **orchestrator** `gpt-6-astra` (not the
  requested image model). If image-call metadata supplies a model, check it against `gpt-image-2`.
  Absence remains absence and never independent model attestation. Define the exact admitted field
  locations; do not scan arbitrary strings/unknown metadata for model names.
- Any sequence metadata that is supplied must be a nonnegative safe integer and strictly increase;
  no sorting/reordering to repair a stream. Missing sequence metadata must not stand in for missing
  response/item identity or completion. Explicitly test presence/absence policy in implementation.

### 3. Track a complete bounded output, not just image events

- A small bounded slot map (proposed **128 total output slots**, at most four image slots) binds
  `output_index ↔ item.id ↔ item.type`. Index must be a nonnegative safe integer within the cap;
  IDs nonempty bounded protocol identifiers; duplicate/reused identities or changed type/index
  refuse. True-string-end validation must reject controls/trailing newline.
- Track all admitted image/message/reasoning slots, not just images. Optional `added` events can
  open a slot; actual `output_item.done` may supply a complete snapshot without a prior added event.
  Once done, duplicate/reopened/changed snapshots or later progress/content for that slot refuse.
- Every referenced slot must have one completed snapshot and indices must be contiguous before
  recovery. Unknown item-bearing event types/capabilities, unclosed slots and holes refuse.
- Image progress and `response.image_generation_call.completed` can bind identity, but provide
  **no image evidence**. `partial_image_b64` never becomes a final image, even if it is valid PNG.
  Do not assemble deltas, substitute URLs, infer bytes from prose or synthesize missing items.
- Image snapshot must explicitly say `status: completed` with a nonempty `result`. A failed or
  incomplete item refuses even if another usable image exists. For other admitted item types,
  define completion/content rules separately; reasoning lacks the same required status contract
  as image/message items and must not be given invented completion fields.
- Any explicit refusal event/content blocks recovery, including a refusal in a completed message.
  Do not drop it while filtering for images. Non-refusal assistant text is not image evidence and
  must still have a complete, identity-consistent message snapshot. Unknown content kinds refuse
  rather than disappearing from the completed view.

### 4. Terminal precedence with two narrowly admitted recovery cases

- **Nonempty final output stays authoritative**; no union with earlier items, no filling missing
  image slots, and no fallback merely because final output contains no image. Reconcile observed
  completed identities/type/status/bytes with terminal counterparts. Contradictions refuse rather
  than terminal overwriting previously completed facts. Legitimate added→done evolution is distinct
  from two contradictory completed snapshots and needs explicit fixtures.
- Only **explicit empty array** or **omitted output** may select the complete stream snapshots,
  using the **same strict recovery validator**. This intentionally tightens the existing omitted
  path; do not retain a compatibility bypass. Null/malformed output refuses.
- Require at least one actual complete image, all slots closed, no errors/refusals/unknown capability
  evidence, no identity or supplied model mismatch. No silent partial selection or truncation.
- Terminal-only populated output with optional metadata is a separate existing contract: do not
  silently turn it into recovery or synthesize stronger provenance. Supplied contradictory evidence
  must still refuse. Explicitly document any tightening of this path during implementation/review.

### 5. Validate bytes and preserve provenance before successful capture

Canonical base64, decoded size and requested PNG signature remain mandatory in the shared host
before atomic Results capture. No whitespace/base64 repair or format sniffing fallback should be
borrowed from upstream. Existing signature checks are not full PNG decoding or image-quality
verification; dimensions/visual content are not established by a PNG header or requested size.
A transport-level synthetic accept is not a successful persisted Result.

The selected source should be a closed fact (`terminal` versus `completed_stream`) retained in the
canonical tool result when implemented. Terminal usage/response metadata stays terminal-owned;
no token/image-cost fabrication from progress or reconstructed items. Precise carrier/API changes
need implementation design/review; do not add a second transcript or general event store. A bounded
structural diagnostic could report slot/image completion counts and validation outcome, but never
raw bytes/IDs/refusal text. Counts need saturation and privacy tests, not unrestricted dumps.

## Independent design review

An isolated read-only reviewer **accepted the direction for implementation design, with gates**.
It did not accept a production implementation (none exists), execute tests, inspect credentials/
home or infer live recoverability. Reviewer model inference was remote. Review artifact:
`/tmp/baz059-image-evaluation-jp7wIR/review/review.md`.

Before implementing, turn the proposed constraints into exact executable predicates and fixtures:
terminal property presence/precedence; admitted lifecycle/identity/sequence fields and index bounds;
message/reasoning/refusal snapshot completeness; populated-terminal reconciliation (including
added→done evolution versus conflicting completed snapshots); and shared-host byte capture/reload/
privacy proof. These are explicit remaining design gates, not waived by the 24-case comparison.
In particular, the nonimage event/content allowlist and exact sequence-presence policy remain to
be specified. This checkpoint approves investigation direction, not code or any further live call.

## Implementation and qualification gates

Recommended next step: implement a daemon-local **image-specific evidence collector**, not a copy
of search's action schema and not the upstream broad fallback. First add fixtures for the proposed
contract, including failures above, optional opening events, lifecycle/sequence/model/index changes,
refusal deltas, unfinished nonimage slots, malformed/oversize bytes and terminal contradictions.

Then prove end-to-end host behavior offline: one dispatch, successful canonical PNG capture and
reload, correct provenance/closed source fact, private-until-authorized delivery, safe retained
failure and no retry; failure must leave no Results. Keep existing API-key/OpenRouter regressions.
Run focused/full/security/types and an independent source review before considering a new trial.

**No live authorization remains.** Any later live attempt must be separately authorized with the
same bounded credential/account/budget constraints; passing this contract's tests cannot establish
that the backend supplied the required image snapshots in the past or will do so in the future.
If evidence is still insufficient, report the closed blocker and stop, not relax predicates until
an image appears. All image-route/human qualification and release work remains open.
