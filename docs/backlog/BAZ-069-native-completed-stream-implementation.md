# BAZ-069 — completed-stream Codex search evidence implementation (2026-10-03)

## Subsequent live result

[The newly authorized post-accumulator trial](BAZ-069-native-t18b-post-accumulator-trial-20261003.md)
successfully exercised this unchanged candidate: one actual completed-stream native search, five
guarded NASA reads and a source-grounded cited answer with one clean `done`. Canonical receipt/
fact checks and cleanup passed; no retry/fallback, operator state preserved. Source-level revised
T18(b) source evidence was [subsequently independently accepted; current Linux package/CLI/web
checks pass](BAZ-069-evidence-and-packed-closeout-20261003.md) after a packaging-only dependency
repair. Native source/wire bytes remain unchanged. Operator acceptance closed T18 and BAZ-069
on 2026-10-03; release approval remains separate and API-key mode stays experimental/unqualified.
Authorization exhausted. The
implementation-time no-live disposition below is historical.

## Disposition

**Implemented, independently reviewed and regression-validated.** The operator requested the
implementation following the [deeper OpenClaw comparison](BAZ-069-openclaw-stream-evidence-comparison.md).
Codex SSE may now supply actual completed search/answer items in the stream without repeating
those items in an **explicitly empty** successful terminal output array.

This replaces the terminal-duplication assumption, **not the execution-proof requirement**.
No authenticated research call, fallback, model/account change, credential import or publication
ran. T18(b) remains unqualified pending a freshly authorized bounded attempt; previous live
authorizations remain exhausted. Source engineering validation is not packed/operator acceptance.

## Production changes

- `apps/daemon/src/lib/native-search-evidence.ts` retains completed item snapshots, bounded slot/
  identity maps and content/progress references. `resolve()` produces an evidence projection view
  only after the complete bounded stream has been decoded and validated.
- `apps/daemon/src/lib/native-search.ts` projects that view through the existing mandatory
  search/citation/model/status/secret/budget checks. No request/payload/endpoint/credential or
  codec selection changed. The terminal itself is not mutated.
- `packages/api-types/src/web-search.ts` adds required receipt provenance:
  **`evidence.outputSource: 'terminal' | 'completed_stream'`**. Actual output origin is retained
  in the ordinary tool's JSON and `webSearch` details; no invented terminal contents or claimed
  source reading. API-key and normal terminal receipts report `terminal`.

### Narrow acceptance boundary

1. Only **`openai-codex` SSE**, with recognized `response.completed` or the existing Codex-only
   `response.done` alias, and terminal `output: []`, can use completed-stream items. JSON,
   API-key responses, missing/null output and partial/nonempty terminal arrays do not gain this
   acceptance path. No union, fallback parser or second request.
2. Every observed relevant index must be **contiguous from zero**, within 0–127 and backed by an
   actual `response.output_item.done` object. Added items, lifecycle progress, content deltas,
   text/annotation events and reasoning events only establish references; they never create a
   completed object. Unfinished/gapped/delta-only/progress-only streams refuse.
3. IDs are bounded and unique across indices; index identity/type cannot change. Duplicate
   openings/completions, reopened completed items and later item events refuse. Unknown
   item-bearing events/capabilities cannot disappear from the collected view.
4. Completed hosted-web items require `completed` status and a recognized action. Completed
   messages require assistant role, completed status and content. Reasoning may omit status,
   but an explicitly incomplete reasoning item refuses. This preserves normal reasoning shape
   without letting reasoning supply search or answer proof.
5. Populated terminal output still must agree with observed IDs/types. **Whole completed
   snapshots**, including message annotations/content and search actions, must agree; conflicting
   terminal data never wins by overwrite. Partial nonempty snapshots do not get stream repair.
6. Terminal id/model/status/error/usage metadata remains terminal-owned, unchanged. The ordinary
   projector still requires explicit completed status, selected model, no error/incomplete
   details, 1–8 unique actual **search-action** IDs, completed annotated answer, bounded valid
   citations and requested domain restrictions. Neither terminal event name nor progress proves
   success. No missing model/status synthesis from request configuration.
