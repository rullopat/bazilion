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

Until one provider is enabled with a saved model, every page leads to the setup page. Connect
ChatGPT or paste an API key on `/config`, enable the provider and pick a model; Bazilion then
creates a `default` Profile and a `default` Team, and you can spawn your first Agent from the
Agents page.

The same from a second terminal:

```sh
bazilion auth openai login                       # ChatGPT account, or an API key:
bazilion config set ANTHROPIC_API_KEY sk-ant-…   # stored encrypted (/config keeps it out of history)
bazilion provider enable anthropic
bazilion provider models-set anthropic claude-opus-5

bazilion agent spawn --profile default --name first
bazilion agent chat <agent-id> --message "say hi"
```

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
  [reviewed learning](docs/backlog/done/BAZ-003-reviewed-learning.md) (lessons you approve, on the
  Agent's **Learning** tab or with `bazilion agent review-config`), and **Attention** for what
  needs you.

## CLI

Most commands talk to the daemon over HTTP; `serve` and `dashboard` start it, and
`backup restore`, `uninstall`, `token show-local` and `completion` work without it. Run
`bazilion --help` for the list and `bazilion <command> --help` for options.

| Area | Commands |
| --- | --- |
| Setup | `serve`, `dashboard`, `doctor`, `backup`, `uninstall`, `completion` |
| Catalog | `profile`, `team`, `team-template`, `skill`, `provider`, `config`, `auth`, `mcp` |
| Agents | `agent`, `conversation`, `queue`, `question`, `result`, `memory`, `send`, `inbox`, `trigger`, `attention` |
| Integrations | `telegram`, `notification` |
| Remote | `login`, `token`, `session` |

`bazilion agent chat <id> --message "…"` runs one turn and streams it (also from piped stdin, with
`--image` and `--file` attachments); the web UI is the conversational client.

## Web UI

**Chat** (`/`), **Agents** (each with Chat, Inbox, Triggers, Learning and Settings tabs),
**Teams** (Context, Members, Policy, Memory, Review, Results), **Templates** (Agent and Team
templates), **Skills**, **Setup** (`/config`: providers, services, MCP, Telegram, tokens) and
**Attention**. The web UI and the CLI offer the same management features.

## Configuration

Settings are environment-variable-shaped keys. Set them on the `/config` pages or with
`bazilion config set <KEY> <value>` (secrets are stored encrypted, other values in plain text), or
in the daemon's own environment, which wins. The ones you are most likely to change:

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
(`--device-code` works headless or remote), or use **Connect ChatGPT** on `/config`. Then enable
`openai-codex` and save a model. Credentials are stored encrypted and refreshed by the daemon.

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
