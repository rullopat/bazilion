# Web research

Agents research the web with two tools:

- `web_search` finds sources. The daemon runs the search, so backend URLs and keys never reach
  the Agent.
- `web_fetch` reads a page: it fetches the URL (refusing private and loopback addresses, also after
  redirects), extracts the readable text as markdown and notes the final URL when a redirect
  happened. With `FIRECRAWL_API_KEY` set, a page whose text comes out nearly empty (a JavaScript
  shell) is fetched again through Firecrawl. Pages are cached for 15 minutes.

Search results are leads: the Agent reads the pages it cites with `web_fetch`. Every kind of turn
(chat, Telegram, follow-ups, schedules, inbox wakes) gets the same tools.
The managed browser is separate from search; see [managed browser](browser-research.md).

## Configure the search backend

`BAZILION_WEB_SEARCH_ROUTE` picks the backend (**Web search** on `/config/services`, or
`bazilion config set BAZILION_WEB_SEARCH_ROUTE <value>`):

| Value | Backend |
| --- | --- |
| `auto` (default) | Brave when `BRAVE_API_KEY` is set, else SearXNG when `SEARXNG_URL` is set, else `native`. |
| `brave` | The Brave Search API with `BRAVE_API_KEY` (**Brave Search** on `/config/services`). |
| `searxng` | Your SearXNG instance at `SEARXNG_URL`, with its JSON output enabled. |
| `native` | The search built into the Agent's own model: OpenAI models with `OPENAI_API_KEY`, or ChatGPT models with the ChatGPT login. It returns a written answer and the pages it cites. Other models get no `web_search`. |
| `off` | No `web_search` tool. |

The **Web search** card shows which backend is in use. A backend that is chosen but not
configured leaves Agents without `web_search`; nothing falls back to another backend.

## Limits

- A query has at most 512 characters; a search returns up to 10 results (default 5) and waits at
  most 30 seconds. Errors carry the backend's own status and message.
- Brave bills per query on its own plan; native search counts against the OpenAI account or the
  ChatGPT subscription.
- `web_fetch` reads at most 3 MiB of a page and returns at most 20,000 characters by default.
