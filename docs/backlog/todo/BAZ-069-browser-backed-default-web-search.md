---
id: BAZ-069
title: Browser-backed web search by default for ordinary turns
status: todo
size: M
created: 2026-09-21
refined: 2026-09-23
target_release: 0.23.0
note: Operator decision 2026-09-21 — by default Bazilion should just work. Refined 2026-09-23 with a live detection probe (recorded below): the pool's plain headless configuration passes on Bing and Brave Search without any automation-marker tampering; Google and DuckDuckGo wall it regardless. The worker's env-credential asymmetry is resolved in this story by moving all backends daemon-side.
---

# BAZ-069 — Browser-backed default web search

## User stories

- As a user, I want my Agent to search the web out of the box — no API key, no self-hosted
  backend, no bot-block pages — so that discovery "just works" on first use.
- As an operator who wants stricter or cheaper discovery, I can configure Brave (`BRAVE_API_KEY`)
  or SearXNG (`SEARXNG_URL`) and my explicit choice wins over the default; the default is the
  fallback for everyone else, not a locked-in choice.
- As an operator, I want all search backends and credentials to live daemon-side so that the
  worker never reads secrets, mirroring the BAZ-067 protected-turn contract.

## Context and decision

Discovered during the 0.22 review walk-through (2026-09-21): OpenClaw's search works by default
because it queries engines through a **real Chromium** — genuine TLS/HTTP-2 fingerprint, JS,
cookies. Bazilion's `web_fetch` is a plain Node `fetch` with a **spoofed Chrome UA**
(`apps/daemon/src/runtime/tools/web.ts`), which engines cross-check at the TLS (JA3/JA4) and
HTTP/2 layers and block as a bot. Bazilion already owns a daemon-side **browser pool**
(`apps/daemon/src/lib/browser/pool.ts`) proxied into ordinary turns as `browser_*` tools — the
missing piece is a search surface over it, not new infrastructure.

**Operator decision:** browser-backed search becomes the **default** for ordinary turns.
SearXNG-by-default was a mistake: defaults must work even when not optimal; SearXNG/Brave API
remain explicit operator opt-ins. BAZ-067 stays as implemented but is **repositioned** — it is
the opt-in *protected-turn* discovery backend (protected workers keep their no-browser posture),
not Bazilion's default search story.

## Detection reality-check (probes, 2026-09-23/24 + OpenClaw transcript)

Recorded from the refinement probes (`/tmp/baz069-refine/probe*.mjs`; pool-equivalent Playwright
1.61 Chromium 149, Linux, home IP) plus one live transcript observation.

### Matrix: engines × postures

| Engine | Headless (pool config) | Headed | Headed + persistent profile + human pass |
| --- | --- | --- | --- |
| Google | 200 but `/sorry/` wall, 0 results | same wall | **still walled** — the checkbox was clicked by the operator and the wall did not lift |
| DuckDuckGo `html.` / `lite.` | **403** | — | — |
| Bing `/search` | 200, 8/8 results, 3/3 repeat queries | — | — |
| Brave Search HTML | 200, 8/8 results, 3/3 repeat queries | — | — |

The wall page names the cause: "unusual traffic from your computer network. IP address:
83.22.219.85" — the **IP range is flagged**. `--disable-blink-features=AutomationControlled`
(`navigator.webdriver: false`) changed nothing on any engine.

### Cross-machine observation (operator, OpenClaw transcript 2026-09-19)

On the operator's **macOS** machine (different, unflagged home IP), OpenClaw's agent — finding its
HTTP `web_search` unconfigured — fell back to its **headed managed browser** and searched Google
successfully: real, verifiable results (Eurostat, EC, PIP, WEF URLs). The transcript also shows
the agent stating the fallback explicitly: "The dedicated search service was unavailable, so I
used browser-based search."

### Conclusions pinned by this evidence

- **Engine viability is IP-reputation-dependent, not browser-posture-dependent.** Google works
  through a real managed browser on an unflagged network (macOS observation) and walls even a
  headed, human-assisted browser on a flagged one (probe). No posture choice fixes or breaks
  Google universally — so the tool must **report walls truthfully** and never pretend an engine
  is universally available.
