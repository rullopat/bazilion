# MCP servers

Tools from Model Context Protocol servers are offered to every Agent turn (chat, Telegram,
schedules and inbox) as `mcp__<server>__<tool>`. Servers are configured once for the whole
installation. The daemon runs the MCP client (Pi's `@earendil-works/pi-mcp`); workers call tools
through it and never connect to a server themselves.

## Common connections

**Common connections** on `/config/mcp` (and `bazilion mcp presets`) lists four third-party
servers for the services a business Team works in. Each runs on this computer as a stdio server;
connecting one asks only for what it needs.

| Connection | Runs | Needs |
| --- | --- | --- |
| Microsoft 365 (Outlook mail and calendar, OneDrive, Excel; Teams and SharePoint with a work account) | `npx -y @softeria/ms-365-mcp-server` | Nothing to paste: ask an Agent to sign in, and its login tool gives a link and a code |
| Google Workspace (Gmail, Calendar, Drive, Docs, Sheets) | `uvx workspace-mcp --tool-tier core` | `uv`, and an OAuth client of your own from Google Cloud |
| Slack (channels, threads, search; posting when allowed) | `npx -y slack-mcp-server@latest --transport stdio` | A user token (`xoxp-…`) |
| Notion (pages and databases shared with it) | `npx -y @notionhq/notion-mcp-server` | An internal integration secret (`ntn_…`); Notion no longer maintains this server |

```sh
bazilion mcp presets
bazilion mcp add notion --preset notion --env NOTION_TOKEN=ntn_…
bazilion mcp add outlook --preset microsoft365 --option org
```

They are other people's programs: each one's own guide (linked from the page and from
`mcp presets`) is the reference for what it can do.

## Tools that ask first

A tool that sends or changes something outside asks you before each call, as a risky shell command
does: the conversation shows what it is about to do, with **Allow once** and **Deny**; after 30
seconds it is also in Telegram, and it is listed in Attention; a terminal chat asks on stdin. In a
turn nobody can answer there (one started from Telegram, a schedule, a teammate's message, a queued
follow-up) it is refused, so nothing goes out unseen, and the Agent is told to ask you in a
conversation. The daemon holds the call, so the Agent's MCP tool cannot skip it; an approval given
after the turn or its worker has ended sends nothing. This is separate from
`BAZILION_BASH_APPROVAL`, which only concerns shell commands.

By default a tool asks when its name says it sends, posts, replies, shares, creates, updates,
modifies, moves, renames, deletes, uploads, writes, adds or marks something (`send-mail`,
`conversations_add_message`, `API-patch-page`, `modify_sheet_values`); a search sent as a POST
(`API-post-search`) does not. The rule reads names only: a tool that changes something under a
name like `get-…` or `run-…` is not caught, so look at the list after **Test**. There, tick or
untick single tools: your choices are kept, and every other tool, one the server adds later too,
still follows the rule. **Back to the default** forgets your choices. From the CLI:
`bazilion mcp set <server-id> --ask run-query --skip mark_as_read`, or `--ask default`.

## Configure

On the web: `/config/mcp`. From the CLI:

```sh
bazilion mcp add files --command npx --args "-y @modelcontextprotocol/server-filesystem /my/project"
bazilion mcp add docs --transport http --url https://mcp.example.com/mcp --token <bearer>
bazilion mcp add notes --command npx --args "-y some-server" --env SOME_TOKEN=…   # its own variable
bazilion mcp set <server-id> --env SOME_TOKEN=… --unset-env OLD_NAME
bazilion mcp list
bazilion mcp test <server-id>      # connect afresh and list the tools
bazilion mcp disable <server-id>   # or enable
bazilion mcp rm <server-id>
```

The HTTP API is `/api/mcp-servers[/:id[/test]]`. A server name may use letters, digits and `_`.

- **stdio** servers run as daemon child processes, each in its own process group. Their
  environment is the daemon's, with the provider keys and secrets configured on `/config`, but
  never Bazilion's own credentials (the ChatGPT sign-in, MCP bearer tokens, the Telegram bot token,
  the bootstrap or CLI token), plus the server's own variables. Those (a token, a client id) are
  stored encrypted, shown by name only (**Variables** on the server's row changes them), and put in
  that server's environment alone, never in another server's or an Agent's. With host execution
  an Agent's shell still runs as your user and can read what your user can, other processes'
  environments included; the Docker sandbox ([coding environments](coding-environments.md)) keeps
  it out. They are trusted local programs. An http server takes a bearer token, not variables.
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
- Tools only: no MCP resources, prompts, sampling or automatic OAuth sign-in, so a server whose
  only sign-in is a browser OAuth flow on a remote endpoint (Notion's remote server) cannot be
  connected.
- Closing a stdio server ends its process group; a descendant that moved to another session or
  process group is not tracked.
