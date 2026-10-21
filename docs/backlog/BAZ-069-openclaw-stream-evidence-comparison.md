# BAZ-069 — OpenClaw completed-stream evidence comparison (2026-10-03)

## Subsequent implementation

[The strict completed-stream accumulator](BAZ-069-native-completed-stream-implementation.md)
was subsequently implemented and independently accepted, with explicit receipt provenance and
unchanged proof/privacy/full-stream/limit requirements. 152 focused / 2,364 full passes / 47 skips,
324 security cases and types passed. New pins/operator state preserved; no live research.
The assessment below is the prior design record, not a current "unimplemented" disposition;
T18(b) remains unchecked and requires fresh bounded authorization.

## Conclusion / correction to prior investigation

The operator requested a deeper OpenClaw comparison after our
[post-evidence retry](BAZ-069-native-t18b-post-evidence-trial-20261003.md) observed a completed
streamed hosted-web item but an empty `response.completed.output` array.

**OpenClaw retains completed streamed material; it does not require all of it to be repeated
in a terminal array.** Its managed Codex search regression explicitly succeeds with a streamed
`webSearch` item followed by `turn/completed` with `items: []`. Its direct Responses consumer
also retains completed streamed answer text when terminal `output` is empty.

Our earlier inspection of payload injection and an official OpenAI SDK snapshot implementation
was insufficient to characterize OpenClaw's consumers. The earlier "no inspected source supports
terminal omission" finding is superseded by the collector/test evidence below. **Requiring real
completed execution evidence is not the same as requiring duplicate evidence in terminal output.**
This identifies an overly restrictive assumption in our current adapter; it does not justify
accepting progress markers, guessed IDs or model prose as execution proof.

No authenticated search, OpenClaw installation/account import, daemon mutation or production
change was performed. Public GitHub source GETs only, plus offline synthetic module checks.
We have **not** observed OpenClaw successfully execute this exact NASA/account/model attempt.
T18(b) and the next live authorization remain outstanding.

## Source identity

Same immutable upstream as the earlier investigation:
**`6248825df550bb9cd38a0da8b2a3592593a3aeb9`**. Retrieved its complete Git tree and selected source
files from public GitHub. Each downloaded file was checked against its tree entry's Git blob
SHA-1; no upstream code/config was installed into Bazilion.

Artifacts: `/tmp/baz069-openclaw-stream-6EVhVP/` (`tree.json`, `source/`, `sources.sha256`,
`check-collectors.mjs`, `checks.json`). Source manifest SHA-256:
**`9599d87012b833e6d7b02eb538acee7ec173863fdca87fa5865ee7374a8dcaf7`**.

## Two different routes — do not conflate them

### Direct ChatGPT Responses: streamed assistant output survives empty terminal

