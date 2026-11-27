---
id: BAZ-087
title: "Search filters, long pages kept whole, a browser for checking web apps"
status: draft
created: 2026-11-27
release: v0.63.0
---

# BAZ-087 — Search filters, long pages kept whole, a browser for checking web apps

## Outcome

`web_search` takes a query and a count, so "news from this week" or "only the vendor's docs"
depends on the query's words. A page longer than `max_chars` is cut off. The browser can read
pages and act on them, but it cannot show a page's errors or requests, wait for something to
appear, capture one element, save a PDF or a download, or show the page as a phone or in dark
mode. An Agent checking a web app it built needs all of these. Taken from OpenClaw's
`web_search`, `web_fetch` and `browser`.

## Scope

- **Search filters:** `freshness` (day, week, month, year) or `after`/`before` dates, `sites`
  and `exclude_sites`, `country`, `language`. Each backend applies the filters it supports, and
  the result names the ones it could not apply.
- **Two more backends** on the Web search card: Tavily and Exa, each with its key. **Automatic**
  tries them after Brave and SearXNG.
- A search repeated within one turn reuses the first result instead of being sent again.
- **Long pages:** when the text is longer than `max_chars`, `web_fetch` saves the whole page with
  the Agent's uploads (`/inputs` in Docker) and returns the first part with the file's path.
- **Browser tools:**
  - `browser_errors`: console and page errors since the last read. `browser_network`: requests
    with method, status and URL, filtered by text. The pool already records both
    (`src/lib/browser/pool.ts`); no tool reads them yet.
  - `browser_text`: the readable text of the page or of one element, from the same extractor
    `web_fetch` uses (`src/runtime/tools/web-extract.ts`).
  - `browser_wait`: until a text or a ref appears, the URL changes, or the page settles. It
    waits as long as the Agent asks, and stopping the turn ends it.
  - `browser_take_screenshot` takes a `ref` to capture one element. `browser_pdf` saves the page
    as a PDF in the workspace.
  - Downloads are saved with the Agent's uploads, and the tool's result names the path.
  - `browser_emulate`: device size and touch, light or dark, locale, time zone.

## Where it goes

- `src/runtime/tools/web.ts`, `src/lib/web-search.ts`, `src/core/services.ts` (backends and
  keys), `src/lib/tools-overview.ts` (what the card says is in effect).
- `src/runtime/tools/browser.ts`, `src/lib/browser/pool.ts`.
- Guides: [web research](../../web-research.md), [managed browser](../../browser-research.md),
  [tools](../../tools.md).

## Limits and open questions

- SearXNG passes a time range only to the engines that take one. The model's own search has no
  date filter.
- `browser_pdf` needs a headless browser: neither a visible window nor your running Chrome can
  print to PDF.
- In your running Chrome, emulation applies only to the tab the Agent uses, and only while its
  connection to that tab lasts.
- Tavily and Exa are my pick, as research-oriented backends with content in their results. To
  confirm, or name others.
