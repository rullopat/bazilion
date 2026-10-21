# BAZ-069 — safe response-format hints and transport comparison (2026-10-03)

## Subsequent authorized retry (separate live record)

[The freshly authorized 09:21 UTC T18(b) retry](BAZ-069-native-t18b-retry-20261003.md) subsequently
observed upstream 200 / missing media / SSE-like prefix / JSON decode refusal on this unchanged
candidate. One search, no receipt or NASA read, clean blocker `done`, archived/no worker;
authorization exhausted. That new record identifies an immediate MIME-led decoder mismatch,
not complete valid SSE/search, earlier causes or a compatibility repair. The implementation/
comparison work below itself remained offline; later research was separately authorized.

## Scope and outcome

The operator requested safe classification and request-header/transport comparison after the
[authorized diagnostic](BAZ-069-native-diagnostic-20261003.md) returned
`decode / invalid_json / upstream HTTP 200 / other media`.

**Offline work only.** No new authenticated provider/search request, credential refresh, research
turn, account/model fallback or publication occurred. The prior upstream body was not retained:
this increment cannot retrospectively identify it as HTML, a challenge/login page or mislabeled
SSE. T18(b) remains unchecked; both prior live authorizations are exhausted.

## Implemented diagnostic boundary

`apps/daemon/src/lib/native-search-format.ts` adds closed diagnostic hints:

- Media: `unknown`, `missing`, `sse`, `json`, `html`, `text`, `binary`, `other`. Inspect at most
  **256 header characters**; no raw media/header value is returned. Unfinished/oversized media
  tokens stay `other`. JSON-compatible custom/vendor types remain `other`, not assumed supported.
- Body prefix: `unknown`, `empty`, `sse_like`, `json_like`, `html_like`, `other`. Inspect at most
  **1,024 string characters** of the already bounded/decoded body. Only leading syntax is
  checked: object/array start, HTML doctype/html tag or standard SSE field/comment lines.
  No DOM/HTML parser, source extraction, script execution, challenge/vendor keyword detection
  or page-content retention. A blank inspected prefix is `unknown`, not an empty-body claim.
- Classification runs **after raw secret filtering**. A refusal for raw protected bytes retains
  `body=unknown`; no body prefix or excerpt is disclosed. Decoded string-leaf/URL secret checks
  still run at their existing evidence/disclosure boundary.
- Failure text now includes the closed `body=...` hint with the existing safe phase/code/status/
  media fields. No new transcript, runs/events table or upstream diagnostic store exists.
- These are **syntactic hints, never authorization or protocol evidence**. They do not select a
  decoder, prove a site/challenge/provider identity, assert entitlement, trigger a retry/fallback
  or qualify search. Decoder selection preserves the established normalized exact SSE MIME rule;
  search/terminal/model/domain/citation/framing/byte/deadline checks are unchanged.

Offline examples, not observations from the previous trial:

| Fake response | New diagnostic facts | Outcome |
| --- | --- | --- |
| 200 `text/html`, starts `<!doctype html>` | `media=html; body=html_like` | JSON decode refusal; no HTML rendered/executed |
| 200 `text/plain`, starts `data:` | `media=text; body=sse_like` | Refusal; no alternate SSE parser enabled |
| 200 `application/json`, starts an invalid object | `media=json; body=json_like` | Invalid JSON refusal; hint is not validation |
| Empty response | `body=empty` | Decode refusal |
| Whitespace beyond the prefix bound | `body=unknown` | No full-body format claim or extra read |
| Proper SSE with no hosted-search execution item | `media=sse; body=sse_like` | Evidence refusal, not success |

## Request comparison: actual pinned Pi API with injected transport

`apps/daemon/test/lib/native-search-transport.test.ts` calls the installed Pi **1.0.0** public
Codex Responses `stream()` API using its public `normalizeContext()`, selected bundled model,
synthetic JWT/account/session, **explicit SSE**, injected fake fetch and `maxRetries: 0`.
The fake transport returns one deliberate HTTP 400; no provider socket, model execution or
hosted-search entitlement test occurs. The native adapter is separately captured through fake
fetch on the same synthetic account. No operator credential/account data is used or printed.

