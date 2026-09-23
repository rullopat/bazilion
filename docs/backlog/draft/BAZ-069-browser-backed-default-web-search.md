---
id: BAZ-069
title: Browser-backed web search by default for ordinary turns
status: draft
size: M
created: 2026-09-21
note: Operator decision 2026-09-21 — by default Bazilion should just work. Search rides the existing daemon browser pool (real Chromium fingerprint, the OpenClaw approach); SearXNG/Brave stay as explicit opt-ins. Target 0.23.0 (first implementation story of the next release; a withdrawn plan had made it a 0.22.0 prerequisite).
---

# BAZ-069 — Browser-backed default web search

## User stories

- As a user, I want my Agent to search the web out of the box — no API key, no self-hosted
  backend, no bot-block pages — so that discovery "just works" on first use.
- As an operator who wants stricter or cheaper discovery, I can still configure SearXNG
  (`BAZILION_WEB_SEARCH_URL`, protected turns) or a paid API instead; the default is the
  fallback for everyone else, not a locked-in choice.

## Context and decision

Discovered during the 0.22 review walk-through (2026-09-21): OpenClaw's search works by default
because it queries engines through a **real Chromium** — genuine TLS/HTTP-2 fingerprint, JS,
cookies. Bazilion's `web_fetch` is a plain Node `fetch` with a **spoofed Chrome UA**
(`apps/daemon/src/runtime/tools/web.ts`), which engines cross-check at the TLS (JA3/JA4) and
HTTP/2 layers and block as a bot. Bazilion already owns a daemon-side **browser pool**
(`apps/daemon/src/lib/browser/pool.ts`) proxied into ordinary turns as `browser_*` tools — the
missing piece is a search surface over it, not new infrastructure.

**Operator decision:** browser-backed search becomes the **default** for ordinary turns.
SearXNG-by-default was a mistake: defaults must work even when not optimal; SearXNG/Brave remain
explicit operator opt-ins. BAZ-067 stays as implemented but is **repositioned** — it is the
opt-in *protected-turn* discovery backend (protected workers keep their no-browser posture), not
Bazilion's default search story.

## Approach (to refine)

- New ordinary-turn `web_search` tool driving the existing browser pool: navigate to a search
  engine results URL built from the query, extract bounded results (title/URL/snippet), return
  them as **untrusted data** (same contract as BAZ-067's tool).
- Engine choice is a product decision: Google primary (matches the OpenClaw-experience the
  operator benchmarked); consider a secondary engine for resilience. The engine page is untrusted
  — the tool parses, it does not act on the page.
- Bounds mirror BAZ-067's shape: capped query length, capped result count and field sizes,
  deadline + cancellation, one navigation per invocation, no automatic retry/fallback across
  engines.
- **Fetching a result URL still goes through `web_fetch`** (SSRF-guarded). The browser does not
  follow arbitrary result links; its navigation is limited to the search surface. Browsing a
  result in-browser remains the explicit `browser_*` tools.
- Pool posture matters for detection: headless Chromium carries automation markers
  (`navigator.webdriver`, missing plugins) that engines also flag. Verify which pool
  configuration passes (headed vs headless, channel) before committing the default; the pool's
  own UA resolution (`pool.ts`) is already the honest one.
- Recorded migration intent (operator-confirmed 2026-09-21): the ordinary path's direct
  env-credential search (`BRAVE_API_KEY`/`SEARXNG_URL` read in-worker) should eventually move to
  the daemon-host pattern BAZ-067 uses; until then the asymmetry is accepted as no-regression.
- Respect existing pool guarantees: per-agent isolation, credential-minimal profiles, no operator
  cookies unless the operator explicitly signed a profile in.

## Explicitly out of scope

- Protected turns: the closed projection keeps **no browser**. If protected discovery ever needs
  a browser, that is a separate posture change (proxy-based egress control, cookie/origin policy,
  fresh security-acceptance pass) — deliberately declined in BAZ-067.
- Scraping result URLs in-browser; circumventing CAPTCHAs or rate limits; any paid-API default.
- Changing BAZ-067's implemented bounds or its env-config contract (0.22 review pending).

## Acceptance sketch (to refine)

- Fresh install, no search-related env: an ordinary turn's `web_search` returns real results;
  the transcript records the engine and the untrusted-data contract.
- With `BRAVE_API_KEY` or `SEARXNG_URL` set, the operator's configured backend wins (precedence
  to be pinned: explicit config > default).
- Bounds and failure honesty: malformed engine responses surface as tool errors, not fabricated
  results; no fallback engines silently swapping in mid-turn.
- Detection reality-check: run the chosen engine config under repeated queries; record where
  CAPTCHA/rate-limit walls appear and what the tool truthfully reports then.
