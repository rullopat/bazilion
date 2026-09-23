---
'bazilion': minor
---

Bounded public-web discovery for protected Agent turns (BAZ-067). Scheduled and inbox turns previously
had `web_fetch` but no discovery: configuring a search backend did nothing there. A protected turn now
includes `web_search` when the operator configures `BAZILION_WEB_SEARCH_URL` (a self-hosted SearXNG
base URL, https or loopback). The backend URL stays daemon-side — the worker sees only bounded,
untrusted titles/URLs/snippets (max 8 results, capped fields), one request per invocation, no retry,
no fallback, and a hard deadline. Configuration is re-validated per request, so drift between claim
and dispatch is refused. Restricted review/verification workers never receive the capability, and
fetching a returned URL still goes through the SSRF-guarded `web_fetch`.
