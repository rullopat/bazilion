# BAZ-059 — reviewed canonical tool-ID repair and one authorized retry (2026-10-03)

## Current disposition

**Canonical composite tool-ID defect repaired, independently accepted and regression-validated.**
The newly authorized subscription attempt crossed identity/admission and sent exactly one image
request, but produced **no saved image**. Upstream HTTP 200 had missing Content-Type; the unchanged
image transport refused and the image operation remains **uncertain**. This is not successful
image qualification or proof that an image was generated remotely. Subscription usage may have
occurred. No retry/fallback; the new authorization is exhausted.

Operator image generation is restored **off**, trial Agent archived, no worker children, existing
home and ChatGPT connection preserved. No account/model/request/parser changes or publication.

## Authorization

After the [first pre-dispatch refusal](BAZ-059-subscription-attempt-20261003.md), the operator
requested: “repair and review the identity validation offline, then do another live attempt
(I authorize now)”. This authorized the bounded identity repair/review and **one fresh attempt**
under the previous subscription-only scope, not repeated generations until success. The same
exact robot/balcony prompt, `openai-codex:gpt-image-2` selection, pinned `gpt-6-astra` image
orchestrator and `openai-codex:gpt-6.1-sol` / medium parent were retained.

## Narrow offline repair

- New `apps/daemon/src/core/tool-call-id.ts:isToolCallId()` admits a nonempty ASCII simple ID or
  exactly two nonempty ASCII segments separated by one pipe, **256 characters maximum in total**.
  A true end assertion refuses trailing newlines rather than JavaScript `$` accepting one.
- `apps/daemon/src/lib/turn-tool-source.ts` uses it **only for tool-call ID syntax**. Conversation
  binding, admission session head/offset, Agent-owned bounded canonical read, exact tool name/ID
  match and returned canonical arguments are unchanged.
- `apps/daemon/src/core/repos/results.ts` uses the same validator **only for tool-call provenance**.
  Team/Agent/session/review identities retain their prior grammar. Complete IDs remain unchanged
  in captured receipts, database uniqueness/replay keys and canonical matching. No split, stripping,
  normalization, synthetic ID or union-based matching.
- No schema, endpoint, selected model, image payload, transport parser, credential or disclosure
  changes. Existing producer membership, argument equality, immutable retry/tombstone and private
  Results release boundaries remain.

Tests cover simple/composite and 256/257-character boundaries; empty/multi-pipe/control/path/non-ASCII
IDs; actual composite canonical source → image host → captured Result; full-ID persistence and
idempotency; distinct simple/same-call-different-item identities; missing/other-turn/other-conversation
source and altered arguments; malformed canonical blocks refusing before admission; and unrelated
provenance identifiers remaining closed. Existing image/lifecycle/CLI/crash tests remain passing.

## Independent review and validation

The reviewer used an isolated read-only before/after/source/tests bundle, with research/network/
application execution disabled. Model inference itself is remote. No operator credentials or live
provider body were supplied. **Verdict: acceptance with limits; no blocking finding.** It checked
bounds, separator/end grammar, unchanged whole-ID matching and idempotency, canonical ownership,
argument equality, producer membership/private release and non-tool provenance boundaries.
Static review only; reviewer did not independently execute tests or establish live success.

- **112 focused tests / eight files passed**.
- **2,396 full passes / 47 skips**, 273 files passed / seven skipped; bounded concurrency.
- **324 required security cases passed**; no claim these new tests expanded that manifest.
- Root/web typechecks passed; scoped Biome completed without errors, `git diff --check` passed.
- Owned idle daemon gracefully stopped only during full/security tests for the known port-4321
  conflict, then restarted on the same home/environment. No credential import/reset or research.
- Live retry used exactly the reviewed production bytes. Source manifest:
  `/tmp/baz059-identity-repair-ActHdd/candidate.sha256`, SHA-256
  `22cfe94a9f9505ed82dab5bbc8afd48a08eb5a0f1033b8f4212643f42fc004df`.
