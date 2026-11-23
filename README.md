# bazilion

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Bazilion is a local multi-agent runtime for one person. Agents run on
[Pi's coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) with the LLM
provider of your choice (a ChatGPT login, an API key for OpenAI, Anthropic, Google and many
others, or a local LM Studio or Ollama), work in Teams that share a workspace, memory and a
mailbox, run on schedules, and are reachable from a web UI, a CLI and Telegram. One daemon on your
machine owns all state in `~/.bazilion`.

## Quickstart

Bazilion needs Node.js `^26.12.1`.

```sh
npm install -g bazilion         # or run each command below as `npx bazilion …`
bazilion dashboard
```

`dashboard` starts the daemon on `127.0.0.1:4321` and the web UI on `127.0.0.1:4322` and opens
your browser. On first start the daemon creates `~/.bazilion` (or `$BAZILION_HOME`) with its
database and a bootstrap token in `auth.json`. Sign in to the web UI with that token
(`bazilion token show-local` prints it); the CLI reads it by itself.

Until one provider works, every page leads to the first-run screen: choose a provider, sign in
with ChatGPT or paste an API key (or pick a model server running on this computer), and press
**Connect and test**. Bazilion asks the model for a short reply, then creates a `default` Profile
and a `default` Team, and **Start chatting** opens your first Agent.

The same from a second terminal:

```sh
bazilion provider connect anthropic       # asks for the key, tests it, switches it on
bazilion auth openai login && bazilion provider connect openai-codex    # or a ChatGPT plan

bazilion agent spawn --profile default --name first
bazilion agent chat <agent-id> --message "say hi"
```

See [models and providers](docs/models-and-providers.md).

`bazilion serve` starts only the daemon. Developed and run on Linux; macOS is untested; Windows
is not supported.

## Concepts

- **Profile**: an Agent template: `SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `TOOLS.md`, an optional
  first-run `BOOTSTRAP.md`, a default model and skills.
- **Agent**: spawned from a Profile into a Team. Its own documents and its conversation
  transcripts (Pi session files) live in `~/.bazilion/agents/<id>/`.
- **Team**: a workspace directory (or a link to an existing project), a USER.md about you, a
  shared memory and a [policy](docs/team-policy.md) for who may message whom. Every Agent belongs
  to one Team. **Team templates** spawn a whole Team at once.
- **Skill**: an OpenClaw-style `SKILL.md` whose text is added to the prompt of the Agents it is
  attached to; its scripts run through `bash`. Imported skills are scanned for suspicious text.
- **Memory**: Team-shared Markdown notes with BM25 search (qmd), through the `memory_*` tools.
- **Mailbox**: Agents message each other (`send_message`, `read_inbox`, `wait_for_reply`); an
  idle Agent with unread mail wakes up. A hop limit stops message loops.
- **Trigger**: an interval or cron schedule that wakes an Agent with a stored instruction.
- **Coding**: Agents run `bash` and file tools in the Team directory, on the host or in a Docker
  sandbox, guided by the repository's `AGENTS.md` files. See [coding](docs/coding-environments.md)
  and [change review](docs/change-review.md).
- **Tools**: web search and fetch, a managed browser per Agent, MCP servers, image generation,
  and `deliver_file` for [saved results](docs/results.md).
- **Around a chat**: [conversations](docs/conversations.md), a
  [follow-up queue](docs/follow-up-queue.md), [questions](docs/questions.md) the Agent asks you,
  [reviewed learning](docs/backlog/done/BAZ-003-reviewed-learning.md) (lessons you approve, under
  **Learning** in the Agent's side panel or with `bazilion agent review-config`), and
  **Attention** for what needs you.

## CLI

Most commands talk to the daemon over HTTP; `serve` and `dashboard` start it, and
`backup restore`, `uninstall`, `token show-local` and `completion` work without it. Run
`bazilion --help` for the list and `bazilion <command> --help` for options.

| Area | Commands |
| --- | --- |
| Setup | `serve`, `dashboard`, `doctor`, `backup`, `uninstall`, `completion` |
| Catalog | `profile`, `team`, `team-template`, `skill`, `provider`, `config`, `auth`, `mcp` |
| Agents | `agent`, `activity`, `usage`, `conversation`, `queue`, `question`, `result`, `memory`, `send`, `inbox`, `trigger`, `attention` |
| Integrations | `telegram`, `notification` |
| Remote | `login`, `token`, `session` |

`bazilion agent chat <id> --message "…"` runs one turn and streams it (also from piped stdin, with
`--image` and `--file` attachments); the web UI is the conversational client.

## Web UI

The home screen is one [workspace](docs/workspace.md): Teams and their Agents on the left, each
with what it is doing right now; the open Agent's conversation in the middle; and a side panel
with the Agent's settings, its Team, who may message whom (**Connections**), what changed in the
workspace (**Changes**) and what was delivered (**Files**). Connections, Changes and Files also
open across the whole width, as a map, a side-by-side diff and a gallery. With nothing open, an
overview says who is waiting for you, who is working, and what was delivered last. **Jump to**
(Ctrl+K, ⌘K on a Mac) opens any Agent, Team, conversation or page by name, waiting Agents first,
and runs the common actions; `?` lists the keyboard shortcuts.

The top bar has three places. **Attention** counts what needs you, an Agent's question or a
command to approve first. **Manage** holds the housekeeping pages, under one tab bar: Agents
(grouped by Team), Teams, Agent templates, Team templates and Skills ([manage](docs/manage.md)).
**Setup** (`/config`) is the configuration. Setup opens on **Models**: the chat models your Agents
think with, the image model they draw with, and the providers behind them, each with whether it
answers ([models and providers](docs/models-and-providers.md)). **Tools** holds web search, the
browser and how commands run, one card each ([tools](docs/tools.md)); the other tabs are MCP,
Telegram, Access (tokens and sessions) and System (health and backup). **Attention** lists what
needs you.
The web UI and the CLI offer the same management features.

## Configuration

Settings are environment-variable-shaped keys. Set them under **Setup** or with
`bazilion config set <KEY> <value>` (secrets are stored encrypted, other values in plain text), or
in the daemon's own environment, which wins. A value is checked before it is stored. The ones you
are most likely to change:

| Key | Default | |
| --- | --- | --- |
| `BAZILION_BASH_SANDBOX` | `off` | `docker` runs each `bash` command in a fresh network-less container ([coding](docs/coding-environments.md)) |
| `BAZILION_BASH_APPROVAL` | `off` | `dangerous` pauses flagged shell commands for approval in chat |
| `BAZILION_WEB_SEARCH_ROUTE` | `auto` | `brave`, `searxng`, `native` or `off` ([web research](docs/web-research.md)) |
| `BAZILION_IMAGE_MODEL` | `off` | the image model and account ([image generation](docs/image-generation.md)) |
| `BROWSER_ENABLED` | `true` | the managed browser ([browser](docs/browser-research.md)) |

Read only from the process environment: `BAZILION_HOME` (the home directory), `HOST` and `PORT`
(the daemon, `127.0.0.1:4321`), `BAZILION_PUBLIC_ORIGIN` (the [private gateway](docs/private-gateway.md)),
`BAZILION_SCHEDULER=off` (no triggers or inbox wakes) and, for a CLI talking to another daemon,
`BAZILION_SERVER` and `BAZILION_TOKEN`.

ChatGPT sign-in: `bazilion auth openai login` runs the browser flow on `localhost:1455`
(`--device-code` works headless or remote), then `bazilion provider connect openai-codex`; in the
web UI, choose ChatGPT under **Add a provider**. Credentials are stored encrypted and refreshed
by the daemon.

Telegram, MCP servers and remote access each have a guide: [Telegram](docs/telegram.md),
[MCP](docs/mcp.md), [private gateway](docs/private-gateway.md).

## Backup and reset

```sh
bazilion backup create --recipient age1…     # online backup, encrypted to an age key
bazilion backup restore <file> [--identity key.txt] [--force]    # with the daemon stopped
bazilion uninstall [--yes] [--all]           # reset the home; --all also removes skills
```

There are no database migrations: a release with a new schema refuses an old home. Back it up,
reset it and start again ([backup](docs/backup.md), [upgrades](docs/upgrades.md)).

## Development

```sh
git clone https://github.com/rullopat/bazilion && cd bazilion
mise install                                  # Node 26.12.1 and pnpm 12.15.0 from mise.toml
pnpm install
pnpm tsx apps/cli/src/index.ts serve          # the daemon from source, no build step
cd apps/web && pnpm dev                       # the web UI on http://127.0.0.1:4322
```

From a checkout every `bazilion <cmd>` is `pnpm tsx apps/cli/src/index.ts <cmd>`. Before a
change is done: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`; `pnpm test:docker`
runs the Docker sandbox tests (it needs Docker and a pulled `debian:bookworm-slim`). After
switching Node versions, run `pnpm rebuild better-sqlite3` (or `pnpm install --force`) so native
modules match.

The repository holds three apps (`apps/daemon`, `apps/cli`, `apps/web`) and two internal
packages (`packages/api-types`, `packages/client`); only the `bazilion` CLI package is published.
Start with the [documentation index](docs/README.md), [architecture](docs/architecture.md) and
[agent engine](docs/agent-engine.md); [AGENTS.md](AGENTS.md) has the conventions for coding agents.

## License

[MIT](LICENSE)
