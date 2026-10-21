# BAZ-069 — authorized T18(b) retry with safe format hints (2026-10-03)

## Subsequent offline repair

[The missing-MIME Codex repair](BAZ-069-native-missing-mime-repair.md) subsequently implemented
strict SSE selection from the explicit streamed request contract for absent/blank Content-Type,
without body sniffing or decoder retry. New regressions/types/full/security passed; no new live
observation. This attempt remains a failure, not retroactively qualified by fixture success.
Review/packed disposition and fresh bounded authorization remain outstanding.

## Disposition

**T18(b) remains failed/unchecked.** The fresh attempt made one native search and stopped on
refusal. New closed diagnostics identify **upstream HTTP 200 / missing media / SSE-like prefix /
JSON decode failure**. The current MIME-led decoder chose JSON because the response did not
supply a usable admitted SSE Content-Type. This explains the immediate decoder mismatch on
this attempt; it does **not** establish complete valid SSE, successful hosted search, entitlement
or the cause of either earlier attempt.

The operator explicitly authorized this attempt after confirming the same bounded scope.
**That authorization is exhausted.** No automatic replay or additional diagnostic request ran.

## Scope, preflight and candidate

- Existing connected ChatGPT subscription, **`openai-codex:gpt-6.1-sol` / medium**, requested
  **cached** native search mode. No credential import/copy, account/model/route switch or
  operator home reset. Passive readiness is configuration evidence, not entitlement proof.
- NASA Artemis II only; discovery filter `allowedDomains: ["nasa.gov"]`, NASA-only source
  reading, eight-minute ceiling, at most four searches / 32 tools. No browser/MCP/Brave/
  SearXNG/Firecrawl/image generation, shell/coding/local files/private data/memory/messaging,
  challenge/login handling, downloads, guessed-source fallback, publication or failed-call retry.
- Verified owned source daemon on 127.0.0.1:4321, scheduler/browser/image generation disabled,
  auto native route with requested cached mode, only the selected provider enabled, no MCP
  server or alternate discovery/render credential. No active Agent before preparation.
- Fresh ordinary Agent **`849d46c3-d7c1-4acd-8ffa-5b8db5ceec62`**, dedicated empty-skill Profile/
  Team `baz069-native-trial-20261003`, expected selection revision zero. Goal/restrictions only;
  Agent chose the query. No preselected page, supplied query or scripted tool-call sequence.
- [Format/transport engineering candidate](BAZ-069-native-response-format-and-transport.md):
  manifest `/tmp/baz069-native-format-RdYIb7/candidate.sha256`, SHA-256
  **`f9415dddd9c52bd5ca17edfbc4ab676901efeda5eaf7e434b720ed30478ca855`**.
  Source pins verified unchanged before/after dispatch. Root/web types, 106 focused tests,
  2,318 full passes / 47 skips and 278 required security cases apply to this candidate.
- The operator authorized a **source engineering attempt** with independent review and packed
  qualification explicitly outstanding. No fresh independent/packed/UI/release acceptance is
  inferred. No request headers, transport or decoder contract were repaired for this retry.

## Observed result

- UTC wall-clock window **09:21:36.166–09:22:04.568**, monotonic elapsed **28.402 seconds**.
- Exactly one tool invocation, `web_search`, Agent-chosen query
  `NASA Artemis II mission crew launch splashdown dates`, count 6, NASA filter present.
- Closed fields extracted from the tool refusal, not raw upstream content:

  ```text
  phase=decode; code=invalid_json; http=200; media=missing; body=sse_like
  ```

- `http=200` is the native upstream response, not only the loopback chat response status.
  `media=missing` means the bounded media classifier found no usable media token (absent,
  empty or whitespace Content-Type); the raw header was not retained, so those cases are
  not distinguished. This label does not mean an unknown populated media type was accepted.
- `body=sse_like` is a **bounded leading-syntax hint**, not a parsed protocol declaration:
  at most 1,024 string characters after bounded complete body read, UTF-8 decoding, admission
  revalidation and raw-secret filtering. A standard SSE field/comment-prefix shape was found.
  No body prefix/excerpt, raw header, provider exception, credential or account identifier is
  retained in this report/control summary. No HTML/challenge/vendor identification was attempted.
- The current parser selects SSE only for normalized exact `text/event-stream`. With no usable
  MIME it selected JSON, yielding `invalid_json` rather than reaching search/terminal evidence
  checks. A valid hosted-search stream, an SSE error stream and malformed/truncated event data
  cannot be distinguished by this hint alone. Native execution/usage/cached-vs-live remain unknown.
- **No hosted-search receipt, citations, NASA source read, verified effective URL or source facts.**
  Both parent assistant responses used the selected subscription model. The final answer honestly
  reported the blocker and declined to provide a source-grounded summary. No fallback/retry/tool
  after refusal, guessed-source read or out-of-scope tool was observed.
- One clean `done`, clean NDJSON EOF, zero fatal/parent-error/cancellation/incomplete frame;
  **9,803 stream bytes**. Clean blocker completion is not a research pass.
- Parent usage: **12,080 total tokens** (11,965 input, 115 output, zero cache read/write).
  Pi catalog estimate **$0.02508**, not a bill or API-billing claim. No native receipt does not
  prove zero native provider-side usage.
- Prompt restrictions plus post-event watchdog enforced the observed envelope; the watchdog is
  **not a hard pre-dispatch tool quota**. No over-budget or unapproved tool occurred in this run.
  The exclusive `attempt-issued` marker prevents harness replay.

## Cleanup and retained evidence

At **09:22:13 UTC**, Agent idle, browser disabled/stopped with no profile, MCP zero. Normal
archive API succeeded; Agent is archived. No direct daemon worker children remained. No browser
or auxiliary search process was launched. Operator home, daemon and connected account remain
available, with no logout, reset, deletion or credential transfer.

Canonical Pi transcript remains private and authoritative. Bounded control records are under
`/tmp/baz069-native-t18b-retry-vk6fRp/`: `prepared.json`, `trial-summary.json`, `settled.json`,
pre/post pin checks and scripts. Search errors in the summary retain only allowlisted fields and
reconstructed refusal text, not arbitrary provider/exception strings. Earlier records remain
separate, unchanged observations; this result is not retrospectively attributed to them.

## Next engineering decision (offline; no new live authorization)

Investigate a narrow **Codex streamed-request / missing-MIME contract repair**, with complete
bounded SSE framing/identity/terminal/model/search/citation/secret validation. Choose any codec
policy from the admitted provider/endpoint/request contract, **not the diagnostic prefix hint**.
Do not make arbitrary content a successful response, add HTML rendering/challenge handling,
blindly try both decoders or introduce transport/account fallback/replay. Preserve rejection of
mislabeled populated content types unless separately supported and reviewed.

The known `response.done` normalization difference remains a separate offline concern: this
attempt never reached SSE parsing, so it does not prove that terminal event was present.
Request UA/session/compression differences also remain confirmed comparison facts, not proven
causes or permission to change them blindly. Any repair requires targeted offline regressions,
security validation, new pins and review/qualification disposition before fresh explicit bounded
live authorization. T18(b) still requires actual search → guarded official NASA source read →
verified facts/effective URL → cited answer → one clean same-attempt `done`.