1. [`createCodexNativeWebSearchWrapper`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/src/llm/providers/stream-wrappers/openai.ts#L524)
   injects hosted search into the **parent model request** through its payload hook. This is not
   Bazilion's separate daemon-owned search subrequest/receipt.
2. `packages/ai/src/providers/openai-chatgpt-responses.ts:523–554` maps the stream and invokes
   the shared `processResponsesStream`; this is the pinned OpenClaw `packages/ai` implementation,
   not an assumption about whichever Pi version Bazilion currently embeds.
3. [`processResponsesStream`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/packages/ai/src/transports/openai-responses-stream-internal.ts#L506)
   materializes/finalizes text and reasoning at `response.output_item.done`. At lines 677–699 it
   finalizes terminal metadata and considers terminal items for recovery; it does **not** replace
   accumulated public text with `response.output` or demand that every completed stream item
   reappear there. Empty terminal output therefore does not erase completed answer text.
4. `openai-responses-stream-terminal-internal.ts:351–364` finalizes usage/model/stop reason over
   existing content. `recoverTerminalOutput([])` has nothing to add, but does not clear content.
5. The inspected generic stream projector has no `web_search_call` → Bazilion-style search
   receipt/citation projector. It recognizes provider-tool occurrence for retry-safety tracking,
   but its public content branches are message/reasoning/function calls. Successful chat output
   is not equivalent to our validated execution-ID/citation/source-read contract.

Do not copy unrelated permissiveness: `openai-chatgpt-responses-events.ts:87–105` returns at its
first terminal, and `openai-responses-terminal-usage.ts` maps missing/queued/in-progress status
to `stop` in some cases. Bazilion must retain explicit successful status and whole-stream checks.

### Managed `provider: codex`: actual search collector uses streamed completed items

1. [`executeCodexWebSearchProviderTool`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/extensions/codex/src/web-search-provider.runtime.ts#L18)
   runs an isolated bounded app-server turn. It filters **`result.items`** for `webSearch` and
   refuses an answer with none. This is not the direct HTTP Responses wire protocol.
2. `bounded-turn.ts:325–396` selects `CodexEphemeralTurn(..., {textMode: "all"})`, requires a
   completed turn and nonempty answer (unless explicitly allowed), and returns the collector's
   items. It does not return only `turn.items` from the terminal.
3. [`CodexEphemeralTurn`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/extensions/codex/src/app-server/ephemeral-turn.ts)
   records `item/completed` notifications in an ID-keyed map. After completion, it copies that
   map and overlays any terminal `turn.items`; an empty terminal list leaves observed items
   intact. Text similarly comes from collected completed messages/deltas.
4. This is explicitly exercised by
   [`web-search-provider.test.ts`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/extensions/codex/src/web-search-provider.test.ts):
   lines 77–88 create turns with `items: []`; lines 108–144 emit a completed `webSearch`, answer
   delta and empty completed turn; the test **"runs an isolated grounded Codex search with
   configured restrictions"** expects returned search evidence. The final test omits the search
   notification and expects **"completed without invoking web search"**, despite answer text.

This collector's ID overwrite/deduplication, generic `webSearch` acceptance, model `live-default`
selection and answer/citation handling are **not** our contract. Do not transplant the app-server
runtime, import account credentials, silently change models/routes, or copy last-write-wins
handling into Bazilion's stricter contradiction checks.

## Bounded offline reproduction

Executed the **actual fetched modules**, compiled locally by TypeScript, in VMs with explicit
infrastructure dependency doubles and no ambient process/filesystem/network/provider access:
`CodexEphemeralTurn`, `projectCodexWebSearchItem`, `executeCodexWebSearchProviderTool`, and the
direct Responses terminal controller/status helper. Router/validators/client-launch, content
wrapping and cost/log helpers were doubles; this is **not** a full upstream suite or transport test.

Four final checks passed:

| Synthetic case | Observed upstream module behavior |
| --- | --- |
| Completed streamed search + completed answer + empty terminal items | Accepted, one retained search |
| Completed answer only + empty terminal items | Refused: no web search |
| Search supplied in terminal items | Accepted, one search |
| Already-completed streamed answer text + empty Responses terminal output | Text preserved, stop reason `stop` |

The initial local harness incorrectly doubled the router's one-argument signature; correcting
that harness binding made the checks run. No provider request was involved. We inspected, but
**did not run**, OpenClaw's repository tests. Bazilion candidate pins remain unchanged; no new
whole-tree/security test claim is made for this documentation-only investigation.

## Recommended next implementation — not implemented or live-authorized here

Replace the **terminal-duplication assumption**, not the execution-proof requirement:

- Narrowly admit the observed **Codex SSE empty-output terminal** form. Collect actual complete
  `response.output_item.done` objects, not progress/delta guesses, keyed by bounded index and ID.
  Preserve provenance that items came from the stream; do not claim terminal content existed.
- Require successful terminal completion and selected-model/response identity, complete relevant
  slots, actual completed **search action** with unique IDs, full completed answer content and
  validated citation annotations. Keep status/model validation explicit: the latest refusal
  occurred before those checks, so their presence in the live response is still unproven.
- Populated terminal output must still agree with observed evidence. Reject conflicting/repeated
  identities, unfinished slots, status/action/citation changes, unsupported capabilities and
  partial nonempty snapshots; do not silently union contradictory snapshots or let later data win.
- Preserve entire-stream validation, later-error/duplicate-terminal refusal, byte/deadline/
  cancellation/admission/secret/domain checks and one-request/no-fallback behavior. Do not adopt
  OpenClaw's early-terminal return or permissive status normalization.
- Fixtures should demonstrate valid empty-terminal Codex search **and annotated answer**, plus
  absent/incomplete search, missing answer/citations/model/status, displaced IDs, contradictory
  snapshots, trailing errors and secret/budget violations. Review and repin before a fresh,
  separately authorized live attempt. Official API-key semantics remain separately qualified.

A strict completed-item accumulator is now a source-supported direction, rather than a blind
attempt to fabricate missing search evidence. It is **not yet a tested Bazilion implementation**,
and cannot guarantee T18(b): the prior live attempt retained neither the streamed action subtype
nor annotated answer content nor validated terminal status/model.
