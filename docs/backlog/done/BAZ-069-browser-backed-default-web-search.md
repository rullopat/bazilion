---
id: BAZ-069
title: Agent-led web research with native OpenAI search and optional managed browsing
status: done
size: L
created: 2026-09-21
refined: 2026-09-30
completed: 2026-10-03
target_release: 0.23.0
note: Operator-approved scope revision on 2026-09-30. Provider-backed discovery replaces browser-driven search as the default; add native OpenAI API and ChatGPT subscription search while retaining the implemented managed browser as an optional separate reading/interaction capability. Earlier browser qualification attempts remain historical incomplete or assisted evidence, not passes of the revised T18(b). Native implementation and narrow independent reviews are complete; the 2026-10-03 post-accumulator source trial observed the revised same-attempt Agent journey successfully. Independent live-evidence acceptance and current Linux packed/CLI/web checks now pass after a packaging repair. Operator accepted the changes and story close-out on 2026-10-03; API-key mode stays experimental/unqualified and release approval is separate. Scope approval authorizes no authenticated provider or browser trial. The existing filename is retained for story links.
---

# BAZ-069 — Agent-led web research

Released2026-10-21 in [v0.23.0](https://github.com/rullopat/bazilion/releases/tag/v0.23.0).
## As built and accepted scope

An accepted same-attempt subscription journey performed native search, five guarded NASA reads
and a source-grounded cited answer with clean completion and no browser/fallback. Operator and
independent bounded acceptance cover that journey, not every model/account or public browser site.
API-key search remains experimental/live-unqualified. The earlier browser-only gate was explicitly
superseded, not passed by a diagnostic or assisted attempt. No repeat live call is authorized.
See [web research](../../web-research.md) and [managed browsers](../../browser-research.md).

## User stories

- As a user with OpenAI API access or an existing ChatGPT/Codex subscription connection, I
  want my Agent to discover current sources without obtaining a separate Brave search key,
  configuring SearXNG, or successfully submitting a query through Google/Bing's browser UI.
- As a user, I want configured search providers respected, and the actual search route,
  account type and limitations explained rather than silently changing engine, model or billing.
- As a user, I want cited answers grounded in sources the Agent actually reads, with clear
  distinctions between hosted search summaries, retrieved source text and inference.
- As an operator, I want managed browsing available for permitted JS-heavy reading and
  interactions, with its existing isolated profiles, visibility, lifecycle and safety controls.
  Browser availability is not a prerequisite for provider-backed search.
- As an operator, I want missing credentials, unsupported native search, policy denial, genuine
  empty results and upstream failures reported accurately. No fabricated search receipt or
  automatic browser/provider fallback should hide a failure.

## Goal and authorized direction change

Make **provider-backed search the default discovery capability** for ordinary interactive
research. Preserve Brave/SearXNG, add OpenAI-hosted native search for both official API-key
Responses and Bazilion's existing ChatGPT subscription/OAuth route, and retain `web_fetch`
for lightweight public source reading. Managed `browser_*` is a separate optional capability,
not another implicit search provider or a required workaround for missing search credentials.

The operator explicitly approved this scope rewrite on **2026-09-30**. It supersedes the
requirement that T18(b) must submit a browser search to Bing/Google. **T18(b) remains a required
live Agent research gate**, now against the native-search contract below. This is an explicit
change of acceptance scope, not a claim that browser search started working or that a diagnostic
passed the previous gate. No live trial, spend, credential import or publication is authorized.

The browser architecture is unchanged: direct installed-browser startup with a managed local
persistent profile, verified loopback CDP attachment and the normal validating SSRF proxy.
No stale-control exception, stealth, personal-profile attachment or challenge bypass is added.

## Design boundary

Native Responses search is distinct from browser automation or a Codex app-server harness.
Do not transplant another Agent runtime, silently select a different account/model or enable
rejected browser-control predicates. An upstream implementation or a read-only diagnostic does
not establish Bazilion's transport compatibility or a successful Agent research journey.

## Scope

### 1. One deterministic, inspectable search route

For ordinary interactive turns, resolve an immutable daemon-owned route at admission:

1. Global search disablement or capability/policy denial means **disabled**, including native
   search. Do not leave a hidden hosted tool in the provider payload.
2. An explicitly selected supported route wins: Brave, SearXNG, native OpenAI API, or native
   ChatGPT/Codex. Missing/invalid configuration or execution failure refuses that route;
   it does not fall through to another provider, browser or account.
3. With no explicit selection, preserve existing configured backend priority: **Brave, then
   SearXNG**. This avoids changing a configured operator's existing discovery account.
4. With neither configured, select native search only for the current Agent's supported,
   admitted OpenAI Responses or `openai-codex` model/official endpoint and credential route.
   Use that account and selected model; do not substitute an undocumented search model.
5. Otherwise report **unavailable** with setup guidance. Merely having an OpenAI credential
   elsewhere does not auto-send another provider's Agent query to it.

This is Bazilion's explicit policy, not a verbatim claim about OpenClaw's precedence. A later
cross-provider Codex search-model setting requires explicit account/model selection; it is not
required to close this story. Model/transport capability must be verified; unknown combinations
fail closed. A custom OpenAI-compatible URL is not the official hosted-search API.

### 2. Daemon-owned, bounded native OpenAI search

Add native `web_search` through a **narrow daemon-owned search adapter**, invoked over the
existing turn-bound host/IPC composition. Prefer the existing direct Responses transports;
validate subscription compatibility before advertising it. If that transport cannot satisfy
the contract, stop for a reviewed architecture decision rather than silently introducing a
Codex CLI/app-server agent. A bounded app-server implementation may be considered explicitly,
with a private home/cwd, scrubbed env and structurally closed tools; copying upstream prompts
alone is insufficient isolation.

- API-key mode uses the official OpenAI Responses endpoint and selected API credential.
  Subscription mode uses the admitted ChatGPT/Codex endpoint, existing daemon-owned OAuth
  supplier and mid-request refresh ownership. No refresh token, bootstrap credential, generic
  authenticated fetch or endpoint-selection authority crosses to a worker/model.
- The auxiliary request gets the bounded query and public search restrictions, not Team files,
  private Agent documents, full conversation, attached credentials or ambient Codex config.
- Enable only the provider-hosted `web_search` tool; no shell, filesystem, browser, MCP, peer,
  question, approval workflow or other agent capabilities. The caller cannot add tools or
  override provider/model/endpoint/credential through tool arguments.
- Initial limits: query **512 characters**, citation/result count **1–8** (default 5), **30-second
  request deadline**, **2 MiB consumed upstream response/stream**, **32 KiB returned evidence**,
  citation URLs **2 KiB each**. Cancellation retires the request; no automatic search retries
  or route fallbacks. Enforce limits while consuming, not after retaining unlimited bytes.
- Verify an actual provider hosted-search execution item and successful terminal response.
  A fluent answer without search evidence fails; transport completion is not proof of search.
  Preserve bounded citation annotations/source URLs, action/evidence identity and observed
  cached/live mode where supplied. Requested mode is not an observed execution fact.
- Return a closed hermetic wire shape distinguishing **grounded answer**, structured results,
  empty results and refused/failed/incomplete evidence. Do not invent snippet rows from prose.
  Treat all provider answers, citation titles and snippets as untrusted external content.
- Native hosted search performs **provider-owned egress**, not browser-proxy-contained requests.
  Do not claim Bazilion's SSRF proxy validated provider-fetched pages. Local source fetching
  remains independently guarded; domain filters do not replace its checks.
- API mode may incur additional API search charges. Subscription mode uses account entitlement
  and limits, not an unlimited/free guarantee. Status/docs distinguish these routes.

### 3. Research instructions and source reading

Update ordinary-turn tool/prompt composition to prefer admitted `web_search` for discovery,
then `web_fetch` to read relevant sources. Optional managed browser reading is used only when
admitted and appropriate, with its own conditional guide. No internet/search instructions are
injected when the capability is disabled or restricted.

- Cite effective URLs actually read, distinguish source dates, contradictory information,
  discovery summaries and model inference. A citation returned by search is not a receipt that
  the Agent read the page. A fetch redirect must be checked and reported accurately.
- Explicit user source/domain restrictions apply to search and reading. If a capability cannot
  enforce a requested restriction, refuse/explain rather than pretending it was enforced.
- JS-heavy reading can use the managed browser when permitted. It is **not** an automatic
  fallback after native search failure. No forced engine switch, login, CAPTCHA handling,
  consent acceptance, publication, purchase or private-data submission.
- Maintain existing source-owned egress/policy boundaries. Research outputs are not permission
  to send them to peers, another Team or an external publication service.

### 4. Separate optional managed browsing — retain implemented invariants

Reuse the existing pool, profile paths, resource registry, tools and operator controls. Browser
failure does not disable native search; native-search failure does not broaden browser admission.

- Directly spawn the selected installed browser with a scrubbed env and native sandbox/UA;
  verify child-owned loopback debugging before CDP attach. No Playwright-owned replacement,
  stealth, arbitrary CDP, personal-profile import, implicit install or mode/executable fallback.
- Preserve per-Agent mode-0700 profiles outside Team/Agent inputs, exclusive ownership, stable
  tab IDs, restart markers and `recovery_required` refusal. No provider/daemon/MCP secrets in
  browser env. Profiles remain excluded from backup/export/restore.
- Keep headed/headless diagnostics, capacity/tabs/timeouts, bounded graceful retirement, idle
  reaping/cancellation/shutdown and supported status/stop/reset. Delete and Team transfer retire
  before clearing identity; unknown/live ownership cannot be unlocked or deleted to make progress.
- All normal browser egress stays on the validating public-address proxy: loopback bypass
  disabled, private/metadata/rebinding/scheme guards, worker/WebSocket/popup/download controls,
  QUIC/P2P denial. Persisted service workers remain proxy-confined. No private-network override
  qualifies production acceptance.
- Retain whole-document freshness, before/after publication leases, single-use observations/
  cursors, bounded text/screenshots and no replay after uncertain effects. The rejected
  dialog-island prototype and unqualified native evidence remain **non-authorizing**.
- Existing browser HTTP/CLI/web status/stop/reset parity remains. Configuration/status is not
  proof a public site works. Human assistance and site blockers remain explicit.

### 5. Operator surfaces and posture separation

Use existing daemon-owned config/secrets and management surfaces; no separate credential store,
DB workflow or second search/browser registry. CLI and web must share route configuration and
readiness/error composition. Agent-visible status is read-only and gives no credential mutation.

Show disabled/unavailable/configured route, provider/model, account type, requested search mode,
bounds and sanitized failure/remedy. Distinguish configured capability from observed execution.
A management test is an explicit invocation with normal billing/limits, never a passive status
probe. No plaintext credentials, private endpoint tokens or full upstream error bodies in output.

Only ordinary admitted turns gain the new native adapter. Protected turns retain BAZ-067's
existing configured discovery host and uncredentialed fetch; restricted reviews/verifications,
scheduled and inbox postures gain no new capability implicitly. Neither BAZ-031's protected
provider credential nor a general model connection is permission to add hosted search.

## Explicitly out of scope

- Browser-engine scrapers, native-equality action exceptions, solving Bing/Google freshness or
  anti-bot acceptance as a default-search prerequisite, stealth and challenge bypass.
- Replacing Pi/the general Agent runtime with OpenClaw/Codex app-server; a general auxiliary
  agent, new workflow/runs/events store, automatic retries or cross-provider billing fallback.
- Additional search providers and migration of all
  ordinary Brave/SearXNG credentials. Existing env-backed asymmetry remains documented.
- Broadening protected/restricted/scheduled admission, personal browser accounts, social
  publication, image generation (BAZ-059), generalized recovery or portable Agent turns.

## Tests and acceptance

The [managed-browser contract](../../browser-research.md) owns the task checkboxes. T01–T17
browser work/reviews are retained evidence, not native-search implementation acceptance. New
native work belongs to **T18.N1–N5**, followed by the revised T18(b) gate; do not close by combining
old failed attempts with the read-only diagnostics.

1. **Capability/instructions:** fixture ordinary turns without Brave/SearXNG credentials receive
   the verified native route for eligible API/OAuth connections, independent of browser install.
   Denied/disabled/unsupported turns receive no hidden hosted tool or misleading guide.
2. **Browser launch/discovery:** preserve installed binary/mode/owned-CDP, sandbox, proxy,
   persistence and packed-install regressions. No new promise of search-engine acceptance.
3. **Composed deterministic research:** actual worker/daemon `web_search` host, fake native
   Responses events, guarded source fetch, citation delivery and clean completion. Include
   redirects, native evidence absent, citations absent, truncated output and unsupported mode.
4. **Adversarial boundaries:** spoofed route/Agent/provider/model, endpoint/credential exfiltration,
   malicious prose/citation URLs, response/stream budgets, missing search execution item,
   401/403/429, cancellation and secret-redacted failures. Browser private-target zero-hit
   regressions remain; do not label provider-owned networking as passing the browser proxy.
5. **Lifecycle:** browser persistence/ownership regressions plus native timeout/abort/late-result
   retirement. No orphan auxiliary process, unbounded stream, secret artifact or stale receipt.
6. **Isolation/privacy/parity:** Agent/Team/turn binding, credential ownership and CLI/web route
   status agree. Browser profile backup/deletion/transfer invariants remain. No full-conversation
   or Team content in the query-only auxiliary request.
7. **Honesty:** execution, successful source reading, empty results, failure and partial evidence
   are distinct. No model-only “I searched”, fake “no results”, native-to-browser fallback or
   applying an older search receipt to a new attempt.
8. **T18(a), optional browser lane:** retain historical assisted journey and blocker evidence;
   do not claim unattended browser search. If current runtime changes touch browser behavior,
   re-review/regress those boundaries. A new Google/Bing search success is **not** a requirement
   for the revised native default or T18(b); no former failure becomes a pass.
9. **T18(b), revised mandatory live Agent gate:** after T18.N1–N5 review, obtain fresh bounded
   authorization for one ordinary Agent using the existing ChatGPT subscription route, **no
   Brave/SearXNG and no browser tools**. Give a research goal, not scripted tool steps. In the
   **same attempt**, observe actual hosted search evidence, Agent reading at least one official
   NASA Artemis II source through guarded fetching, verified effective source URL and observed
   facts, a cited answer distinguishing discovery from reading, and one clean terminal `done`
   with no fatal/cancellation/incomplete output. No fallback, login/challenge, downloads,
   publication or profile/credential copying. A blocker-only answer is not a pass. Record
   candidate hash, route/model/auth type, mode evidence, limits, timing, usage and cleanup.
   Official API-key mode has a separate bounded live smoke on an eligible model if advertised;
   subscription success cannot qualify its different billing/transport route. An unobserved
   route stays explicitly unqualified/experimental and cannot be advertised as supported.
10. **Review/regression/close-out:** independent native adapter/security review, root/web types,
    relevant unit/IPC/auth/browser/protected/backup tests, security acceptance, packed install,
    CLI/web management and operator docs. T18(b) stays unchecked until current same-attempt
    evidence is accepted. Every advertised route needs its own observed qualification or must
    be disabled/experimental before close-out. Human/operator acceptance and release/publication
    remain separate decisions.

## Implementation sequence and readiness

Keep existing T01–T17 and their provenance; do not rerun the whole original story as if nothing
was implemented. T18 now orders: **N1 route/wire contract → N2 bounded native transport/evidence
→ N3 turn-bound host/prompt composition → N4 config/CLI/web/docs parity → N5 adversarial review
and regressions → freshly authorized live qualification**. Architectural blockers stop that
sequence and require an explicit decision; they do not authorize a silent model/runtime swap.

Implementation, independent native/source-evidence reviews and current Linux package/CLI/web
checks pass; **final operator acceptance and story close-out recorded 2026-10-03**. API-key mode remains explicitly
experimental/unqualified. No general provider/account entitlement or future public-site success
is implied. The old browser-only gate is
superseded by explicit operator decision, not deferred or reported as successful. Its safety
fixes remain load-bearing wherever optional browser tools are admitted.

### Relationship to the content-Team plan

BAZ-059 release priority and live qualification's protected/scheduled defaults remain separate. This story
adds ordinary interactive native discovery; it does not make those postures browser/native-search
capable or qualify their production workflow.
Historical attempts do not renew their exhausted authorizations. This refinement authorizes no provider spend, browser visit, account access or publication.
