# BAZ-069 — offline Codex missing-MIME repair (2026-10-03)

## Subsequent independent review and terminal assessment

[The ordered follow-up](BAZ-069-native-parser-review-and-terminal-assessment.md) accepted this
parser repair with no actionable findings; two nonblocking test gaps were covered. Production
source remains byte-identical to the reviewed bundle. Actual pinned Pi fixtures confirm a
`response.done` compatibility gap and recommend a strict Codex-only name alias, not wholesale
status normalization/early return. That follow-up alias is not implemented; no live research
ran, T18(b) and packed qualification remain outstanding. The historical evidence below applies
to the original repair candidate; the follow-up records the newer test-only manifest/counts.

## Disposition

Implemented a narrow repair for the immediate mismatch observed in the
[authorized T18(b) retry](BAZ-069-native-t18b-retry-20261003.md): upstream 200, missing media,
SSE-like prefix, JSON decode refusal. **No authenticated provider request was made during this
repair.** Its live effectiveness and T18(b) remain unqualified. All previous live authorizations
are exhausted. Independent review/packed qualification remain outstanding.

## Contract change

In `apps/daemon/src/lib/native-search.ts`, the Codex request already uses the pinned official
Responses endpoint, explicit `stream: true` and `Accept: text/event-stream`. Decoder selection
now uses that admitted request contract when its response Content-Type is genuinely absent or
blank. This is one decoder choice before parsing, not sniffing or trying parsers in sequence:

| Response | Codex subscription | Official API-key route |
| --- | --- | --- |
| Normalized `text/event-stream` | Strict SSE | Strict SSE (unchanged) |
| Normalized `application/json` | Existing JSON/evidence validation | Unchanged |
| Header absent/empty/whitespace | Strict SSE from streamed Codex contract | Existing JSON behavior unchanged |
| Other populated Content-Type | Explicit refusal | Existing behavior unchanged |

A header such as `; charset=utf-8` is **not** an absent header; an SSE-looking body with
`text/plain`, HTML, binary or vendor media refuses. The bounded `media` and `body` diagnostic
hints still do not authorize codec selection or evidence. Valid JSON without MIME on Codex
now refuses rather than being accepted accidentally, while explicitly declared JSON remains
supported. No provider/model/account admission, endpoint, request payload/header, transport,
redirect, retry, fallback or credential path changed.

The strict SSE parser also rejects non-comment/non-standard-field lines rather than silently
skipping HTML/prose preceding a plausible completion. Only `data`, `event`, `id`, `retry` and
comment lines are admitted; event labels cannot be duplicated, conflict with the JSON event
type, carry no data or label `[DONE]`. This conservative parser tightening applies to explicit
SSE too. It is not a general-purpose browser EventSource parser.

Existing complete-event framing, response identity, one successful terminal, DONE ordering,
same-model completed search execution, citations/domains and unadmitted-output checks still
apply. The 30-second deadline, 2 MiB response / 32 KiB returned evidence caps, fatal UTF-8,
raw/decoded credential filtering, turn revalidation and one-request/no-replay contract remain.
An empty/HTML/error/incomplete stream never becomes a successful or empty-results receipt.

### Explicitly not repaired speculatively

- `response.done` remains refused; only the existing `response.completed` terminal is accepted.
  The prior live attempt never reached SSE parsing, so that known SDK difference is not proven
  to occur in native search. A new terminal normalization would need separate strict fixtures/
  review; this patch does not borrow Pi's status synthesis or tolerate incomplete evidence.
- Pi/native UA, compression, session IDs and default transport differences remain unchanged.
- Complete validity/content of the previous upstream body is still unknown because only closed
  hints were retained. This patch may reveal a later protocol/entitlement/evidence blocker rather
  than deliver working search. No account compatibility, source reading or billing claim follows.

## Offline validation

Nine added required test cases in `apps/daemon/test/lib/native-search.test.ts` cover:

1. Absent/empty/blank MIME and explicit SSE success with completed search/citations, one request.
2. Provider/request-bound decoder selection despite unknown prefix; no JSON/SSE decoder retry,
   explicit JSON preserved, API-key route unchanged.
3. Refusal of other populated types even with otherwise convincing JSON/SSE evidence.
4. HTML/prose/malformed frames and contradictory/empty/duplicate labels, no content disclosure.
5. Truncation, duplicate completion, failed stream, identity drift, DONE order and unadmitted terminal.
6. Model, execution, domain, completion and capability evidence still mandatory.
7. Raw and escaped secrets still refused without disclosure.
8. Byte, fatal UTF-8, deadline and cancellation limits.
9. Turn-bound subscription host receipt projection and drift refusal with one fetch/no fallback.

Results on the final source candidate:

- Native/format/transport/real-worker focused suites: **115 passed / four files**. The existing
  real-worker test still uses its API fixture; the new Codex missing-MIME composition is tested
  through the actual turn-bound daemon host, not claimed as a new live/worker Codex run.
- Root/web typechecks passed.
- Full `pnpm vitest run --maxWorkers=4`: **2,327 passed / 47 skipped**, **269 files passed /
  seven skipped**, exit 0.
- `pnpm security:acceptance`: **287 required adversarial cases passed**, exit 0.
- Scoped Biome passed with only three existing template-style infos; `git diff --check` passed.
  No whole-tree lint, fresh independent review or packed qualification is claimed.
- Logs and source/dependency/test manifest: `/tmp/baz069-native-codec-zO7HDw/`.
  `candidate.sha256` SHA-256:
  **`87cc22a2ce32d4b686917312b357b9653b2fe6a34956a713a0ae542175046e93`**.
  Older candidate manifests remain historical, not pins for this patch.

## Operator state / next gate

The owned idle source daemon was gracefully stopped to avoid the known default-port test
fixture conflict and restarted on 127.0.0.1:4321 after validation. Scheduler/browser/image
generation remain disabled, native route auto/cached; existing operator home/account preserved.
Passive protected status reports ChatGPT connected without credential refresh/compatibility
probe. No Agent/research turn was created and no live provider request was issued.

Next: independent review/qualification disposition for these new pins, then fresh explicit
bounded authorization before another T18(b) observation. The gate remains actual native search
execution → guarded official NASA source read → verified source facts/effective URL → cited
answer → clean same-attempt `done`. Blocker completion and fixture success do not pass it.
