# bazilion

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Multi-agent runtime inspired by [OpenClaw](https://docs.openclaw.ai). Profiles are templates, agents are instances spawned from a profile into a single group (the collaboration context — one filesystem root, one USER.md, one roster, one shared memory), skills attach on the fly, and agents can talk to each other through a DB-backed mailbox.

Local-only. TypeScript + Node monorepo (pnpm + tsx + vitest). The web UI lives at `apps/web` (TanStack Start + React 19 + Tailwind v4 + shadcn/ui) and pairs with the standalone Hono daemon at `apps/daemon`. The CLI talks over HTTP, so keep `bazilion serve` running while you work in another terminal.

## Status

Whole-run subprocess isolation with worker↔daemon Node-IPC for messaging, ChatGPT OAuth, qmd memory (group-shared), scheduler/triggers, profile skills mode, and groups (one-to-one agent membership). The daemon is the **single owner of `~/.bazilion`** — config + secrets live in the SQLite DB, the only other file at the root is `auth.json` (the bootstrap bearer). See `docs/architecture.md` for the engineer-to-engineer reference.

## Quickstart

Requires **Node 24 or newer**.

```sh
# One-shot — npx downloads `bazilion` and runs the daemon.
npx bazilion serve

# Or install globally and re-use the binary.
npm install -g bazilion
bazilion serve
```

The daemon auto-bootstraps `~/.bazilion` on first run (creates dirs, runs migrations, mints the bootstrap token, writes `auth.json`) and prints the token before binding `127.0.0.1:4321`. Save it somewhere — the local CLI picks it up automatically from `~/.bazilion/auth.json`, but you'll need it to pair the web UI or remote clients.

The web UI is **not bundled into the npm package yet** — to run it today, clone the repo and start the Vite dev server alongside the daemon (see [Develop from source](#develop-from-source) below). For the CLI-only flow:

```sh
# Configure a provider — env var works, or persist via `bazilion config set`.
export ANTHROPIC_API_KEY=sk-ant-...
bazilion provider enable anthropic
bazilion provider models anthropic claude-sonnet-4-6

# Spawn an agent from the auto-created `default` profile.
bazilion agent spawn --profile default --name first
# → spawned agent <uuid> (first)

# Chat — interactive REPL or one-shot.
bazilion agent chat <uuid>
bazilion agent chat <uuid> --message "say hi"
```

If you'd rather use the web UI: open `http://127.0.0.1:4322` after starting the dev server. On a fresh install every page redirects to `/welcome` until you finish first-run setup: enable a provider on `/config` and list at least one model for it. The moment both conditions hold, a `default` profile + `default` group (at `~/.bazilion/groups/default/`) are auto-created wired to that model. The default profile uses `skillsMode: 'all'` so spawned agents inherit every installed skill out of the box.

Other provider env vars: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LMSTUDIO_URL`/`LMSTUDIO_API_KEY`, `OLLAMA_URL`, etc. You still need to enable the provider and list its models (via `bazilion provider enable|models` or the web UI) to clear the first-run gate.

## Develop from source

Contributors and anyone wanting the web UI today: clone the repo. Node 24+ and pnpm 10+.

```sh
git clone https://github.com/rullopat/bazilion
cd bazilion
pnpm install

# Start the daemon directly from source — no build step, tsx executes .ts.
pnpm tsx apps/cli/src/index.ts serve

# In another terminal, start the web UI (Vite dev server on 4322).
cd apps/web && pnpm dev
# → http://127.0.0.1:4322 — paste the bootstrap token to log in
```

From the source checkout, every CLI command is `pnpm tsx apps/cli/src/index.ts <cmd>` instead of `bazilion <cmd>`. Example: `pnpm tsx apps/cli/src/index.ts agent spawn --profile default --name first`. Build the distributable bundle with `pnpm build`.

## CLI commands

```
bazilion serve [--port N] [--host H]       # boot the daemon (auto-bootstraps on first run; HTTP API on 4321)
bazilion uninstall [--yes] [--all]         # wipe state (two-tier: data vs full)
bazilion doctor                            # diagnose your install
bazilion auth openai login|logout|status   # ChatGPT OAuth (Plus/Pro/Team accounts)
bazilion profile create|list|show|edit|update|delete   # manage profile templates
bazilion profile-group create|list|show|update|edit|delete|spawn   # reusable team templates (N agents in one transactional spawn)
bazilion group add|list|rm                 # register groups (always under ~/.bazilion/groups/<slug>/)
bazilion group user-md show|set|clear      # per-group USER.md (read-only to agents)
bazilion agent spawn|list|show|archive|unarchive|delete  # agent lifecycle
bazilion agent edit <id> [--model …] [--reasoning …]    # patch agent settings
bazilion agent chat <id> [--message X] [--image path] [--file path]  # REPL/one-shot; attach images (vision) or any file (reference)
bazilion agent cancel <id>                 # abort an in-flight turn
bazilion agent move <id> <group>           # move an agent to a different group
bazilion agent skill add|rm <id> <name>    # attach/detach a skill on an agent
bazilion agent chat-reset|chat-trim|chat-context|chat-compact <id>
bazilion skill list|import|rm              # skill library (import --from openclaw)
bazilion memory write|read|search|list|rm <agent>  # group-shared memory accessed via the agent
bazilion send <from> <to> <message>        # mailbox send
bazilion inbox list|show|read              # inspect agent inboxes
bazilion trigger add|list|rm|enable|disable  # heartbeats / cron triggers
bazilion mcp add|list|show|rm|enable|disable|test    # MCP servers (stdio / http / sse)
bazilion provider list|enable|disable|models|test    # provider config + smoke test
bazilion config get|set                    # service config (URLs, IDs, secrets)
bazilion login --server URL --token T      # save a remote daemon's coordinates
bazilion token create|list|revoke|show-local         # web tokens for API/CLI clients
bazilion backup create [output.tar.gz]     # tar ~/.bazilion to a file
bazilion backup restore <file.tar.gz>      # extract a backup (stop the daemon first)
bazilion completion bash|zsh|fish          # print a shell completion script
```

## Concepts

- **Profile** — a template (`SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, optional `BOOTSTRAP.md`, default model, skills mode + default skills). Profiles are agent classes. `skillsMode: 'all'` attaches every installed skill at spawn, `'selected'` uses the curated `defaultSkills` list. The auto-seeded `default` profile uses `'all'` so a fresh install ships with every skill wired up; user-created profiles default to `'selected'`. Delete `default` freely if you'd rather only keep your own.
- **Profile Group** — a reusable team template: an ordered list of *members*, each pointing at an existing profile with optional per-member overrides (agent name, model, reasoning level). One transactional `spawn` materializes the whole team into a target group — auto-creating the group if its slug doesn't exist yet, optionally seeding its USER.md, and auto-suffixing name collisions (`webby` → `webby-2` → `webby-3`). Pre-flight validates every referenced `profileId`; failures roll the whole batch back. Manage from `bazilion profile-group …` or `/profile-groups` in the web UI. Strictly additive — the single-profile spawn path is untouched.
- **Group** — a collaboration context: one filesystem root, one USER.md, one roster, one shared memory. Every agent belongs to exactly one group, chosen at spawn time. The agent's coding tools (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`, supplied by [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)) are rooted at the group directory. USER.md is read-only to agents — edit it via `bazilion group user-md set` or the web UI. First-run setup seeds a `default` group at `~/.bazilion/groups/default/`. Groups always live under `~/.bazilion/groups/<slug>/`; pass `--link <existing-path>` to `bazilion group add` to materialize the slot as a symlink to your existing project tree instead of as a fresh directory.
- **Agent** — an instance spawned from a profile into a group. Has a private home (`~/.bazilion/agents/<id>/` — its copy of the templates, plus pi's append-only session JSONL under `sessions/`) reachable via the `home_*` tools, and one group membership reachable via the coding tools. UUIDs as ids.
- **Skill** — a directory under `~/.bazilion/skills/<name>/` with a `SKILL.md` (standard OpenClaw / Anthropic agent-skill format). Imported via `bazilion skill import --from openclaw` (or any path). The body is injected into the system prompt of every agent the skill is attached to; helper scripts shipped alongside the markdown are invoked by the agent via its generic `bash` tool (no framework-level entrypoint and no trust gate — see CLAUDE.md for why we removed both).
- **Memory** — **group-shared** BM25 index rooted at `<groupPath>/memory/`. Every agent in the group reads + writes the same store. The current backend is `qmdBackend` (BM25 over markdown via [@tobilu/qmd](https://github.com/tobi/qmd)). Use it for project knowledge — codebase notes, decisions, things the user told you about the work; for personal notes about an agent (preferences, persona quirks), use `home_write` on `IDENTITY.md` instead.
- **Mailbox** — `messages` table. Agents talk to each other via `send_message` / `read_inbox` / `wait_for_reply` tools, via `bazilion send` from the CLI, or from outside the loop: `bazilion inbox list <agent> [--unread]`, `bazilion inbox show <id>`, `bazilion inbox read <id>`, or the web UI at `/agents/<id>/inbox`. The worker delegates these tool calls to the daemon over Node IPC — workers don't hold their own SQLite handle.
- **Trigger** — a heartbeat (interval in seconds) or cron expression that periodically wakes an agent with a stored message. An in-process scheduler ticks every 5 s (overridable via `BAZILION_SCHEDULER_TICK_MS`; disable with `BAZILION_SCHEDULER=off`) and fires due triggers through the same code path as user chat. Example: `bazilion trigger add <agent> --every 300 --message "check your inbox"`.
- **Browser automation** — agents get a `browser_*` tool suite backed by a persistent per-agent Playwright (Chromium) session that survives across turns. Perception is accessibility-tree-first (`browser_snapshot` → aria tree with `[ref=eN]` refs; no vision model needed); screenshots are a secondary tool rendered inline in chat. A network-layer SSRF guard blocks loopback/private targets by default. **One-time setup**: `pnpm exec playwright install chromium` (from `apps/daemon`, or wherever Playwright is installed). Toggle/tune on `/config` → Browser Automation.
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

The daemon's data layer (`apps/daemon/src/core/`: DB, repos, profile/agent/group ops, skills) and LLM/runtime stack (`apps/daemon/src/runtime/`: providers, tools, memory, worker subprocess) live inside the daemon — they're not separate packages.

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

After connecting, enable `openai-codex` on `/config` and curate at least one model (e.g. `gpt-5.1`, `gpt-5.1-codex-max`, `gpt-5.2-codex`, `gpt-5.3-codex`). Credentials are stored AES-256-GCM-encrypted in the daemon's `secrets` table (key derived from the bootstrap token in `auth.json`); the access token auto-refreshes via the stored refresh token.

## Uninstalling

```sh
# Interactive — asks two y/N prompts (data-tier, then full-wipe)
bazilion uninstall

# Non-interactive equivalents
bazilion uninstall --yes          # wipe DB + agent/profile/group data only
bazilion uninstall --yes --all    # also remove auth.json, logs/, skills/
```

Two tiers: the **data tier** (`bazilion.db*`, `profiles/`, `agents/`, `groups/`) is the factory-reset path — useful during alpha when the DB schema moves. The **full wipe** (`--all`) additionally removes `auth.json`, logs, and the skill library, leaving nothing behind under `~/.bazilion/`. Symlinked groups (registered via `--link`) only have their slot under `~/.bazilion/groups/` removed; the symlink target is never touched.

## Stack notes

- **SQLite driver**: `node:sqlite` (Node 22+ built-in). Wrapped in `apps/daemon/src/core/db/client.ts` with a manual `BEGIN/COMMIT/ROLLBACK` `transaction()` helper since `node:sqlite` has no callable wrapper of its own.
- **Daemon owns the DB**: workers spawned per turn don't hold their own SQLite handle. Anything they need at request time (agent record, provider gate, secrets) is pre-resolved by the daemon and passed via stdin; live messaging tool calls (`send_message` / `read_inbox` / `wait_for_reply`) round-trip back to the daemon over Node IPC (the `'ipc'` channel on `child_process.spawn`).
- **Native modules**: qmd pulls `better-sqlite3` and a handful of tree-sitter grammars (small native compiles on install). `node-llama-cpp` is a qmd transitive dep but intentionally excluded from build in `pnpm.onlyBuiltDependencies` — qmd's BM25 search doesn't need it, and enabling it would require downloading multi-GB GGUF models.
- **Skills format**: standard agent-skill `SKILL.md` (YAML frontmatter with `name` / `description`, free-form body). OpenClaw skills drop in unchanged via `bazilion skill import --from openclaw`.
- **Session loop + coding tools**: [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) owns the per-turn agent loop, transcript storage (JSONL session files under `~/.bazilion/agents/<id>/sessions/`), compaction, and the file-IO toolset (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`).
- **LLM providers**: routed through [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) — Anthropic, OpenAI, OpenAI Codex (ChatGPT OAuth), Google AI Studio, Google Vertex, Azure OpenAI, AWS Bedrock, Mistral, Groq, Cerebras, xAI, Z.AI, Hugging Face, OpenRouter, Vercel AI Gateway, LM Studio, Ollama. Model strings are `provider:model`.

## Exposing beyond loopback

By default, `bazilion serve` binds `127.0.0.1:4321` — local-only. To use bazilion from another machine (Tailscale, LAN, etc.), put a TLS-terminating reverse proxy in front. Don't expose the daemon directly; it has no TLS and no rate limiting.

```sh
# On the server, bind to loopback (default) and keep the proxy local.
bazilion serve

# Mint a per-client token (plaintext shown exactly once — copy it now).
bazilion token create "laptop"

# On the client machine — stores the server + token in ~/.bazilion/auth.json.
bazilion login --server https://bazilion.example.com --token <token>

# Revoke when the client is lost or retired.
bazilion token list
bazilion token revoke <id>
```

Note: the bootstrap token (the row labelled `bootstrap`, written to `auth.json` by the daemon's first-run bootstrap) **cannot be revoked** from the API or web UI — revoking it would lock the local CLI out of its own daemon. Mint additional tokens for any other client.

Minimal Caddyfile (`caddy run --config Caddyfile`):

```
bazilion.example.com {
  reverse_proxy 127.0.0.1:4321
}
```

Caddy handles the TLS cert via Let's Encrypt automatically. For Tailscale, point the hostname at your tailnet node and use Tailscale's MagicDNS + HTTPS certs. The `web_tokens` table + cookie check runs behind the proxy, so every request still needs a valid token — the proxy only adds transport security.

If you *do* want the daemon to bind a non-loopback address directly (dev/test only), pass `--host 0.0.0.0` to `bazilion serve`. Anyone who can reach that port can try tokens, so do not ship it without a proxy.

## What's deferred

- **Hard skill sandboxing** — skills run with the user's full FS access (no seccomp / bubblewrap / containers). Bazilion is single-user local; skills under `~/.bazilion/skills/` are user-owned by definition. Revisit if a marketplace or multi-user install ever happens.
- **qmd vector/hybrid search** — BM25 is wired; the semantic path (embeddings + LLM rerank) is disabled to avoid the multi-GB GGUF model download. Enable opt-in later.
- **Mempalace memory backend** — out of scope for v1.
- **`generate_image` / vision input** — the chat pane already renders markdown images, but agent-invokable image generation and user image uploads aren't wired.
- **Worker-side OAuth refresh** — long worker turns that exceed the openai-codex JWT lifetime fail on refresh. The daemon-side compact/context paths still get lazy refresh; only the worker subprocess relies on the initial token carrying the whole turn. See `apps/daemon/src/lib/api-key.ts`.
