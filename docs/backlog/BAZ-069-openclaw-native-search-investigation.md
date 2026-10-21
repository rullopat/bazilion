# OpenClaw native search — investigation for the BAZ-069 direction decision

**Scope decision update (2026-09-30):** the operator approved the [revised story](done/BAZ-069-browser-backed-default-web-search.md) with native OpenAI/API and subscription discovery, optional separate browsing and a revised mandatory T18(b). The research/recommendation below predates that approval. The story and T18.N1–N5 handoff now own precedence, limits and acceptance; approval is not implementation or a live-search authorization.

2026-09-30. User requested checking OpenClaw's implementation as an alternative to browser-driven default search. **Research only:** no authenticated search/provider call, browser trial, implementation or backlog cancellation performed.

Pinned upstream: OpenClaw `6248825df550bb9cd38a0da8b2a3592593a3aeb9` (main commit observed 2026-09-30). Sources downloaded into `/tmp/openclaw-search-inspection-Ldj6BA/`. Conclusions describe that snapshot, not every past release.

## Follow-up: stream-consumption comparison (2026-10-03)

[The deeper collector comparison](BAZ-069-openclaw-stream-evidence-comparison.md) traces beyond
payload injection: direct Responses retains completed streamed text; managed Codex search
explicitly tests a completed streamed `webSearch` followed by empty terminal items and retains
that execution. Four isolated upstream-module checks passed (infrastructure doubled, no live
provider call). Our terminal-duplication requirement is too restrictive; actual completed-item
accumulation is a source-supported next design, preserving search/citation/status/identity and
whole-stream checks. Not implemented here, no exact-account success or new live authorization.

## What upstream actually does

| Connection / runtime | Selection behavior |
| --- | --- |
| Official OpenAI Responses (`openai`, `openai-responses`) | Enabled search + no explicitly selected managed provider → native OpenAI `web_search`. Not dependent on absence of every configured Brave/SearXNG credential. Custom OpenAI-compatible endpoints and Azure are excluded from this route. |
| Codex app-server agent runtime | Hosted search by default when enabled, native surface/support permits it and no managed provider is selected. Native and managed search are mutually exclusive. |
| Direct ChatGPT subscription Responses (`openai-chatgpt-responses`) | **Opt-in**, `tools.web.search.openaiCodex.enabled: true`, eligible transport/auth/tool policy and no explicit managed provider. Not simply automatic because OAuth exists. |
| Managed `web_search` with `provider: "codex"` | Explicitly selected Codex Hosted Search can serve **any parent model** through a bounded ephemeral app-server search turn using Codex sign-in. It never wins managed-provider credential auto-detection. |

OpenClaw's general `web_search` is an HTTP/provider capability, **not browser automation**. Browser tools remain for JS-heavy pages, authenticated sites and interactions. Native-provider selection precedes managed-provider discovery: merely configuring another provider's credentials is different from explicitly pinning it. A selected managed provider has no silent runtime fallback. Global/tool-policy disablement also disables native search, rather than leaving a hidden provider tool available.

### OpenAI direct payload injection

[`extensions/openai/native-web-search-policy.ts`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/extensions/openai/native-web-search-policy.ts) checks provider/API/endpoint/config. The [stream wrapper](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/extensions/openai/native-web-search.ts) removes a competing function tool named `web_search`, adds `{ type: "web_search" }` to the Responses payload, and adjusts unsupported `minimal` reasoning to `low`. It is a provider-hosted tool, not a client-side function returning Google/Bing HTML.

The direct subscription path builds `type: "web_search"`, `external_web_access`, optional domain filters, context size and approximate location in [`codex-native-web-search-core.ts`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/src/agents/codex-native-web-search-core.ts). Its [config resolver](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/src/agents/codex-native-web-search.shared.ts) explicitly defaults `enabled` to false and mode to `cached`; requesting current live discovery needs an intentional mode decision.