- **No automation-marker tampering.** The `webdriver` toggle changed nothing; walls are
  IP-driven. The default ships as the pool's plain configuration (honest UA,
  `HeadlessChrome` stripped). Keeping `navigator.webdriver` honest stays consistent with the
  no-CAPTCHA-circumvention boundary.
- **Engine allowlist: Brave Search HTML (default), Bing, and Google as an explicit opt-in**
  documented as IP-reputation-dependent (works on clean networks, walls on flagged ones with a
  truthful block report). Bing requires redirect-URL decoding (the `u` parameter decodes
  deterministically — `a1`-prefixed base64, verified). The "Brave Search HTML" surface is
  distinct from the Brave Search **API** (`BRAVE_API_KEY`) — the docs must separate the two
  names.
- **Documented browser fallback for the Agent:** when `web_search` fails or is disabled, the
  Agent may use the existing `browser_*` tools to search directly — the OpenClaw transcript is
  evidence that models execute this fallback well. The recipe/docs say so; walls found that way
  are reported, not fought.
- **The human-pass escape hatch is not a mechanism**: on a flagged IP, a solved checkbox does
  not lift the wall in an automation browser (probed). The skill must not instruct the Agent to
  try; it reports the block instead.

## Design

### One `web_search` tool, all backends daemon-side

- The ordinary-turn `web_search` tool keeps its name and bounded result shape. Its worker
  implementation becomes a thin IPC caller — the same pattern as BAZ-067's protected tool — and
  **stops reading `BRAVE_API_KEY`/`SEARXNG_URL` from worker env**. This resolves the recorded
  asymmetry (operator-confirmed migration intent) in the same story rather than later.
- The daemon-owned host owns backend selection and precedence, read at call time so
  configuration drift between claim and dispatch is refused:
  1. `BRAVE_API_KEY` → the existing Brave Search API path (moved worker→daemon, unchanged
     behavior);
  2. `SEARXNG_URL` → the existing SearXNG path (same);
  3. **otherwise the browser-backed default** — the always-available fallback.
  Explicit config therefore wins; unsetting it drops back to the default rather than to an
  error, because the default always exists while a browser-capable daemon is running.
