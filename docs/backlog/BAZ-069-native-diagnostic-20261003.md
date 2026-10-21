# BAZ-069 — authorized native diagnostic, 2026-10-03

## Later offline follow-up (not another authorized attempt)

[Safe format hints and pinned transport comparison](BAZ-069-native-response-format-and-transport.md)
were subsequently implemented/revalidated with no provider observation. Closed prefix hints and
Node/Pi request differences do not retrospectively establish this attempt's response body or
cause. Its source pins/results below remain those of the original diagnostic, not the later
candidate. Further authenticated observation still requires new explicit bounded authorization.

## Disposition

**Decode-stage response-format failure confirmed in this diagnostic. T18(b) remains unchecked.**
The endpoint returned HTTP 200, but its normalized media type was neither the admitted JSON
nor SSE type. The complete bounded response body failed JSON parsing. This narrows the problem
from generic provider/protocol unavailability to unexpected response formatting; it does not
identify the body as HTML, a challenge/login page, mislabeled SSE or another format.

The operator explicitly authorized this single diagnostic after the
[offline diagnostic remediation](BAZ-069-native-search-diagnosis.md). No second call/turn,
provider/model/transport switch or fallback was made. This authorization is exhausted.

## Scope and candidate

- Same existing ChatGPT subscription connection, explicit **`openai-codex:gpt-6.1-sol` / medium**,
  native **cached requested mode**, no Brave/SearXNG/browser/MCP/Firecrawl or image generation.
- NASA Artemis II goal and nasa.gov restriction, eight-minute ceiling, at most four searches
  and 32 total tools. No challenge/login handling during research, file downloads, publication,
  shell/coding/private-data/memory/peer activity, search retry or guessed-source fallback.
- Fresh ordinary Agent **`c349fb66-1e86-4c59-bce9-3bd0c4dc8dd0`**, reusing the dedicated empty-skill
  research Profile/Team, not the prior Agent/conversation. Expected selection revision zero.
  Goal/restrictions only; no supplied query/source-page URL or scripted tool sequence.
- Source daemon restarted on 127.0.0.1:4321 after diagnostic code changes; scheduler off.
  Normal operator home/OAuth connection retained, no copied/imported credentials.
- Manifest `/tmp/baz069-native-trial-prep-u3k9wy/diagnostics-candidate.sha256`, SHA-256
  **`3659c2e0067db8d2e1d1252b9a63637d1a7d0f4522108341cc92408ccfebd1ff`**.
  Checked unchanged before/after dispatch. Prior root/web types, 99 focused tests, 271 required
  security cases and bounded-concurrency full 2,311 passes / 47 skips apply to this candidate.
  Prior failed full runs remain recorded in the remediation report. No fresh independent
  review, packed qualification, UI acceptance or release approval is inferred from this diagnostic.

## Observed result

- Window **08:09:32.916–08:09:58.843 UTC**, **25.928 seconds**.
- Exactly **one tool call**, Agent-chosen `web_search` query
  `NASA Artemis II mission crew launch splashdown dates`, count 6,
  `allowedDomains: ["nasa.gov"]`.
- The canonical error was:

  ```text
  web_search: native provider/protocol unavailable; no retry or fallback
  [phase=decode; code=invalid_json; http=200; media=other]
  ```

- `http=200` is the **upstream native-search response** status, not merely the local chat endpoint's
  HTTP 200. `media=other` is a closed category from the normalized upstream Content-Type: not
  `application/json` or `text/event-stream`. Exact raw header/type was not retained or disclosed.
- `phase=decode` / `invalid_json` means this attempt reached JSON parsing after bounded body
  consumption, UTF-8 decoding, admission revalidation and raw secret filtering. It is not a
  pre-response connection timeout, HTTP 401/403, deadline cancellation or missing-search-receipt
  validation at the evidence stage. A 200 response can still carry a gateway/login/protection
  page; **authentication/entitlement and actual body format remain unestablished**.
- No full upstream body, raw exception, response headers, credentials/account identity or
  private endpoint data was retained. Therefore neither HTML/challenge nor mislabeled SSE is
  confirmed, and the original failed attempt's cause is not retrospectively proven identical.
- No hosted-search execution/citation/usage receipt, no guarded source reading, no source facts
  or effective source URL. Both parent assistant responses used the selected subscription model.
- Exactly **one clean `done`**, clean NDJSON EOF, no fatal/error/cancellation/incomplete frame.
  The Agent honestly reported `invalid_json` and stopped without research retry/fallback.
  Received stream **9,613 bytes**. Clean blocker completion is not a T18(b) pass.
- Parent usage: **12,073 total tokens** (6,200 input, 113 output, 5,760 cache read, zero cache
  write). Pi catalog estimate **$0.014106**, not a bill or proof of API billing. Native-search
  usage remains unknown; absence of a receipt does not prove zero provider-side usage.
- Prompt/watchdog budget was respected. The monitor remains a post-event watchdog, not a hard
  pre-dispatch tool quota; that limitation was not exercised by this single-call attempt.

## Cleanup

At **08:10:08 UTC**, Agent idle, browser disabled/stopped with no profile, MCP zero. The normal
archive API succeeded. No direct daemon worker children remained afterward; no browser or
auxiliary search process was launched. No live diagnostic harness remains.

The operator daemon and connected account remain available; no logout/reset/home deletion.
Canonical transcript remains private. Bounded local diagnostic records/control scripts are
under `/tmp/baz069-native-diagnostic-fcECif`; prior evidence remains separate.

## Next work

Offline: extend safe response-format classification (closed media/body-format categories only)
and compare the direct HTTP request with the admitted SDK/reference transport. Distinguish a
mislabeled SSE body from a non-API page **before** deciding a protocol/request repair; do not
loosely accept unknown content as successful search or silently switch to another transport.

Any further authenticated observation requires new explicit bounded authorization on the
pinned/review-dispositioned candidate. T18(b) still needs actual search evidence → guarded
NASA source read → cited answer → clean same-attempt `done`. No further trial, fallback,
release or publication is authorized by this record.
