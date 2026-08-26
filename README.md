# bazilion

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Multi-agent runtime built on [Pi's coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) as the core engine, with [OpenClaw](https://docs.openclaw.ai)-inspired skill compatibility around it. Pi owns the per-turn agent loop, transcript storage, compaction, provider execution, and coding tools; Bazilion wraps that engine with local-first orchestration: profiles, teams, skills, shared memory, a DB-backed mailbox, a daemon, CLI, and web UI.

Local-only. TypeScript + Node monorepo (pnpm + tsx + vitest). The web UI lives at `apps/web` (TanStack Start + React 19 + Tailwind v4 + shadcn/ui) and is bundled into the published CLI package. It pairs with the standalone Hono daemon at `apps/daemon`. The CLI talks over HTTP, so keep `bazilion dashboard` or `bazilion serve` running while you work in another terminal.

## Status

Whole-run subprocess isolation with worker↔daemon Node-IPC for messaging, ChatGPT OAuth, qmd memory (team-shared), scheduler/triggers, profile skills mode, and teams (one-to-one agent membership). The Pi agent engine remains the center of every chat turn; the daemon is the **single owner of `~/.bazilion`** — config + secrets live in the SQLite DB, the only other file at the root is `auth.json` (the bootstrap bearer). See `docs/architecture.md` for the engineer-to-engineer reference.

## Quickstart

Requires **Node 24 or newer**.

```sh
# One-shot — npx downloads `bazilion`, starts the daemon, and opens the web UI.
npx bazilion dashboard

# Or install globally and re-use the binary.
npm install -g bazilion
bazilion dashboard
```

`dashboard` starts the daemon on `127.0.0.1:4321`, starts the bundled web UI on `127.0.0.1:4322`, and opens the dashboard in your browser. The daemon auto-bootstraps `~/.bazilion` on first run (creates dirs, runs migrations, mints the bootstrap token, writes `auth.json`). Save the token somewhere — the local CLI picks it up automatically from `~/.bazilion/auth.json`, but you'll need it to log in to the web UI or pair remote clients.

> **Alpha database contract:** the schema is a clean-install-only `0001_init.sql`. Bazilion does
> not carry database, API, URL, or filesystem compatibility adapters yet. After a breaking schema
> change, export anything you need and run `bazilion uninstall --yes --all` before bootstrapping
> again.

For a daemon-only CLI flow:

```sh
bazilion serve
```

Then, in another terminal:

```sh
# Configure a provider — env var works, or persist via `bazilion config set`.
export ANTHROPIC_API_KEY=sk-ant-...
bazilion provider enable anthropic
bazilion provider models-set anthropic claude-opus-5

# Spawn an agent from the auto-created `default` profile.
bazilion agent spawn --profile default --name first
# → spawned agent <uuid> (first)

# Chat — interactive REPL or one-shot.
bazilion agent chat <uuid>
bazilion agent chat <uuid> --message "say hi"
```

In the web UI, open `http://127.0.0.1:4322` after running `bazilion dashboard`. On a fresh install every page redirects to `/welcome` until you finish first-run setup: enable a provider on `/config` and save at least one curated model for it. The moment both conditions hold, a `default` profile + `default` team (at `~/.bazilion/teams/default/`) are auto-created wired to that model. The default profile uses `skillsMode: 'all'` so spawned agents inherit every installed skill out of the box.

Other provider env vars: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LMSTUDIO_URL`/`LMSTUDIO_API_KEY`, `OLLAMA_URL`, etc. You still need to enable the provider and save its curated models (via `bazilion provider enable` + `bazilion provider models-set`, or the web UI) to clear the first-run gate.

## Develop from source

Contributors: clone the repo. Node 24+ and pnpm 10+ are required. If `corepack` is unavailable, install pnpm directly with `npm install -g pnpm`.

```sh
git clone https://github.com/rullopat/bazilion
cd bazilion
pnpm install

# Start the daemon directly from source — no build step, tsx executes .ts.
pnpm tsx apps/cli/src/index.ts serve

# In another terminal, start the web UI dev server on 4322.
cd apps/web && pnpm dev
# → http://127.0.0.1:4322 — paste the bootstrap token to log in
```

From the source checkout, every CLI command is `pnpm tsx apps/cli/src/index.ts <cmd>` instead of `bazilion <cmd>`. Example: `pnpm tsx apps/cli/src/index.ts agent spawn --profile default --name first`. Build the distributable bundle with `pnpm build`.

## CLI commands

```
bazilion dashboard [--port N] [--no-open]  # boot daemon + bundled web UI (4321 + 4322 by default)
bazilion serve [--port N] [--host H]       # boot daemon only (auto-bootstraps on first run; HTTP API on 4321)
bazilion uninstall [--yes] [--all]         # wipe state (two-tier: data vs full)
bazilion doctor                            # diagnose your install
bazilion auth openai login|logout|status   # ChatGPT OAuth (Plus/Pro/Team accounts)
bazilion profile create|list|show|edit|update|delete   # manage profile templates
bazilion team-template list|show|export|import        # reusable stable-slot Team Templates
bazilion team add|list|rm                 # register teams (always under ~/.bazilion/teams/<slug>/)
bazilion team user-md show|set|clear      # per-team USER.md (read-only to agents)
bazilion team policy show|export|import|diff|evaluate|blocks  # effective live policy
bazilion agent spawn|list|show|archive|unarchive|delete  # agent lifecycle
bazilion agent edit <id> [--model …] [--reasoning …]    # patch agent settings
bazilion agent chat <id> [--message X] [--image path] [--file path]  # REPL/one-shot; attach images (vision) or any file (reference)
bazilion agent cancel <id>                 # abort an in-flight turn
bazilion agent move <id> <team>           # move an agent to a different team
bazilion agent skill add|rm <id> <name>    # attach/detach a skill on an agent
bazilion agent chat-reset|chat-trim|chat-context|chat-compact <id>
bazilion skill list|import|rm              # skill library (import --from openclaw)
bazilion memory write|read|search|list|rm <team>   # Team-shared memory
bazilion send <from> <to> <message>        # mailbox send
bazilion inbox list|show|read              # inspect agent inboxes
bazilion inbox loop-breaks <agent>         # inspect stopped agent-message chains
bazilion trigger add|list|rm|enable|disable|history  # scheduled triggers + delivery diagnostics
bazilion mcp add|list|show|rm|enable|disable|test    # MCP servers (stdio / http / sse)
bazilion provider list|enable|disable|models|test    # provider config + smoke test
bazilion config list|set|rm                # service config (URLs, IDs, secrets)
bazilion login --server URL --token T      # save a remote daemon's coordinates
bazilion token create|list|revoke|show-local         # web tokens for API/CLI clients
bazilion backup create [output.tar.gz.age] --recipient age1…  # encrypted online backup
bazilion backup create [output.tar.gz] --plaintext            # explicit unsafe compatibility mode
bazilion backup restore <file> [--identity identity.txt]      # validate + restore atomically
bazilion backup inventory                  # credential names/counts, never credential values
bazilion backup rotate-bootstrap --yes     # offline local-token rotation and secret re-encryption
bazilion backup recovery-guide             # external-credential incident checklist
bazilion completion bash|zsh|fish          # print a shell completion script
```

`backup create` is safe while the daemon is active: it uses SQLite's online-backup API and omits
WAL/SHM files and rebuildable qmd indexes. Recipient mode streams the response through the standard
age envelope without writing a complete plaintext archive; plaintext output requires the explicit
`--plaintext` warning path. Generate and custody an age identity separately, pass only its public
`age1…` recipient to create, and provide the owner-only identity file to restore. Completed output is
installed atomically and never overwrites an existing file. Restore is offline: it authenticates and
decrypts into private staging, validates archive paths, links, the auth/DB pair, SQLite integrity, and
foreign keys, then rebases stored Profile and Agent directories before replacing the target home.
Restore and the daemon contend on one per-home ownership record outside the directory being swapped,
so a custom-port daemon or a daemon starting mid-restore cannot open the database.
If restore is interrupted between swap renames, the record stays fail-closed and reports the
retained recovery path. Contained relative links in ordinary work product are preserved; absolute
links are limited to canonical Team slot paths, whose external targets are not included in the archive.
The CLI rejects backup output paths inside `BAZILION_HOME` so a later backup cannot accidentally
nest prior archives. Ordinary profile, Agent, Team, skill, and session files are captured as the
archive walks them; only the SQLite snapshot is point-in-time consistent.

If a credential-bearing backup may have escaped, `backup inventory` reports only credential names
and active-token counts. With the daemon stopped, `backup rotate-bootstrap --yes` atomically replaces
the local bootstrap token, re-encrypts every stored secret, and revokes all other Bazilion web/mobile
tokens. It cannot revoke credentials already copied from the archive: follow `backup recovery-guide`
to regenerate Telegram, revoke and reconnect OpenAI, rotate provider/MCP credentials, and only then
create a fresh encrypted backup.

## Concepts

- **Profile** — a template (`SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `TOOLS.md`, optional `BOOTSTRAP.md`, default model, skills mode + default skills). Profiles are agent classes. `skillsMode: 'all'` attaches every installed skill at spawn, `'selected'` uses the curated `defaultSkills` list. The auto-seeded `default` profile uses `'all'` so a fresh install ships with every skill wired up; user-created profiles default to `'selected'`. Delete `default` freely if you'd rather only keep your own.
- **Team Template** — the only reusable Team roster. It owns revisioned stable slots and a directed communication policy; each slot references an Agent Profile and may override its name, model, or reasoning level. Spawning a reviewed revision materializes the roster atomically into a Team while retaining template/slot lineage. Manage it with `bazilion team-template …` or `/templates/teams`.
- **Reviewed learning** — opt-in, bounded background reviews turn completed conversations into evidence-backed lesson proposals. Nothing is applied automatically: approve private Agent lessons or shared Team-memory notes, and revoke either later. Configure and review with `bazilion agent review-config|review|reviews|lessons|lesson …` or the Agent's **Learning** tab.
- **Pi agent engine** — Bazilion is based on [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). Pi runs each turn, stores the canonical JSONL transcript under the agent's `sessions/` directory, handles replay and compaction, executes the provider/tool loop, and supplies the host coding tools when shell isolation is off. Bazilion contributes the multi-agent shell around that engine: profiles, teams, USER.md, memory, mailbox, scheduler, browser/MCP integrations, optional Docker shell isolation, and clients.
- **Team** — a live collaboration context: one filesystem root, one USER.md, one Agent roster, one shared memory, and exactly one effective revisioned communication policy. Every Agent belongs to exactly one Team. With shell isolation off, Pi's coding tools (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`) use the Team directory as their working directory; this is a default, not filesystem confinement. With Docker isolation on, only containerized `bash` remains and the Team directory is its sole writable bind mount. USER.md is read-only to Agents — edit it via `bazilion team user-md set` or the web UI. First-run setup seeds a `default` Team at `~/.bazilion/teams/default/`. Teams always live under `~/.bazilion/teams/<slug>/`; pass `--link <existing-path>` to `bazilion team add` to materialize the slot as a symlink to your existing project tree instead of as a fresh directory.
- **Agent** — an instance spawned from a profile into a team. Has a private home (`~/.bazilion/agents/<id>/` — its copy of the templates, plus pi's append-only session JSONL under `sessions/`) reachable via the `home_*` tools, and one team membership reachable via the coding tools. UUIDs as ids.
- **Skill** — a directory under `~/.bazilion/skills/<name>/` with a `SKILL.md` (standard OpenClaw / Anthropic agent-skill format). Imported via `bazilion skill import --from openclaw` (or any path). The body is injected into the system prompt of every agent the skill is attached to; helper scripts shipped alongside the markdown are invoked by the agent via its generic `bash` tool (no framework-level entrypoint and no trust gate — see AGENTS.md for why we removed both).
- **Memory** — **Team-shared** BM25 index rooted at `<team.path>/memory/`. Every Agent in the Team reads and writes the same store. The current backend is `qmdBackend` (BM25 over markdown via [@tobilu/qmd](https://github.com/tobi/qmd)). Use it for project knowledge—codebase notes, decisions, and work context; for personal Agent notes, use `home_write` on `IDENTITY.md` instead.
- **Mailbox** — `messages` table. Agents talk to each other via `send_message` / `read_inbox` / `wait_for_reply` tools, via `bazilion send` from the CLI, or from outside the loop: `bazilion inbox list <agent> [--unread]`, `bazilion inbox show <id>`, `bazilion inbox read <id>`, or the web UI at `/agents/<id>/inbox`. The worker delegates these tool calls to the daemon over Node IPC — workers don't hold their own SQLite handle.
- **Agent-loop circuit breaker** — every Agent message carries a durable causal chain id and hop count. Explicit replies inherit from `reply_to`; messages sent from an inbox wake inherit the highest-hop claimed message even if the Agent omits `reply_to`. The daemon rejects sends beyond `BAZILION_AGENT_LOOP_MAX_HOPS` (default 8) before another LLM turn can wake and records payload-free diagnostics visible in the Agent inbox, HTTP API, and `bazilion inbox loop-breaks`.
- **Trigger** — an interval in seconds or cron expression that periodically wakes an agent with a stored instruction. An in-process scheduler ticks every 5 s (overridable via `BAZILION_SCHEDULER_TICK_MS`; disable with `BAZILION_SCHEDULER=off`) and fires due triggers through the same code path as user chat. Example: `bazilion trigger add <agent> --every 300 --message "check your inbox"`.
- **Browser automation** — agents get a `browser_*` tool suite backed by a persistent per-agent Playwright (Chromium) session that survives across turns. Perception is accessibility-tree-first (`browser_snapshot` → aria tree with `[ref=eN]` refs; no vision model needed); screenshots are a secondary tool rendered inline in chat. A network-layer SSRF guard blocks loopback/private targets by default. The matching Chromium build is installed with Bazilion. Toggle/tune on `/config` → Browser Automation.
- **MCP** — connect the daemon to [Model Context Protocol](https://modelcontextprotocol.io) servers over stdio (local subprocess), Streamable-HTTP, or SSE. Each enabled server's tools are injected into every agent turn, namespaced `mcp__<server>__<tool>`. Manage from `bazilion mcp …` or `/config/mcp`. Example: `bazilion mcp add playwright --command npx --args "-y @playwright/mcp"`.
- **Images** — bidirectional on every client. Tool-produced images (browser screenshots, MCP image results) show as standalone deliverables: an image block in the web chat, a photo on Telegram. You can also send images *in*: attach/paste/drag in the web composer, send a photo to a bound Telegram topic, or `bazilion agent chat <id> --image <path>` — the model sees them via vision. (Audio/video are deferred — the model can't perceive non-image media yet.)
- **Documents** — bidirectional too, via store-and-reference (the model can't perceive raw files, so it gets a path and decides how to process). Attach any file in (web 📎/paste/**drag-and-drop**, `bazilion agent chat <id> --file <path>`, or a Telegram document) → saved under the agent's home, referenced by path for the agent to open with its tools. Agents send files back with the `deliver_file` tool → a download link on web, a document on Telegram, saved to disk on the CLI. 25 MB per file.

## Tree

```
bazilion/
├── docs/                         # engineer-to-engineer references
│   ├── architecture.md           # components, flows, invariants
│   └── agent-engine.md           # the LLM turn loop, end to end
├── apps/
│   ├── cli/                      # bazilion binary
│   ├── daemon/                   # Hono HTTP API (booted by `bazilion serve`)
│   ├── web/                      # TanStack Start UI (pairs with apps/daemon)
│   └── mobile/                   # Expo / React Native app (LAN/Tailscale pairing)
└── packages/
    ├── api-types/                # hermetic HTTP/IPC wire types (zero deps)
    └── client/                   # cross-origin HTTP client used by CLI + mobile
```

The daemon's data layer (`apps/daemon/src/core/`: DB, repos, profile/agent/team ops, skills) and LLM/runtime stack (`apps/daemon/src/runtime/`: providers, tools, memory, worker subprocess) live inside the daemon — they're not separate packages.

## Tests

```sh
pnpm test             # vitest across the whole tree
pnpm typecheck        # tsc --noEmit on the non-web tree
pnpm lint             # biome
pnpm format           # biome --write
```

## ChatGPT OAuth (use your ChatGPT Plus/Pro/Team account)

Bazilion has two OpenAI integrations. The classic one (`openai` provider) authenticates with an API key and hits `api.openai.com`. The second (`openai-codex` provider) signs in with your ChatGPT account via OAuth and talks to the ChatGPT backend that Codex CLI uses — so Plus/Pro/Team accounts can run chat turns against `gpt-5.x` / `gpt-5.x-codex` models inside Bazilion the same way they do in Codex.

```sh
# CLI: runs the browser flow locally (loopback on :1455), then uploads the
# resulting credentials to the server. Works even against a remote bazilion.
bazilion auth openai login
bazilion auth openai status        # connected? when does the access token expire?
bazilion auth openai logout        # wipe stored credentials

# Web UI: /config has a "Connect ChatGPT" card that does the same thing, but
# spawns the browser on the server's machine (fine when you're local; use the
# CLI from a remote client).
```

After connecting, enable `openai-codex` on `/config` and curate at least one model (e.g. `gpt-5.6-luna`, `gpt-5.6-terra`, or `gpt-5.6-sol`). Credentials are stored AES-256-GCM-encrypted in the daemon's `secrets` table (key derived from the bootstrap token in `auth.json`); the access token auto-refreshes via the stored refresh token.

## Uninstalling

```sh
# Interactive — asks two y/N prompts (data-tier, then full-wipe)
bazilion uninstall

# Non-interactive equivalents
bazilion uninstall --yes          # wipe DB + agent/profile/team data only
bazilion uninstall --yes --all    # also remove auth.json, logs/, skills/
```

Two tiers: the **data tier** (`bazilion.db*`, `profiles/`, `agents/`, `teams/`) is the factory-reset path — useful during alpha when the DB schema moves. The **full wipe** (`--all`) additionally removes `auth.json`, logs, and the skill library, leaving nothing behind under `~/.bazilion/`. Symlinked teams (registered via `--link`) only have their slot under `~/.bazilion/teams/` removed; the symlink target is never touched.

## Stack notes

- **SQLite driver**: `node:sqlite` (Node 22+ built-in). Wrapped in `apps/daemon/src/core/db/client.ts` with a manual `BEGIN/COMMIT/ROLLBACK` `transaction()` helper since `node:sqlite` has no callable wrapper of its own.
- **Daemon owns the DB**: workers spawned per turn don't hold their own SQLite handle. Anything they need at request time (agent record, provider gate, secrets) is pre-resolved by the daemon and passed via stdin; live messaging tool calls (`send_message` / `read_inbox` / `wait_for_reply`) round-trip back to the daemon over Node IPC (the `'ipc'` channel on `child_process.spawn`).
- **Native modules**: qmd pulls `better-sqlite3` and a handful of tree-sitter grammars (small native compiles on install). `node-llama-cpp` is a qmd transitive dep but intentionally excluded from build in `pnpm.onlyBuiltDependencies` — qmd's BM25 search doesn't need it, and enabling it would require downloading multi-GB GGUF models.
- **Skills format**: standard agent-skill `SKILL.md` (YAML frontmatter with `name` / `description`, free-form body). OpenClaw skills drop in unchanged via `bazilion skill import --from openclaw`.
- **Core agent engine**: [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) is the engine Bazilion is based on. It owns the per-turn agent loop, transcript storage (JSONL session files under `~/.bazilion/agents/<id>/sessions/`), replay, compaction, provider/tool execution, and the file-IO toolset (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`).
- **LLM providers**: routed through [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) — Anthropic, OpenAI, OpenAI Codex (ChatGPT OAuth), Google AI Studio/Vertex, Azure OpenAI, AWS Bedrock, GitHub Copilot, DeepSeek, Mistral, Groq, Cerebras, xAI, Z.AI, Hugging Face, Fireworks, Together, Moonshot/Kimi, MiniMax, Qwen Token Plan, Xiaomi MiMo, Ant Ling, NVIDIA NIM, OpenCode, OpenRouter, Vercel AI Gateway, Cloudflare, LM Studio, Ollama, and llama.cpp. Model strings are `provider:model`.

## Exposing beyond loopback

The supported private-server profile publishes only the web application through tailnet-only
Tailscale Serve HTTPS. The daemon and web listeners both remain on loopback; direct LAN, tailnet,
or public daemon exposure and Tailscale Funnel are unsupported.

```sh
# Supply this exact value to both daemon and web service environments.
export BAZILION_PUBLIC_ORIGIN=https://bazilion.example.ts.net
bazilion serve

# Publish only the loopback web listener and verify the complete posture.
tailscale serve --bg --https=443 http://127.0.0.1:4322
bazilion gateway preflight

# Mint a separate expiring credential for each client; plaintext is shown once.
bazilion token create laptop --expires-days 90 --qr

# Revoke a lost device and every browser session derived from it.
bazilion token list
bazilion token revoke <id>
bazilion session list
```

The local bootstrap token cannot expire or be revoked because it seeds secrets encryption, and
browser login rejects it. Device bearers are exchanged for hashed, bounded browser sessions with
session-bound CSRF protection. See [the private gateway guide](docs/private-gateway.md) for service
environment, verification, recovery, and remote CLI/mobile details.

## Agent shell security

Both controls are off by default. To require one-shot approval for commands classified as risky:

```sh
bazilion config set BAZILION_BASH_APPROVAL dangerous
bazilion doctor
```

Safe commands continue without interruption. Risky commands pause inline in browser chat or ask
on stdin in a TTY CLI chat; Allow applies to that tool call once. Denial, expiry, cancellation,
scheduled/inbox/Telegram turns, and non-TTY CLI callers all fail closed without executing the
command. This ephemeral shell gate is separate from durable Team Policy communication approvals.
Approval alone is a host-execution tripwire, not a filesystem sandbox.

To opt independently into a hard shell boundary, first make the configured image available
locally, then enable Docker mode:

```sh
docker pull debian:bookworm-slim
bazilion config set BAZILION_BASH_SANDBOX docker
bazilion doctor
```

The same settings are available on `/config` under **Agent Runtime → Agent Shell Security**.
`BAZILION_BASH_SANDBOX_IMAGE` selects another pre-pulled image (it must provide
`/bin/bash` and `/usr/bin/env` and must not declare Docker `VOLUME`s), and
`BAZILION_BASH_SANDBOX_ENV_ALLOWLIST` copies explicitly named variables into the container.

Each command gets a fresh container with no network, a read-only root, dropped capabilities,
the host uid/gid, and the Team directory mounted read/write at `/workspace`. Team memory,
uploaded documents, and attached skill assets are over-mounted read-only; recursive bind
propagation is disabled so nested host mounts are not inherited. Provider credentials and the
rest of the worker environment are absent unless explicitly allowlisted, and image-defined
environment variables are discarded before the requested command. Pi's host-backed
`read`/`edit`/`write`/`grep`/`find`/`ls` tools are hidden in this mode, because their absolute-path
support would otherwise bypass the container. Bazilion requires a local Unix-socket Docker
context, rejects images with implicit writable volumes, and never falls back to host execution.
The default image is intentionally small, so use a compatible prebuilt custom image when agents
need additional compilers or utilities.

## What's deferred

- **qmd vector/hybrid search** — BM25 is wired; the semantic path (embeddings + LLM rerank) is disabled to avoid the multi-GB GGUF model download. Enable opt-in later.
- **Mempalace memory backend** — out of scope for v1.
- **Agent-invokable image generation** — vision input and tool-produced images are wired, but Bazilion does not yet expose a `generate_image` tool.
