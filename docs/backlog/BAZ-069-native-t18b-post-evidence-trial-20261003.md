# BAZ-069 — authorized T18(b) attempt after evidence-contract repairs (2026-10-03)

## Disposition

**T18(b) failed/unchecked.** One search refused; no search receipt or NASA source read.
The new closed diagnostics establish an attempt-specific mismatch: **one completed streamed
hosted-web item was observed, but the `response.completed` terminal contained zero output
items**. Stream/terminal reconciliation refused before terminal proof projection.

The operator's “retry T18(b)” authorized one fresh bounded source attempt under the existing
NASA-only subscription scope. **That authorization is exhausted.** No retry, fallback, second
turn, account/model/transport switch or further authenticated research observation occurred.

## Scope and preflight

- Existing ChatGPT subscription, **`openai-codex:gpt-6.1-sol` / medium**; requested cached native
  discovery, `allowedDomains: ["nasa.gov"]`, NASA Artemis II only and NASA-only source reads.
  Eight-minute ceiling, at most four searches / 32 tools; stop research on search refusal.
- No Brave/SearXNG/Firecrawl/browser/MCP/image generation, shell/coding/local/private data,
  memory/messaging, login/challenges, downloads, guessed-source bypass or publication.
- Checked reviewed production equality, candidate hash and complete source/dependency/test pins
  before preflight/dispatch and after settlement. Source daemon 127.0.0.1:4321 retained scheduler/
  browser/image disabled, native auto/cached, no MCP/alternate search/render backend, no active
  Agent/daemon child. Passive connected status is not an entitlement probe.
- Fresh ordinary Agent **`273e3651-21d4-4f26-9f2e-e384f665dc05`**, dedicated empty-skill Profile/
  Team `baz069-native-trial-20261003`, expected selection revision zero. Goal/restrictions only;
  no supplied query, NASA page or tool sequence. Same operator home/account preserved.
- Candidate: [evidence-contract investigation/repairs](BAZ-069-native-evidence-contract-investigation.md).
  Manifest `/tmp/baz069-evidence-contract-lIW01z/candidate.sha256`, SHA-256
  **`c4510d4b399b1114bfa04b1eed6a7527f8854f54879a2b06af41ce9ff33304bd`**.
  Final independent narrow review accepted; prior 135 focused / 2,347 full passes / 47 skips,
  307 security cases and root/web types apply. This source attempt is not packed/operator/release
  qualification and no production code changed for the attempt.
- Local harness's new diagnostic parser was checked synthetically: exact field allowlist,
  terminal enum and integer counts 0–129 (nullable output count), unknown keys/strings refused.
  It never retains arbitrary provider body/error text. Exclusive dispatch marker prevents replay.

## Observation

- UTC **11:33:55.968–11:34:21.571**, monotonic elapsed **25.603 seconds**.
- Exactly one Agent-chosen `web_search`: `NASA Artemis II mission crew launch splashdown date`,
  count 5, enforced NASA filter present.
- Closed refusal facts:

  ```text
  phase=evidence; code=refused; http=200; media=missing; body=sse_like
  reason=streamed output identity or type disagrees with terminal output
  terminal=completed
  outputItems=0
  terminalSearchItems=0
  terminalSearchActions=0
  terminalOtherWebActions=0
  streamedSearchItems=1
  searchProgressEvents=3
  ```

- Strict full-stream decoding completed; the terminal event was **`response.completed`**, not
  `response.done`. Its output was an **empty array**, not an absent/unknown output field.
  A streamed completed hosted-web item and three lifecycle events were observed; reconciliation
  requires observed output slots to agree with terminal output and correctly refused the empty
  terminal. No streamed content was substituted into it.
- `streamedSearchItems` counts all completed `web_search_call` actions, not solely `search`.
  Reaching reconciliation means the item passed streamed completed-status/known-action checks,
  but its action subtype, content and citations were not retained. Lifecycle-event count is not
  an execution count. These facts **do not establish a successful grounded search, source read,
  entitlement, or absence of provider-side execution/usage**.
- Reconciliation runs **before** terminal `projectNativeSearch`: the terminal payload's selected
  model/status/citations did not pass that projector in this attempt. The event name alone must
  not be treated as validated terminal status. No successful native usage/citation receipt exists;
  observed native cached-vs-live mode remains unknown.
- No raw native body/header, output item/action content, source URLs, response IDs, credentials,
  account identity or provider exception dump retained. Closed structural facts and fixed
  allowlisted refusal reason only. The canonical private Pi transcript remains authoritative.
- One clean parent `done`, clean EOF, no fatal/parent error/cancellation/incomplete frame;
  **10,222 stream bytes**. Agent reported the blocker, no fabricated source answer, retry,
  fallback or guessed URL. Honest blocker completion is not T18(b) success.
- Parent usage: **12,126 tokens** — 6,250 input, 116 output, 5,760 cache read, zero cache write.
  Catalog estimate **$0.014236**, not a bill. Both parent responses used the selected model.
- Prompt/watchdog envelope respected. This is a **post-event watchdog**, not a hard
  pre-dispatch tool quota.

## Cleanup and next boundary

At **11:35:02 UTC**, Agent idle, browser disabled/stopped/no profile, MCP zero. Normal archive
API succeeded; no direct daemon worker children remained. Operator daemon/home/account preserved;
passive status still connected, no refresh/probe issued by cleanup. Pins unchanged.

Control artifacts: `/tmp/baz069-t18b-evidence-trial-LIGYZC/` (`prepare.mjs`, `trial.mjs`,
`settle.mjs`, `preflight.json`, `prepared.json`, `trial-summary.json`, `settled.json`, exclusive
`attempt-issued`, pre/dispatch/post pin checks). Scripts must not be replayed.

This establishes **empty terminal output after a streamed hosted-web item for this attempt**;
it does not retrospectively establish earlier attempts' response bodies, and does not establish
that accepting/reconstructing an empty terminal is a supported or safe contract. Next work is
an offline contract assessment of this observed shape, with explicit proof/framing/privacy/
identity/limit requirements, review and regressions before any production acceptance change.
Do not bypass the execution gate or use progress markers/provider prose alone as search proof.

No further live observation is authorized. T18(b) still requires actual native search evidence →
guarded original NASA read → verified facts/effective URL → cited answer → clean same-attempt
`done`. Packed/operator acceptance, API-key qualification and release approval remain separate.