### Codex Hosted Search as a managed provider

[`extensions/codex/src/web-search-provider.runtime.ts`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/extensions/codex/src/web-search-provider.runtime.ts) launches a private-stdio, bounded ephemeral app-server turn with the query only, grounding instructions, no dynamic tools and the hosted-search thread configuration. Its return contract requires an actual `webSearch` item: a model answer without one fails. It returns a synthesized answer and search evidence, not necessarily an ordinary list of search-engine snippets.

The shared bounded runner uses a temporary workspace/private home, read-only sandbox and approval handling; this is more than a prompt claiming “search only.” Replicating it would require a properly closed daemon-owned auxiliary capability, not adding a general Codex shell/MCP agent or transplanting the whole app-server harness. The upstream `live-default` model selection should not be blindly copied into Bazilion's explicit/fail-closed model contract.

Canonical upstream explanation: [pinned `docs/tools/web.md`](https://github.com/openclaw/openclaw/blob/6248825df550bb9cd38a0da8b2a3592593a3aeb9/docs/tools/web.md), sections “Native OpenAI web search” and “Native Codex web search”.

## Fit with Bazilion

Current Bazilion daemon uses Pi **0.87.1** in the inspected working tree. `openai-codex` already uses the ChatGPT backend with daemon-owned OAuth refresh, rather than OpenAI API-key billing. Thus subscription-native search is a relevant candidate, but **OpenClaw's API-key default does not prove our direct OAuth route accepts it**. No live compatibility or account entitlement was checked.

The installed Pi request options have an `onPayload` hook, used by its OpenAI/Codex Responses adapters. That supplies an injection point. However, its inspected shared Responses projection handles reasoning/message/function/custom-tool items and does not explicitly project hosted `web_search_call` items or URL-citation annotations. Injecting a tool alone would not give Bazilion reliable search receipts, citations or usage visibility. A reviewed narrow adapter/projection is necessary; do not modify `node_modules` or infer execution from plausible answer text.

Existing `runtime/tools/web.ts` managed search supports Brave/SearXNG; protected discovery already delegates to a daemon-owned bounded host. We should retain daemon credential ownership and that capability separation, not expose refresh credentials or a generic authenticated fetch tool to workers.

## Recommended pivot, pending scope decision

Make **provider-backed discovery the default search path**, and preserve managed browsing as a separate optional reading/interaction capability. This is not removal of useful browser tools or weakening of their freshness/SSRF/ownership rules.

1. Define one explicit route decision: disabled, selected managed provider, supported native OpenAI/API or subscription route, or unavailable. Show actual route/account/model in status. Do not silently substitute a search engine/account after an error.
2. Prioritize a daemon-owned bounded native-search adapter for the existing subscription transport, with explicitly selected model/endpoint, query-only input, cancellation/deadline, no shell/files/MCP/browser/peer capabilities and no automatic retries. Compare direct transport to the isolated Codex app-server option; choose based on tested compatibility and structural restrictions, not familiarity.
3. Require actual provider search execution evidence and bounded validated citations. Missing evidence is an error, never “searched” prose. Keep answers, discovery citations and actually fetched/read sources distinct. Native search is provider egress, **not** execution inside our browser SSRF proxy.
4. Reuse guarded `web_fetch` for source verification where applicable. Preserve untrusted-content treatment and label the provider/account/billing route. API-key search incurs API charges; subscription OAuth uses its account entitlement/limits, not an unlimited/free promise.
5. Offline fake-protocol/security checks first; separately authorize one bounded authenticated compatibility trial. Restricted reviews/verifications must not acquire hosted search implicitly; protected search keeps its own admitted capability contract.

No browser T18(b) success is claimed. The user's proposed pivot should explicitly revise/supersede the browser-as-default requirement if adopted, rather than relabeling provider discovery as passing the original Agent/browser gate. BAZ-070's optional Exa/Parallel work remains a separate provider option, not proof of this route.