| Property | Bazilion query-only native search | Pinned Pi subscription SSE path |
| --- | --- | --- |
| Destination | `https://chatgpt.com/backend-api/codex/responses` | Same endpoint |
| Method | POST | POST (installed implementation) |
| Bearer/account headers | Selected daemon credential/account | Matching fixture bearer/account |
| `originator` | `pi` | `pi` |
| SSE beta / accept / request Content-Type | `responses=experimental`, `text/event-stream`, `application/json` | Same values |
| User-Agent | No explicit header; Node fetch sends **`node`** | Explicit **`pi (...)`** runtime identity |
| Session/request IDs | Absent | `session-id` and `x-client-request-id` when session supplied |
| Request compression | Uncompressed JSON | zstd when the runtime compressor is available; otherwise JSON |
| `store` / `stream` | false / true | Same |
| Tool choice | Forced `{type: "web_search"}` | `auto` by default; SDK Codex option type offers auto/none/required |
| Declared tools | Only hosted search with requested mode/domain filter | Ordinary supplied transcript tools, not automatically the native hosted-search contract |
| Reasoning | No explicit auxiliary-request effort | Medium in this comparison when explicitly selected |
| Other chat request fields | Query-only request; no full conversation | Ordinary chat conversion, verbosity/include/cache/parallel fields |
| Redirect posture | Explicit `error`; no authenticated redirect | No explicit redirect option in the installed SSE fetch call |

The Node default UA was independently observed using an **owned loopback-only HTTP fixture**,
with no bearer or external connection. The test does not infer UA merely from a missing option.
SDK zstd bytes are decompressed inside the fake transport solely to inspect the fixture payload.

Static installed-source comparison additionally shows:

- Pi defaults to **auto transport**, attempts WebSocket first when available and may fall back to
  SSE before message streaming. WebSocket uses its own beta/session headers. This is **not a
  claim about which transport the past real parent responses actually used**; that fact was not
  retained. The fixture deliberately forces SSE to isolate an HTTP-to-HTTP comparison.
- Native search stays one bounded HTTP/SSE request with no automatic transport switch/replay.
  Adopting the SDK's default retry/fallback machinery would change that contract and is not done.
- Pi accepts/normalizes Codex `response.done` as well as `response.completed`; the narrow native
  parser currently requires the latter. That known concern produced a different offline error
  from the observed `invalid_json`, so it is not the established cause of this diagnostic.

Sources: installed `pi-ai/dist/api/openai-codex-responses.js` (request body, compression,
transport, URL and header builders), `dist/utils/pi-user-agent.js`, and exported API/types.
The previously inspected [pinned OpenClaw reference](BAZ-069-native-search-diagnosis.md) injects
hosted search into its eligible chat connection; it does not prove this bespoke request works.

## Interpretation and next decision

**A concrete request mismatch is confirmed:** native requests identify as Node rather than Pi
and differ from the standard subscription transport/request composition. This may matter at an
HTTP gateway, but a response-format/protection effect is **not proven** by a comparison alone.
Neither the new hints nor the SDK fixture establish entitlement or diagnose the saved live
body. We did not add a fake browser UA, copy personal profiles/cookies, align headers blindly,
follow redirects or enable another transport/provider.

The next separately authorized observation can now distinguish HTML-like syntax from
mislabeled SSE or malformed JSON **without retaining/exposing the upstream body**. If it
establishes a legitimate protocol/header incompatibility, make a narrow reviewed request repair
and retain query-only admission, selected account/model, official endpoint, bounded evidence,
no replay and fail-closed source reading. A hint alone must never be used to broaden decoding
or bypass a challenge.

## Validation / candidate

- Focused native/format/transport/real-worker suites: **106 passed / four files**.
- Root/web types passed. An initial typecheck correctly rejected the fixture's unbranded SDK
  Context; changed it to public `normalizeContext()` and reran. No production refusal was relaxed.
- Scoped Biome exits 0, with three existing template-style infos; no new warnings. `git diff
  --check` passed. No whole-tree lint pass claimed.
- Full `pnpm vitest run --maxWorkers=4`: **2,318 passed / 47 skipped**, **269 files passed /
  seven skipped**, exit 0. Security: **278 required adversarial cases passed**, exit 0.
  Seven new required cases cover prefix/media privacy/bounds, no fallback, secret precedence,
  non-authorizing hints, pinned SDK comparison and the local-UA observation.
- Logs: `/tmp/baz069-native-format-RdYIb7/`. Source/dependency/test manifest `candidate.sha256`,
  manifest SHA-256 **`f9415dddd9c52bd5ca17edfbc4ab676901efeda5eaf7e434b720ed30478ca855`**.
  This is a new local engineering candidate, not an identity claim about earlier freezes.
- The owned idle daemon was gracefully stopped to avoid the known default-port restore-fixture
  guard, then restarted on 127.0.0.1:4321 with the same scrubbed environment and disabled
  scheduler/browser/image posture. Operator home/credentials preserved; passive protected
  status still reports ChatGPT connected, without a refresh/probe. Prior trial Agents remain
  archived. No new research harness or provider request was launched.
- No fresh independent review, rebuilt packed qualification, operator visual acceptance,
  successful live research, release or publication is claimed. Another authenticated attempt
  requires fresh explicit bounded authorization and candidate review disposition.
