---
id: BAZ-087
title: "Search filters, long pages kept whole, a browser for checking web apps"
status: in_progress
created: 2026-11-27
release: v0.63.0
---

# BAZ-087 — Search filters, long pages kept whole, a browser for checking web apps

## Outcome

`web_search` took a query and a count, and a page longer than `max_chars` was cut. The browser
read and acted on pages but could not show their errors, wait for something, capture one element,
save a PDF or a download, or show a page as a phone or in dark mode. Now searches take filters and
two more backends, long pages are kept whole, and the browser has what checking a web app needs.
Taken from OpenClaw's `web_search`, `web_fetch` and `browser`.

## Scope

- **Search filters:** `freshness` or `after`/`before`, `sites`, `exclude_sites`, `country`,
  `language`; each backend applies what it supports and the result names the rest.
- **Tavily and Exa** on the Web search card, each with its key; **Automatic** tries them after
  Brave and SearXNG. A search repeated within one turn is answered from the first.
- **Long pages:** saved whole with the Agent's uploads (`/inputs/web/` in Docker); the Agent gets
  the first part and the path.
- **Browser:** `browser_errors`, `browser_text`, `browser_wait`, `browser_pdf`, `browser_emulate`,
  `browser_take_screenshot` with a `ref`, `browser_network` with a filter and failed requests, and
  downloads saved with the Agent's uploads.

## As built

- `lib/web-search.ts`: the filters are checked (a bad one is refused, not dropped) and mapped per
  backend: Brave's `freshness` range, `country` and `search_lang` with `site:` in the query;
  SearXNG's `time_range` and `language`; Tavily's `time_range`, dates, domains, country name and
  `filter_by_language`; Exa's published dates, domains and `userLocation`; the hosted search's
  `allowed_domains` and `user_location`. Results carry their published date when the backend
  gives one.
- `runtime/tools/web.ts`: `savePages` writes `uploads/web/<host-path>-<hash>.md`.
- `lib/browser/pool.ts`: errors from console errors and warnings and `weberror`; failed requests
  from `requestfailed`; `browser_wait` gets its own time on top of the hang guard; emulation
  through a DevTools session per tab; downloads saved by the pool, named in the next result.
  `launch.ts` no longer denies downloads in the Agent's own browser; your running Chrome still
  cancels them.

## Decided while building

- `browser_console` and `browser_network` already existed (the plan said otherwise): the network
  tool gained its filter and failures, and `browser_errors` is new.
- PDFs go with the Agent's uploads rather than the workspace, like downloads: a linked Team's
  workspace is your own project. Copy one into the workspace to deliver it.

## Limits

- SearXNG takes no dates or country; the model's own search takes no dates, exclusions or
  language. The result says so.
- `browser_pdf` needs a headless browser of the Agent's own.