- Review: `/tmp/baz059-identity-repair-ActHdd/review/review.md`, SHA-256
  `5fe8e0222e3a458775c225ffee8b309904fd6b6c4376b8ee3e0eb095621ca4db`.

This is source-candidate validation, not a new versioned/released package or independent live-image
acceptance. Existing package qualification predates this identity-only delta.

## Fresh live attempt

- **Window:** 2026-10-03 **14:20:24.596–14:21:13.762 UTC**, **49.166 seconds**.
- Dedicated Team/Profile `baz059-identity-retry-20261003`, selected skills empty, no bootstrap;
  Agent **`dbb1467b-ae9b-471f-aaa6-2dbfc8b1cc17`**, now archived.
- One actual canonical `image_generate` call with the exact approved brief. Its complete Pi
  composite ID passed source validation; one image-operation row was admitted.
- Tested test-only pre-dispatch guard retained exact request admission and an exclusive durable
  one-dispatch slot. It was rechecked offline before use; it did not modify upstream responses.
  One **image_dispatch** at **14:20:31.088 UTC**; response headers at **14:20:31.899 UTC**:
  **HTTP 200 / media category `missing`**. No second image dispatch or OAuth-refresh/blocked event
  was observed. These are headers-time facts, not full-generation duration or completion proof.
- Image tool refused; operation **`uncertain`**, usage **unknown/null**; zero Results or files.
  One clean `done`/EOF, no fatal/parent error/cancellation, no second tool or fallback. Stream
  **5,516 bytes**. Clean blocker completion is not successful image generation.
- Parent: **two responses / 11,814 tokens** (6,099 input, 83 output, 5,632 cache read, zero cache
  write). Pi catalog estimate **$0.0135912**, not a bill or combined image cost. The dispatched
  image request may have consumed account usage even though no output was captured.

## What is and is not known about the refusal

The current image transport requires `text/event-stream` Content-Type for Codex. The observed
missing header is a confirmed contract mismatch: it would refuse after a successful bounded body
read, even if the body otherwise contained valid events. Unlike BAZ-069 search, this image transport
has not gained missing-MIME decoding or `response.done`/completed-stream compatibility.

However, no image body, framing/terminal/item inventory or closed failure phase was retained.
`boundedImageFetch()` consumes/caps the body before that MIME check, and the host replaces unexpected
exceptions with a safe generic error. Therefore the precise failing stage cannot be independently
reconstructed from the retained headers alone; body/transport failure is not excluded. **Do not
assert that this body was SSE, that a terminal/image existed, or that missing MIME was the only live
failure.** Search responses are a different request, not evidence of this image response's contents.

## Cleanup and next boundary

Removed the guard's arm file, archived the idle trial Agent, verified no worker children, gracefully
retired the trial daemon and restored the original disabled environment on the same home. ChatGPT
still connected; images/scheduler/browser off. Current owned daemon PID **4041527**, recorded in
control PID files. Source pins checked unchanged. No credentials/profile imported, no private data
submitted, no publication/download from a provider URL, no image for human inspection.

Artifacts: `/tmp/baz059-identity-retry-hCq6Wa/` (`guard-tests.log`, prepared/summary/settled records,
exclusive attempt/image-dispatch markers, safe guard events and final pins). Do not replay scripts.
The private canonical session remains in the operator home. The first failure stays historical.

Next is **offline image codec/request-contract investigation**, with bounded secret-safe diagnostics
if needed, reviewed strict framing/terminal/image evidence semantics and regression tests. Do not
blindly transplant the search accumulator or loosen completion/model/identity/output requirements.
Any production repair requires review/revalidation; **another live attempt needs fresh explicit
bounded authorization**. All four advertised image selections and human image inspection remain
unqualified; BAZ-059 stays in progress, release/content-Team gates remain separate.
