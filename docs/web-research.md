# Web research

Agents research the web with two tools, and posts on X with a third:

- `web_search` finds sources. The daemon runs the search, so backend URLs and keys never reach
  the Agent.
- `web_fetch` reads a page: it fetches the URL (refusing private and loopback addresses, also after
  redirects), extracts the readable text as markdown and notes the final URL when a redirect
  happened. With `FIRECRAWL_API_KEY` set, a page whose text comes out nearly empty (a JavaScript
  shell) is fetched again through Firecrawl. Pages are cached for 15 minutes. A page longer than
  `max_length` (20,000 characters by default) is saved whole with the Agent's uploads
  (`uploads/web/` in its folder, `/inputs/web/` in Docker), and the Agent gets the first part and
  the path, to read or grep the rest.
- `web_fetch` takes `headers` for an API that needs a key. One of the Agent's secrets written
  `{{secret:NAME}}` is filled in only over https and when the URL's host is one of that secret's
  hosts; a request
  with headers is not cached, and its headers are dropped on a redirect to another site
  ([secrets](questions.md#secrets-an-agent-asks-for)).

`web_search` takes filters: `freshness` (`day`, `week`, `month`, `year`) or `after`/`before`
(`YYYY-MM-DD`, which win over a freshness given with them), `sites` and `exclude_sites`, `country`
(two letters, `IT`) and `language` (two letters, `it`). Each backend applies the ones it supports,
and the result names the others so the Agent checks them itself:

| Backend | Applies |
| --- | --- |
| Brave | all of them (sites through `site:` in the query) |
| SearXNG | freshness, sites (through `site:`, for the engines that honour it), language |
| Tavily | all of them |
| Exa | all but language |
| native | sites and country |

The same search twice in one turn is answered from the first one.

`x_search` searches posts on X (Twitter) through xAI, while an xAI key is saved under
**Setup → Models**. The daemon makes the call with the key: Grok searches X, reads the posts and
answers from them, and the Agent gets that answer, the links of the posts it cites and how many
posts it read. It takes `handles` (only these accounts) or `exclude_handles`, and `from`/`to`
dates (`YYYY-MM-DD`; `to` is the first day left out). **Posts on X** on the **Web search** card
turns it off (`BAZILION_X_SEARCH=false`); its model is `grok-4.7` unless **X search model**
(`BAZILION_X_SEARCH_MODEL`) names another.

Search results are leads: the Agent reads the pages it cites with `web_fetch`. Every kind of turn
(chat, Telegram, follow-ups, schedules, inbox wakes) gets the same tools.
The managed browser is separate from search; see [managed browser](browser-research.md).

## Configure the search backend

`BAZILION_WEB_SEARCH_ROUTE` picks the backend: the **Web search** card under **Setup → Tools**
(`/config/tools`), or `bazilion config set BAZILION_WEB_SEARCH_ROUTE <value>`:

| Value | Backend |
| --- | --- |
| `auto` (default) | The first that is set up: Brave (`BRAVE_API_KEY`), SearXNG (`SEARXNG_URL`), Tavily (`TAVILY_API_KEY`), Exa (`EXA_API_KEY`), then `native`. |
| `brave` | The Brave Search API with `BRAVE_API_KEY` (the key field on the same card). |
| `searxng` | Your SearXNG instance at `SEARXNG_URL`, with its JSON output enabled. |
| `tavily` | The Tavily Search API with `TAVILY_API_KEY`. |
| `exa` | The Exa Search API with `EXA_API_KEY`; each result's snippet is its highlights. |
| `native` | The search built into the Agent's own model: OpenAI models with `OPENAI_API_KEY`, or ChatGPT models with the ChatGPT login. It returns a written answer and the pages it cites. Other models get no `web_search`. |
| `off` | No `web_search` tool. |

The **Web search** card shows which backend is in use. A backend that is chosen but not
configured leaves Agents without `web_search`; nothing falls back to another backend.

## Limits

- A query has at most 512 characters; a search returns up to 10 results (default 5) and waits at
  most 30 seconds. Errors carry the backend's own status and message.
- Brave, Tavily and Exa bill per query on their own plans; native search counts against the
  OpenAI account or the ChatGPT subscription. xAI bills X search by the posts it reads (and the
  model's tokens), on the xAI account.
- `x_search` has no deadline of its own: it ends when xAI answers or the turn is stopped.
- `web_fetch` reads at most 3 MiB of a page. Saved pages stay in the uploads folder until you
  remove them.
- Tavily takes a country by its English name; Bazilion turns the two letters into it, and a
  country Tavily does not list is refused with Tavily's own message.