7. The entire response still must finish and validate before disclosure. Trailing errors,
   duplicate/mixed terminals, invalid labels/framing and DONE ordering refuse. Existing 2 MiB
   upstream / 32 KiB returned evidence / 30-second deadline, cancellation, turn authority,
   raw/decoded live-secret filtering and no-replay rules remain.

### Diagnostics and limits remain truthful

`NativeEvidenceFacts` keeps its existing closed shape. Terminal counts describe the **original**
terminal (`outputItems: 0` remains zero even when completed-stream projection is attempted).
No raw items, IDs, queries, URLs, provider exceptions or response excerpts enter failure diagnostics.
Only successful validated receipts identify `outputSource`; diagnostic counts do not authorize
success. Retained snapshots are bounded by 128 indexed positions and the existing total body cap.

Stricter snapshot/slot consistency also applies to observed populated-terminal streams on both
routes, but no new API-key acceptance route or compatibility/entitlement claim was added.

## Review and tests

- Independent read-only review: `/tmp/baz069-accumulator-review-n0qA6u/review.md` — **narrowly
  accepted, no actionable new security/correctness findings**. Static source/before comparison;
  reviewer executed no tests and did not independently confirm repository gates or live behavior.
- Review suggested nonblocking coverage for all admitted content/reasoning reference families.
  Added that identity/completion matrix; production and wire-shape files remain byte-identical
  to the reviewed bundle. It is not an actual provider-trace compatibility test.
- Review SHA-256:
  **`dd2520303f0008fb56dd61952cfc63396abc0bca7c81bb0e77209791b3f45f0b`**.
- Reviewer ran with isolated supplied files, read-only sandbox, disabled hosted search and ignored
  user config/rules; no home/credential inspection or research tools. Model inference itself was
  remote, not zero-network. No operator credential was copied or imported.
- Added `apps/daemon/test/lib/native-search-accumulator.test.ts`: **17 required cases**, including
  both SSE MIME forms/terminal names, provenance, scope boundaries, contiguous completion,
  metadata, duplicate/displaced/reopened identities, capabilities, contradictory snapshots,
  annotated citations/domain rules, whole-stream failures, byte/item/search budgets, live secrets,
  truthful diagnostics, EOF cancellation, deadline, revoked authority and ordinary-tool details.
  The old no-backfill test was renamed to correctly describe **nonempty terminal omissions**;
  its assertions remain refusals, not deleted safety coverage.
- Final focused suites: **152 passed / seven files**.
- Full suite: **2,364 passed / 47 skipped**, **272 files passed / seven skipped**.
- Security release gate: **324 required adversarial cases passed**.
- Root/web typechecks and `git diff --check` passed. Scoped Biome exit 0 with three template-style
  infos in the new test; no errors/warnings and no whole-tree lint claim.
- Existing real-worker fake-provider fixture remains API-route coverage; these changes do not
  claim a live/real-worker Codex search qualification from that fixture.

## Candidate and operator state

Validation logs and source/dependency/test manifest: `/tmp/baz069-accumulator-jsn6Rf/`.
`candidate.sha256` SHA-256:
**`7405b9d0c88e7392f89c83fa648492cd386b9fb98d645495141524e06cb90318`**.

Only the owned idle daemon was gracefully stopped for full/security test port isolation and
restarted on 127.0.0.1:4321 with scheduler/browser/image disabled, native auto/cached. Operator
`~/.bazilion` and connected ChatGPT account preserved; passive connected check only, no provider
refresh/probe from readiness. No research Agent/turn was created, and no worker remains.
No release/commit/publication or restored historical packed identity is claimed.

## Next boundary

A fresh bounded T18(b) attempt can now exercise this reviewed source candidate after pin/readiness
checks and **new explicit authorization**. It must still demonstrate search evidence → guarded
original NASA source read → verified facts/effective URL → cited answer → clean same-attempt
`done`. The previous trace retained neither the streamed action subtype nor complete annotated
answer nor validated terminal model/status, so this implementation does **not** guarantee that
all remaining live gates will pass. No automatic retry or weaker proof if the next attempt refuses.
