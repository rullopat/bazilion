# Ordinary Agent web research

BAZ-069 adds a daemon-owned `web_search` host for ordinary interactive turns. Browsers are
optional for reading/interaction; they are not required to submit discovery queries.

## Routes and configuration

```sh
bazilion config set BAZILION_WEB_SEARCH on
bazilion config set BAZILION_WEB_SEARCH_ROUTE auto
bazilion config set BAZILION_WEB_SEARCH_MODE cached
bazilion agent search status <agent-id>
```

The same settings appear under **Config → Web Search**; the Agent page shows **Web discovery**
readiness. Status is read-only: it does not refresh OAuth, probe providers, launch browsers or
incur search charges. `GET /api/agents/:id/search-status` and the native client return the same
route/model/account/qualification description.

- `off` removes ordinary search. It does not change independently configured BAZ-067 protected
  SearXNG discovery.
- `auto` preserves configured **Brave, then SearXNG**. Without either, eligible OpenAI/ChatGPT
  Agents follow their **own selected model and account**. Other providers do not auto-send queries
  to a separately stored OpenAI credential.
- Explicit `brave`, `searxng`, `openai` or `openai-codex` selects only that route. Native selection
  must match the Agent's provider. Missing configuration, account replacement, unsupported model,
  cancellation or failure does **not** switch provider, account, model or browser.
- Native **direct API and subscription routes are experimental/unqualified pending live checks**.
  Protocol admission uses a narrow pinned catalog subset, not an entitlement guarantee. API mode
  may incur additional search charges; ChatGPT mode uses account entitlement and subscription
  limits. A saved credential or an ordinary model connection does not prove hosted search works.
- `cached` (default) / `live` requests the hosted search network posture. Returned evidence reports
  the request and `observedMode: unknown`; it does not claim the provider attested its execution
  mode. Custom native endpoint overrides are refused.

The embedded [Pi runtime is pinned to 1.0.0](pi-runtime.md). The bundled official catalogs
include `gpt-6.1-sol`, selected for the bounded subscription qualification trial below. Existing
Agent/Profile selections are not silently changed. This catalog update does not qualify search
entitlement, automatically enable Pi's MCP/codemode extensions, or authorize a live call.

A [2026-10-03 reviewed source-candidate trial](backlog/BAZ-069-native-t18b-post-accumulator-trial-20261003.md)
observed one subscription-native search, five guarded NASA reads and a source-grounded cited
answer with clean completion. [Independent evidence review accepted that source journey; current
Linux packed-install and automated CLI/web checks pass](backlog/BAZ-069-evidence-and-packed-closeout-20261003.md).
The operator accepted BAZ-069 on 2026-10-03. This is scoped evidence, not general model/account
entitlement or release/publication approval. The official API-key route remains explicitly
experimental/unqualified; qualifying it requires its own separately authorized live smoke.

## Evidence, bounds and safety

The auxiliary native request includes the public query, chosen model and hosted `web_search`
only—not full conversation, Team files, Agent documents, shell, filesystem, browser, MCP or
messaging tools. Credentials/refresh remain daemon-owned; the worker receives evidence over
turn-bound IPC. API credential replacement refuses the current admission. OAuth access-token
refresh is allowed only within its captured subscription account.

Query limit: **512 characters**; result/citation count **1–8**; deadline **30 seconds**; consumed
upstream bytes **2 MiB**; returned evidence **32 KiB**; citation URL **2 KiB**, including after
normalization. No internal search retries/fallback; one in-flight search per turn. Native evidence
requires actual completed hosted search, explicit successful terminal status/model identity and
an annotated answer with citations. Receipts report `evidence.outputSource: terminal` or
`completed_stream`. The latter is supported only for Codex SSE with an explicitly empty terminal
output array and complete, contiguous `output_item.done` snapshots; progress/deltas cannot supply
execution proof. Conflicting snapshots, partial nonempty terminals, unfinished items and trailing
stream errors refuse. Missing/incomplete evidence is an error, never invented snippets or “no results”.

All discovery answers, snippets and URLs are **untrusted**. Native hosted networking is owned by
the provider, **not confined by Bazilion's browser SSRF proxy**. `allowedDomains` sends a native
provider filter and checks citations; managed backends refuse this argument. It is not proof of
all provider-internal networking. `site:` text alone is not an enforced restriction.

The Agent must read original sources through guarded `web_fetch`, check effective URLs and cite
facts actually read. Ordinary fetch tool details retain requested/effective URL, fetch time,
HTTP status, cache hit, truncation and direct/Firecrawl renderer. Firecrawl text never inherits
the direct response's source identity: effective source URL/status are unknown, the original
direct-fetch receipt and any bounded **provider-reported** renderer URL/status stay separate.
Cached text retains this original provenance/time; a search citation alone is not a reading receipt. Explicit user
restrictions still apply to reading; the ordinary Agent is not a structural domain-only sandbox.

Protected/restricted review/verification, scheduled and inbox turns gain no new native capability.
Managed browser ownership, freshness, egress and operator controls remain unchanged; see
[browser research](browser-research.md). Trial evidence and the mandatory revised T18(b) gate live
in [BAZ-069 acceptance](backlog/BAZ-069-acceptance.md). No live qualification or release approval
is implied by these settings.