- The browser default requires the browser surface to be enabled (the same daemon config that
  gates `browser_*` tools; the pool's `headless` setting applies — default headless). With
  browsers disabled, `web_search` fails honestly with the env-based setup instructions (the
  current message), never a fabricated result.

### Browser backend mechanics

- Per-agent **search session**: extend the pool's session key from `agentId` to
  `(agentId, kind)` with `kind: 'interactive' | 'search'`, so search navigations never touch
  the agent's interactive tabs or active-index state while still carrying the session's
  cookies/reputation and the pool's isolation, reaper and shutdown guarantees. No cross-agent
  sharing; operator cookies appear only if the operator signed that profile in (existing pool
  property).
- One navigation per invocation: build the engine results URL from the bounded query, navigate
  (`domcontentloaded` + a short settle), extract results in-page, return them. No scrolling,
  pagination, link-following, form submission or CAPTCHA interaction. The engine page is
  **untrusted data**: the extractor only reads anchors/text; it never acts on page content.
- Engine allowlist (closed, no fuzzy resolution): `brave` (default), `bing`, and `google`
  (explicit opt-in; documented as IP-reputation-dependent — walls are reported, not fought).
  **No automatic fallback across engines** — a walled/failed engine surfaces as a tool error
  stating which engine failed and that the operator can switch explicitly. A wall
  (CAPTCHA/403/rate limit) is reported truthfully as a block, not as "no results".
- Bing URLs are decoded from the redirect wrapper (`u` parameter, optional `a1` base64 prefix)
  before returning; undecodable URLs are dropped, not passed through as `bing.com/ck/…` noise.
  The decoder is a pure, unit-tested function against recorded fixtures.
- Extraction selectors are per-engine constants (Brave: direct result anchors; Bing: `li.b_algo
  h2 a` + caption text). A selector miss yields the honest "no results found" or an explicit
  extraction failure — never fabricated rows. Recorded fixture HTML from the probe seeds the
  deterministic tests.

### Bounds (mirroring BAZ-067's shape)

- Query ≤ 512 chars; results 1–8 (default 5); title ≤ 200 chars; URL ≤ 2048; snippet ≤ 300.
- Deadline 20 s for the whole invocation (navigation + settle + extraction), combined with turn
  cancellation via `AbortSignal`. One navigation per invocation; no retry, no engine fallback,
  no second navigation on failure.
- Returned results are **untrusted data** — the tool description carries the same framing as
  the protected tool: verify before relying on them; fetching a URL still goes through the
  SSRF-guarded `web_fetch`; browsing a result in-browser stays the explicit `browser_*` tools.

### Posture boundaries (unchanged)

- Protected turns: the closed projection keeps **no browser**; BAZ-067's SearXNG host is
  untouched. If protected discovery ever needs a browser, that is a separate posture change —
  deliberately declined in BAZ-067.
- Restricted review/verification workers cannot call `web_search` (existing tool registration
  rules).
- No credential ever reaches the worker; no new secret exposure through IPC, transcripts,
  diagnostics or result metadata.
- No CAPTCHA/rate-limit circumvention: walls are reported, not solved. No paid-API default.

## Out of scope

- Protected turns (BAZ-067 unchanged); scraping result URLs in-browser; CAPTCHA/rate-limit
  circumvention (including advising a human pass-through — probed: it does not lift a
  Google `/sorry/` wall in an automation browser); any paid-API default; engine auto-fallback;
  image/video/news verticals; changing BAZ-067's implemented bounds or env contract.

## Tests

1. **Precedence:** with `BRAVE_API_KEY` set the Brave API path serves `web_search` and the
   browser is never launched; with only `SEARXNG_URL` the SearXNG path serves; with neither,
   the browser default serves; browser disabled + no env → the honest setup error. Drift
   between claim and dispatch (credential removed mid-turn) resolves at call time.
2. **Daemon ownership:** the worker tool no longer reads `BRAVE_API_KEY`/`SEARXNG_URL`; env
   values present only in the worker do not select a backend; no credential appears in IPC
   payloads, transcripts, diagnostics or result metadata.
3. **Browser extraction (deterministic):** against recorded engine fixture HTML served on
   loopback (`allowPrivate` test escape), both engines extract bounded title/URL/snippet rows;
   Bing wrappers decode to target URLs; undecodable wrappers drop; selector-miss returns honest
   emptiness; oversized fields truncate at the documented caps.
4. **Bounds/honesty:** query cap, count clamp, 20 s deadline under a stalled fixture, turn
   cancellation mid-navigation, one navigation per invocation (asserted via navigation count),
   wall responses (CAPTCHA text / 403 / 429) surface as explicit blocks naming the engine —
   never as "no results".
5. **Session hygiene:** a search navigation does not change the agent's interactive session
   tabs/active index; the search session obeys the reaper and agent-delete teardown; two agents'
   search sessions share nothing.
6. **Live reality-check (per-machine, recorded):** run the chosen engine config against the
   live engines once per release on the qualification machine and record the outcome in the
   acceptance file. Google's result is recorded as IP-reputation-dependent: on an unflagged
   network it serves results; on a flagged one it reports a block. Either outcome is a
   truthful record, not a failure — the wall report is the product behavior under test.

## Implementation notes

- `web.ts`: `braveSearch`/`searxngSearch` move to the daemon host (pure functions, reused);
  the worker `web_search` tool becomes the thin caller; `protectedWebSearchTool` unchanged.
- New `apps/daemon/src/lib/default-web-search.ts`: engine URL builders, closed allowlist,
  extractor, Bing decoder; pool.ts gains the session `kind` key extension.
- New turn-IPC RPC alongside BAZ-067's `webSearch` host, registered for ordinary turns only.
- Docs: configuration page (backends, precedence, engine knob, the Brave-API-vs-Brave-HTML
  naming note, Google wall reality), tool description, CHANGELOG.
