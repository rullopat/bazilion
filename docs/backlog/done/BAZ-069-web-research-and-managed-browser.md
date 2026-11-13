---
id: BAZ-069
title: Web research and the managed browser
status: done
created: 2026-09-21
shipped: 2026-10-21
release: v0.23.0
---

# BAZ-069 — Web research and the managed browser

## Outcome

An Agent can find current sources and read them without extra setup when it runs on an OpenAI or
ChatGPT model, and you can still choose Brave or your own SearXNG. Separately, every Agent has a
real browser with a persistent profile for pages that need JavaScript, logins or clicking.

## Scope

- `web_search` runs in the daemon, for every kind of turn, on the backend chosen by
  `BAZILION_WEB_SEARCH_ROUTE`: `auto` (Brave, else SearXNG, else native), `brave`, `searxng`,
  `native` (the hosted search of the Agent's OpenAI or ChatGPT model, which also returns a
  written answer) or `off`. A chosen backend that is not configured leaves Agents without the
  tool; nothing falls back.
- `web_fetch` reads pages as Markdown, refusing private and loopback addresses also after
  redirects; Firecrawl is an optional fallback for JavaScript-only pages.
- The owner's 2026-09-30 decision: provider search replaced the first plan of driving Google or
  Bing through the browser.
- Managed browser: the installed Chrome, Brave, Edge or Chromium, started by the daemon on the
  Agent's own profile and driven over the DevTools protocol through `browser_*` tools
  (accessibility snapshots with refs, clicks, typing, forms, tabs, screenshots). All traffic goes
  through the daemon's SSRF proxy; downloads are refused.

## As built

- Search settings: **Web search** on `/config/services`, `BRAVE_API_KEY`, `SEARXNG_URL`,
  `FIRECRAWL_API_KEY`; code `apps/daemon/src/lib/web-search.ts`.
- Browser settings: `BROWSER_ENABLED`, `BROWSER_EXECUTABLE_PATH`, `BROWSER_HEADLESS`,
  `BROWSER_ALLOW_PRIVATE_NETWORK`, `BROWSER_IDLE_MS`, `BROWSER_MAX_SESSIONS`; code
  `apps/daemon/src/lib/browser/`.
- Browser controls: `bazilion agent browser status|stop|reset <agent>`, the Agent page's
  **Managed browser** card, `GET /api/agents/:id/browser`, `POST /api/agents/:id/browser/stop`,
  `DELETE /api/agents/:id/browser/profile`.
- Profiles live in `browsers/<agent-id>/` and are left out of backups.
- Guides: [web research](../../web-research.md), [managed browser](../../browser-research.md).

## Known limits

- Sites may block the browser or show CAPTCHAs and logins; the Agent is told to stop and tell you.
- Native search bills the OpenAI account or the ChatGPT subscription; Brave bills per query.
