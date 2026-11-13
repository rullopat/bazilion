# MCP servers

Tools from Model Context Protocol servers are offered to every Agent turn (chat, Telegram,
schedules and inbox) as `mcp__<server>__<tool>`. Servers are configured once for the whole
installation. The daemon runs the MCP client (Pi's `@earendil-works/pi-mcp`); workers call tools
through it and never connect to a server themselves.

## Configure

On the web: `/config/mcp`. From the CLI:

```sh
bazilion mcp add files --command npx --args "-y @modelcontextprotocol/server-filesystem /my/project"
bazilion mcp add docs --transport http --url https://mcp.example.com/mcp --token <bearer>
bazilion mcp list
bazilion mcp test <server-id>      # connect afresh and list the tools
bazilion mcp disable <server-id>   # or enable
bazilion mcp rm <server-id>
```

The HTTP API is `/api/mcp-servers[/:id[/test]]`. A server name may use letters, digits and `_`.

- **stdio** servers run as daemon child processes, each in its own process group. Their
  environment is the daemon's, with the provider keys and secrets configured on `/config`, but
  never Bazilion's own credentials (the ChatGPT sign-in, MCP bearer tokens, the Telegram bot token,
  the bootstrap or CLI token). They are trusted local programs.
- **http** servers use Streamable HTTP. The bearer token is stored encrypted and never shown
  again; redirects are refused so the token cannot follow one. A token given with `--token` can
  land in your shell history: use the web page when that matters.

## How connections behave

- A server is started on first use and shared by all turns; one that fails to start, or does not
  list its tools within 10 seconds, is skipped for that turn with a warning in the daemon log, and
  `bazilion mcp test` shows why.
- A connection unused for 15 minutes is closed, and so is one whose server is edited, disabled,
  removed or tested; the next use starts it again. A stdio server keeps the environment it was
  started with until then.
- A stdio server that exits is closed with the rest of its process group and started again on
  next use. An HTTP server that restarted and lost the session is reconnected on next use; the
  call that found the session gone fails once and is not replayed. A server that changes its tool
  list is listed again on the next turn.
- Disabling or removing a server stops running turns from calling it.
- A tool error is returned to the Agent with the server's own message; the connection stays open.
  Calls are never retried.
- If two servers produce the same tool name, the first server's tool is kept. Tool names that a
  model API would reject (other characters than letters, digits, `_` and `-`, or longer than 64
  characters with the prefix) are skipped with a warning.

## Limits

- 60 seconds per request. stdio messages and streamed (SSE) HTTP events are limited to 8 MiB each;
  a plain JSON HTTP response has no size limit.
- Tools only: no MCP resources, prompts, sampling or automatic OAuth sign-in.
- Closing a stdio server ends its process group; a descendant that moved to another session or
  process group is not tracked.
