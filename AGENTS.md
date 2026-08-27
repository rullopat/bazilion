# AGENTS.md

This is the canonical cross-platform guidance for AI coding agents working in this repository.
Codex reads it directly; Claude Code imports it from `CLAUDE.md`.

## Dev commands

Node 24+ is required (for built-in `node:sqlite` and the TypeScript ecosystem). pnpm 10+
is the package manager. Everything runs via `tsx`, pinned as a root dev-dependency.

```sh
pnpm install
pnpm test              # vitest run across the whole tree
pnpm security:acceptance # deterministic 0.13 adversarial security release gate
pnpm typecheck         # tsc --noEmit (excludes apps/web — see below)
pnpm lint              # biome check
pnpm format            # biome check --write
```

Running a single test: `pnpm vitest run apps/daemon/test/core/agents.test.ts` (or `pnpm vitest -t 'pattern'`).

Running the CLI locally (no build step — `tsx` executes `.ts` directly):

```sh
pnpm tsx apps/cli/src/index.ts <subcommand>
# e.g. pnpm tsx apps/cli/src/index.ts agent chat <uuid>
#      pnpm tsx apps/cli/src/index.ts serve        # boots the daemon (web UI runs separately)
```

`README.md` has the full user-facing quickstart (`bazilion serve` auto-bootstraps `~/.bazilion` on first run → start the web UI on :4322 → finish first-run setup on /config → spawn from the auto-seeded `default` profile).

## Architecture

pnpm workspaces monorepo. **Four apps** (cli, daemon, web, mobile), **two packages** (api-types, client).

The **daemon** (`apps/daemon`) is the single owner of `~/.bazilion` AND the LLM/tool stack. It's also the only place server-side code lives — there's no `@bazilion/core` or `@bazilion/runtime` package; that code is internal to the daemon under `apps/daemon/src/core/` (DB schema, repos, domain ops, paths, secrets, services, skills) and `apps/daemon/src/runtime/` (pi adapter, providers, memory, tools, worker, sessions). Every other process — CLI, web frontend SSR, mobile app, future browser SPA — talks to the daemon over HTTP. **Workers spawned per turn don't hold their own DB handle either** — they receive pre-resolved data on stdin and round-trip live messaging back to the daemon over Node IPC.

Three invariants:

1. **Nothing outside `apps/daemon` imports daemon-internal code at runtime.** Clients talk to the daemon over HTTP via `@bazilion/client` + `@bazilion/api-types`. The CLI's tests are the one pragmatic exception: they reach into `apps/daemon/src/...` via relative imports for setup/inspection. No other consumer should follow that pattern.
2. **The daemon owns the DB, scheduler, agent-cancel registry, secrets table, and the bootstrap token in auth.json.** Other processes are stateless clients.
3. **The daemon self-bootstraps on first `bazilion serve`** — there is no `bazilion init` command. `apps/daemon/src/lib/ctx.ts:bootstrap()` runs idempotently at startup: creates `~/.bazilion/{profiles,agents,skills,teams,logs}`, opens the DB, runs migrations, and (if `auth.json` is missing) mints a bootstrap web_tokens row + writes the plaintext to `auth.json`.

- **`packages/api-types`** — **hermetic** wire-shape package. Owns the canonical type definitions for everything that crosses the HTTP/IPC wire: entity shapes (`Agent`, `Team`, `Profile`, `Message`, `WebToken`, `AgentTrigger`, `ResolvedAgent`, `LoadedProfile`, `OpenAICodexStatus`, …) in `entities.ts`, chat/provider events (`ChatFrame`, `SessionEvent`, `ProviderMessage`, `ToolCall`, `ToolDef`) in `events.ts`, memory wire types in `memory.ts`, and request/response envelopes + `PROFILE_FILES` in `index.ts`. **Zero deps** — no node-only modules, no daemon code. The daemon imports its entity/wire types FROM here; that's what keeps `apps/web`, `apps/mobile`, and `@bazilion/client` from ever reaching Node-only code (`node:sqlite`, undici, pi-ai, the worker spawner).
- **`packages/client`** — HTTP client for cross-origin native consumers that need explicit device bearer auth. The web UI remains same-origin and uses daemon-owned session/CSRF cookies instead.

### Auth model

The daemon owns `web_tokens` and `web_sessions`. Native clients use active bootstrap/device bearers; browser login accepts device credentials only and exchanges them for a hashed bounded session plus session-bound CSRF. Public paths are exactly `/api/login` and minimal `/api/health`; detailed health and owner identity are protected.

The bootstrap token is the plaintext stored in `~/.bazilion/auth.json` — written there by the daemon's self-bootstrap on first `bazilion serve` (`apps/daemon/src/lib/ctx.ts:bootstrap()`) alongside its hash inserted into `web_tokens` (label `bootstrap`). Both the CLI (loopback bearer) and the daemon (PBKDF2 seed for the secrets table) read this file. **Do not allow revoking the bootstrap row**: `DELETE /api/tokens/:id` rejects (409) when the requested id matches the auth-token's hash, and the web UI hides the revoke button for that row. Otherwise the operator could lock themselves out.

**SSR cookie-forward**: server fns inside `apps/web/src/lib/daemon-client.ts` forward the session and CSRF cookies unchanged to the loopback daemon. They never convert browser sessions into bearer credentials. Native clients send device bearers via `@bazilion/client`.

### Mobile / LAN notes

The daemon and web application remain loopback-only. `BAZILION_PUBLIC_ORIGIN` activates the strict production gateway profile; Tailscale Serve publishes only the web listener over private HTTPS. QR pairing uses that exact origin and a separately minted expiring device credential. Funnel and direct daemon exposure are unsupported.

### apps/mobile

Expo SDK 54 + Expo Router 6 (file-based), React 19, RN 0.81, new-architecture-enabled. URL scheme `bazilion://` for deep-link pairing. Structure:
- `app/` — file-based routes. `_layout.tsx` wraps the stack; `index.tsx` is the auth gate (loads credentials from `expo-secure-store`, redirects to `/pair` or `/agents`); `pair.tsx` is the camera+manual-paste pairing flow; `agents/index.tsx` is a FlatList of agents (pull-to-refresh, 401→/pair auto-unpair, header-level unpair button); `agents/[id].tsx` is an agent detail stub where chat will land next.
- `src/pair-url.ts` — pure TS parser for `bazilion://pair?server=…&token=…`. RN-free, unit-tested by root vitest (`apps/mobile/test/pair-url.test.ts`).
- `src/auth.ts` — `expo-secure-store` wrapper (`loadCredentials` / `saveCredentials` / `clearCredentials` / `verifyCredentials`) and a `clientFor(creds)` factory returning `@bazilion/client`'s `BazilionClient`.
- `metro.config.js` — sets `watchFolders`/`nodeModulesPaths` so Metro resolves workspace packages through pnpm's symlink layout.
- Excluded from root `tsconfig.json`, `biome.json`. Run `pnpm --filter @bazilion/mobile typecheck` for mobile-only TS checks. Run `pnpm --filter @bazilion/mobile start` for the Expo dev server.
- `@bazilion/api-types` is hermetic — entity types and wire shapes are defined inline (`entities.ts`, `events.ts`, `memory.ts`); it has no dep on the daemon. That's what keeps mobile's TS checker out of Node-only code. Metro itself never sees these imports at runtime (babel's TS transform strips `import type` / `export type`) — but do not add a *value* import from `@bazilion/daemon` (or any daemon-internal path) to the mobile tree, or the bundle will explode.

- **`apps/cli`** — thin citty-based CLI. Every subcommand except `serve` talks to the daemon over HTTP via `@bazilion/client`. No direct DB access in the CLI's runtime path. The two filesystem-level commands are: `serve` (boots `apps/daemon` directly — the daemon then auto-bootstraps `~/.bazilion`); `uninstall` (two-tier teardown: data wipe vs. full — operates on the filesystem so it works even when the daemon isn't running). Local helpers `apps/cli/src/paths.ts` (`resolveCliPaths`) and `apps/cli/src/auth-file.ts` (`readAuthFile` + `AuthFile` type) duplicate just enough of the daemon's path/auth utilities for these filesystem-touching commands. The web UI runs separately during dev: `cd apps/web && pnpm dev`. Remote daemon is opt-in via `BAZILION_SERVER` + `BAZILION_TOKEN` env vars; otherwise the client reads `auth.json` and hits `http://127.0.0.1:4321`.

- **`apps/daemon`** — Hono on `@hono/node-server`, binds `127.0.0.1:4321` by default (`HOST`/`PORT` env override). Owns all server-side code under one roof:
  - `src/index.ts` — entry: eagerly calls `getCtx()` so the bootstrap message + auth.json land before the port binds, then starts Hono.
  - `src/lib/` — daemon-only glue: `ctx.ts` (singleton + self-bootstrap), `middleware-auth.ts`, `auth.ts`, `agent-cancel.ts`, `agent-id.ts`, `agent-turn.ts`, `api-key.ts`, `cron.ts`, `messaging-host.ts`, `scheduler.ts`.
  - `src/routes/` — HTTP routes by resource family: `agents.ts` (CRUD + team + skills + triggers + messages + sessions + chat NDJSON + `/cancel`), `teams.ts` (CRUD + USER.md + per-team shared memory at `/api/teams/:slug/memory*`), `profiles.ts`, `skills.ts`, `triggers.ts`, `messages.ts`, `config.ts`, `auth-login.ts` (ChatGPT OAuth + `/providers/test` + `/login`), `misc.ts` (`/health`, `/backup`, `/tokens`).
  - `src/core/` — what used to be `packages/core`: SQLite schema + migrations (`db/`), repos (`repos/`), domain ops (`agent/`, `team/`, `profile/`, `skills/`), `paths.ts`, `secrets.ts`, `services.ts`, `availableModels.ts`. Barrel export at `src/core/index.ts`.
  - `src/runtime/` — what used to be `packages/runtime`: pi-coding-agent integration (`pi/`), provider adapters (`providers/`), memory backends (`memory/`), Bazilion-specific tools (`tools/`), per-turn worker subprocess (`worker/{entry,spawn,ipc-protocol}.ts`), OpenAI Codex OAuth (`auth/`). Barrel export at `src/runtime/index.ts`.
  - Auth + first-run middleware (`src/lib/middleware-auth.ts`) gates every route; public paths whitelisted inside the middleware. The daemon installs its own SIGINT/SIGTERM handlers and shuts the HTTP server gracefully.
- **`apps/web`** — TanStack Start frontend and the only supported remote gateway. SSR and browser requests forward bounded session/CSRF cookies to the loopback daemon through a hardened same-origin proxy. **CLI/web parity is mandatory** for management endpoints.

### SQLite driver

`apps/daemon/src/core/db/client.ts` uses `node:sqlite` (Node 22+ built-in). `node:sqlite` has no callable `transaction()` wrapper, so the wrapper implements manual `BEGIN/COMMIT/ROLLBACK` in its `transaction()` method. Don't look for a `bun:sqlite` fallback — the project is Node-only.

### On-disk layout

State lives in `~/.bazilion/` (overridable via `$BAZILION_HOME`):

```
~/.bazilion/
  bazilion.db                  # ALL DB state: entities + secrets + config (encrypted) + tokens
  auth.json                    # {token, remote?} — bootstrap bearer + optional CLI remote target
  teams/<slug>/               # collaboration root, mounted as cwd; may be a symlink (--link)
    memory/                    # team-shared qmd index (.qmd-index.sqlite + markdown notes)
    ... project files / work product ...
  agents/<id>/                 # agent's PRIVATE home — strictly outside the team tree
    SOUL.md / IDENTITY.md / AGENTS.md / TOOLS.md / [BOOTSTRAP.md]
    sessions/<sessionId>.jsonl # pi's append-only transcript
    agent.json
  profiles/<id>/               # profile templates
  skills/<name>/SKILL.md       # installed skills
  logs/
```

Path resolution is centralized in `apps/daemon/src/core/paths.ts`. The `Paths` struct has `home`, `db`, `authFile`, `profilesDir`, `agentsDir`, `teamsDir`, `skillsDir`, `logsDir`, plus `agentDir(id)` / `teamDir(slug)` / `profileDir(id)` / `skillDir(name)` computed helpers. The CLI has its own minimal `apps/cli/src/paths.ts` (`resolveCliPaths` returns just `{home, authFile}`) for the filesystem-level commands (`uninstall`, `backup`, `login`, `token show-local`) — they don't need the full struct. **There is no longer a `configFile` field — `config.json` and `secrets.enc` were collapsed into the DB.** `bazilion uninstall` mirrors this layout as a two-tier teardown: data tier = DB + `profiles/` + `agents/` + `teams/`; full wipe adds `auth.json`, `logs/`, `skills/`. Symlinked teams (registered with `--link`) only have the slot under `~/.bazilion/teams/` removed; the symlink target is never touched.

### Team registration

Teams always live at `~/.bazilion/teams/<slug>/`. The CLI (`bazilion team add <slug> [--link <target>]`) and the web `/teams` create form pass only the slug + optional name + optional link target; the daemon decides where the slot goes. `--link <abs-path>` materializes the slot as a symlink to an existing directory (the "agents working on my existing project tree" path); the target must exist and be a directory. Without `--link`, a fresh real directory is created. `teamRepo.get/list/insert(db, ..., paths)` derive `Team.path` from `paths.teamDir(id)` at read time — there is no `path` column anymore.

### Memory model

Memory is **per-team**, shared across every agent in the team. The qmd backend lives at `<team.path>/memory/`; each turn's worker calls `qmdBackend(join(agent.team.path, 'memory'))`. The `memory_*` tool descriptions explicitly tell the LLM the store is shared and direct personal notes (persona quirks, preferences) to `home_write IDENTITY.md` instead. The schema's per-agent memory dir is gone — `spawnAgent` only creates `agents/<id>/sessions/`. External surfaces match the ownership: HTTP at `/api/teams/:slug/memory*`, web UI at `/teams/:slug/memory`, CLI at `bazilion memory <write|read|list|search|rm> <team-slug> ...`. There are no `/api/agents/:id/memory*` routes — clients always address the team.

### Worker subprocess + IPC

Every chat turn runs in its own Node subprocess (`apps/daemon/src/runtime/worker/{entry,spawn,ipc-protocol}.ts`). The daemon's `apps/daemon/src/lib/agent-turn.ts:runAgentTurn`:
1. Resolves the agent + provider gate + merged secrets env in-process (the worker no longer holds a SQLite handle).
2. Pre-fetches the OAuth access token for `openai-codex` agents via `apps/daemon/src/lib/api-key.ts:resolveAgentApiKey` (env-key providers return `{}`).
3. Spawns the worker with `stdio: ['pipe', 'pipe', 'inherit', 'ipc']` — the IPC channel is what makes messaging tools work without a worker DB handle.
4. Sends `{agent, message, enabledProviders, apiKey?}` on stdin.
5. Line-parses NDJSON `ChatFrame`s from worker stdout and yields them.
6. Services worker `process.send({type:'rpc', method, args, id})` calls (daemon-owned tools, shell approval, and OAuth refresh) by dispatching to turn-scoped hosts and replying with `child.send({type:'rpc-reply', id, ok, result|error})`.

`SessionEvent` types: `user_message` / `assistant_message` / `assistant_delta` / `tool_call` / `tool_result` / `tool_error` / `error`. `ChatFrame` shapes: `{kind:'event', event}` / `{kind:'done', messages}` / `{kind:'fatal', error}`. **There is no `runId`, no `runs` table, no `events` table** — those were dropped along with the per-run audit metadata layer; pi's session JSONL files are the canonical transcript and the only persistent record of what an agent has said.

Cancellation: keyed by **agentId** (not runId). The daemon's `apps/daemon/src/lib/agent-cancel.ts` registers an `AbortController` per active agent on each `runAgentTurn` start; `POST /api/agents/:id/cancel` aborts the controller, which SIGTERMs the worker (3 s grace → SIGKILL); the child's own SIGTERM handler aborts its internal controller so pi unwinds the provider fetch and emits an `error` event with `error: 'cancelled'` before exiting. CLI: `bazilion agent cancel <id>`. The worker also calls `process.disconnect()` in its `finally` so the IPC channel doesn't pin the event loop alive after the turn settles.

See `docs/agent-engine.md` for the full turn-loop walkthrough.

### Providers

Model strings are `provider:model` (e.g. `lmstudio:my-loaded-model`, `anthropic:claude-opus-5`, `google:gemini-3.6-flash`, `openai-codex:gpt-5.6-sol`, `qwen-token-plan-individual:qwen3.8-max`). `createProviderRegistry` + `loadProviderConfigFromEnv` in `apps/daemon/src/runtime/providers/registry.ts` resolve strings to `{ provider, model }`. Credentials come from env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `QWEN_TOKEN_PLAN_API_KEY`, `BASETEN_API_KEY`, `LMSTUDIO_URL`/`LMSTUDIO_API_KEY`, `OLLAMA_URL`); plain API-key providers never touch the DB. The daemon's `mergeSecretsIntoEnv(db, authToken)` layers DB-stored secrets + plaintext config over `process.env` — this happens **server-side** per API request (chat, provider test, health) and again per worker spawn (the merged env is passed via `child_process.spawn`'s `env` option).

**`openai-codex`** is the OAuth exception: credentials live as a JSON `{refresh, access, expires}` blob under the `OPENAI_CODEX_OAUTH` row of the `secrets` table. The provider registry's `apiKey` field is invoked as an async supplier so refreshes happen lazily on each chat() without rebuilding the cached Provider instance. Pass `{db, authToken}` as the second arg to `loadProviderConfigFromEnv(env, oauth?)` to enable it. For the worker subprocess specifically, `runAgentTurn` pre-fetches the initial access token via `resolveAgentApiKey` and passes it through `WorkerInput.apiKey` → `createBazilionSession({apiKey})`; the session's mid-turn refresher calls back through a private IPC request bound to the worker's provider, Agent, and turn. The daemon alone reads/writes the OAuth secrets row, and only the refreshed access token returns over IPC.

### Secrets and config

`secrets.enc` and `config.json` are gone. The DB has two tables:

- **`secrets(key TEXT PK, envelope TEXT NOT NULL, updated_at INTEGER)`** — AES-256-GCM envelopes (salt+iv+tag+data hex JSON), one row per env-var-shaped key (`ANTHROPIC_API_KEY`, `OPENAI_CODEX_OAUTH`, …). Encryption key derived from `auth.json`'s `token` via PBKDF2-SHA256 100k. Same crypto as the previous file-based store; only the storage medium changed. Threat model is unchanged: anyone who can read both `bazilion.db` *and* `auth.json` can decrypt — the encryption guards against accidental exposure (cat'd dumps, screenshares), not against filesystem read.
- **`config(key TEXT PK, value TEXT NOT NULL, updated_at INTEGER)`** — plaintext for env-var-shaped values that don't need confidentiality (server URLs, region slugs, project IDs). The `CONFIG_KEYS` allowlist (derived from `services.ts`) is enforced in `repos/config.ts` on writes.

API in `apps/daemon/src/core/`: `openSecrets(db, password)` and `openConfig(db)` (ConfigStore + SecretsStore types). The daemon caches the auth token in `getCtx().authToken` so all routes can call `mergeSecretsIntoEnv(db, authToken)` without re-reading `auth.json`.

## Conventions

- Biome formatter: single quotes, no semicolons, trailing commas, 2-space indent, 100-col width.
- TS is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. `.ts` extensions are required on all relative imports (`allowImportingTsExtensions: true`) — `tsx` and Vite both handle it.
- `apps/web/` is excluded from the root `tsconfig.json` and from biome (it has its own Vite/TanStack-managed tooling). Run `pnpm --filter @bazilion/web typecheck` for web-only TS checks. The whole-tree `typecheck` intentionally skips it.
- **The alpha database contract is clean-install only.** The complete canonical schema lives in
  `apps/daemon/src/core/db/migrations/0001_init.sql`. Until a stable migration contract is
  announced, schema changes edit that file directly and require wiping/rebootstrapping
  `~/.bazilion`; do not add ALTER migrations, legacy-table importers, or API/URL/filesystem
  compatibility adapters. The bootstrap runner remains idempotent for an already-current schema.

## Implemented for the next release (don't re-implement)

- **BAZ-031: provider-neutral protected runtime.** Every provider id in Bazilion's pinned Pi
  registry is exhaustively accounted for. Protected and restricted-review workers receive only the
  selected model id, reasoning level, selected API/OAuth credential, optional validated endpoint,
  and a closed provider-specific credential-field list. These fields are installed into Pi's
  in-memory credential store; the child process environment remains minimal. OpenAI Codex refresh
  stays daemon-owned. Static-key providers, explicit Bedrock bearer/static credentials, Cloudflare
  identifiers, loopback-only local providers, and explicit encrypted Google Vertex credentials JSON
  use the same protected path. Vertex JSON is confined to a mode-0600 per-turn scratch file. Ambient
  AWS profiles, host Google ADC paths, unknown providers, unsafe endpoints, and missing credentials
  fail before spawn without falling back to configured host execution. Browser and MCP remain denied
  and protected `web_fetch` remains uncredentialed.

- **BAZ-006: opt-in Docker shell isolation and dangerous-command approval.** The default remains
  `BAZILION_BASH_SANDBOX=off`, which keeps Pi's host-backed
  `read`/`bash`/`edit`/`write`/`grep`/`find`/`ls` surface unchanged. In `docker` mode,
  Bazilion removes every host-backed coding tool and replaces only `bash` with a fresh,
  network-disabled container. The Team workspace is mounted read/write at `/workspace`, with its
  `memory/` subtree over-mounted read-only to `bash` (the scoped `memory_*` tools still own memory
  writes); Agent document inputs are read-only at `/inputs`, and each attached skill directory is
  read-only under `/skills/`. Skill bodies remain prompt-only,
  and each injected body names the matching host or container runtime directory for relative
  scripts/assets. Recursive bind propagation is disabled. The container gets a scrubbed
  allowlist environment (image `ENV` is discarded), a read-only root, and a temporary `/tmp`;
  it uses the configured local image (`debian:bookworm-slim` by default) with `--pull never`.
  Only a local Unix-socket Docker context is accepted, and images declaring `VOLUME`s are rejected
  because those would create implicit writable filesystems. Missing Docker, a missing/incompatible
  local image, or a mount failure fails closed without falling back to host execution. The
  independent `BAZILION_BASH_APPROVAL=dangerous` control pauses classified commands in interactive
  web and TTY CLI turns and auto-denies them in non-interactive turns. Shell approval is ephemeral
  and remains separate from durable Team Policy communication approvals.

## Already-shipped invariants (don't re-implement)

- **Daemon = sole owner of `~/.bazilion`** — the worker subprocess delegates anything DB-backed (messaging tools, provider gate, agent resolution, secrets) back to the daemon over Node IPC + stdin. There is no per-worker SQLite handle.
- **Teams = single filesystem root + USER.md + roster + shared memory.** One agent → one team. `teams.user_md` is a DB column (agents can't clobber it via `write`/`edit`). Teams always live under `~/.bazilion/teams/<slug>/` (real dir or symlink via `--link`).
- **Memory is team-shared.** `qmdBackend(team.path/memory)` — every member writes to and reads from the same store. Personal notes go to `IDENTITY.md` via `home_write`.
- **Canonical production Team Policy model.** Agent templates are reusable Profiles. Team templates
  (`team_templates`) own one revisioned, stable-slot roster and directed policy. A live
  Team owns exactly one effective revisioned policy; Agents are permanent resources with
  exactly one Team membership. Do not create a second Team roster or detached live Team Policy
  identity. Canonical HTTP surfaces are `/api/team-templates` and `/api/teams/:id/policy`.
- **Team Policy enforcement covers every communication boundary.** With
  `BAZILION_TEAM_POLICY_ENFORCEMENT=on`, the shared authorizer gates user/peer/cross-Team,
  scheduler, inbox, HTTP/worker turn, and Telegram ingress/egress boundaries. Missing edges
  deny. Durable block events contain policy evidence but never message payloads. The compiled
  management contract is version 1; do not add a bypass or a second authorization path.
- **Communication approvals are an edge posture, not a workflow engine.** An
  `approval_required` edge captures and holds one typed attempt before its guarded side
  effect. `/api/approvals`, `bazilion approval`, the web queue, and `approval_status` expose
  state. Approval revalidates membership/policy and dispatches at most once; scheduled-trigger
  approval instead grants the captured durable occurrence, which the scheduler executes under
  its normal lease and bounded-retry state machine. Do not couple it
  to BAZ-006 shell approval, or add stages, transformations, general retries, or approver
  assignment engines.
- **No runs/events tables, no stats CLI.** The runs/events audit layer was dropped in favor of pi's session JSONL files (which are the authoritative transcript). There is no `bazilion run list/show/cancel/prune` and no `bazilion stats`. Cancel is `bazilion agent cancel <id>` (keyed by agentId).
- **Bootstrap auth lives in `auth.json`.** The daemon reads it once at startup (`getCtx().authToken`) and uses it as the PBKDF2 seed for the secrets table. The CLI reads it as its loopback bearer. The `bootstrap` row in `web_tokens` cannot be revoked — `DELETE /api/tokens/:id` rejects a hash match against the auth token.
- **First-run gate** — `isSetupComplete(db)` returns true iff at least one enabled provider has ≥1 curated model. Web middleware redirects non-API routes to `/welcome` while the gate is closed; API routes return 409. Allowed prefixes during setup: `/welcome`, `/login`, `/config`, `/api/config`, `/api/auth`, `/api/health`, `/api/login`. Crossing the threshold triggers `ensureSetupSeeded(db, paths)` which creates the `default` profile (skillsMode: `'all'`) + `default` team (at `~/.bazilion/teams/default/`).
- **Spawn-time skill override is gone.** Skills come from the profile only — `skillsMode: 'all'` attaches every installed skill at spawn, `'selected'` uses `profile_default_skills`. Per-agent tweaks happen post-spawn via `bazilion agent skill add/rm` (or the per-agent skills card on the detail page).
- **Web client constants live in `apps/web/src/lib/wire-constants.ts`** (`DEFAULT_TEAM_ID`, `DEFAULT_PROFILE_ID`, `REASONING_LEVELS`). `apps/web/src/lib/daemon-client.ts` is server-only — Vite's import-protection rejects it from any client-bundled module.
- **OpenClaw skill model: prompt-only.** Skills under `~/.bazilion/skills/<name>/` get their SKILL.md body injected into the system prompt of every agent they're attached to; helper scripts run via the active `bash` implementation. The prompt names each attached skill's real host directory in host mode and its read-only `/skills/...` mount in Docker mode. No framework `entry:` extension, no trust gate.
- **qmd memory backend** (`apps/daemon/src/runtime/memory/qmd.ts`) — wraps `@tobilu/qmd`'s `searchLex` (BM25) for all memory routes. One `.qmd-index.sqlite` per team. Hybrid/vector paths are intentionally not enabled (pulls `node-llama-cpp` and multi-GB GGUF models; excluded in `pnpm.onlyBuiltDependencies`).
- **Scheduled interval / cron triggers** (`agent_triggers` + `trigger_dispatches` tables; `apps/daemon/src/lib/scheduler.ts`) — an in-process tick loop (default 5s, `BAZILION_SCHEDULER_TICK_MS`; disable with `BAZILION_SCHEDULER=off`) is pinned to `globalThis[Symbol.for('bazilion.scheduler')]`. Interval kind uses `last_fired_at + every ≤ now` with `created_at` as baseline; cron kind parses 5-field expressions via `apps/daemon/src/lib/cron.ts`. A due occurrence is idempotently materialized in `trigger_dispatches`; while one dispatch is open, later interval occurrences coalesce. `last_fired_at` is the materialization watermark, not proof that the Agent turn succeeded. Claims are transactional and leased, busy Agents defer without losing work, expired running leases are recoverable after restart, and failures retry to a bounded terminal state. Firing reuses `runAgentTurn`; inspect delivery with `bazilion trigger history <id>`. CLI: `bazilion trigger add|list|rm|enable|disable|history`.
- **Inbox / messaging surfaces** — the `send_message` / `read_inbox` / `wait_for_reply` tools (`apps/daemon/src/runtime/tools/messaging.ts`) are wired with `MessagingHost` injection: in the daemon (compact/context routes) the host is `createDbMessagingHost(db)`; in the worker the host is `createIpcMessagingHost()` which proxies every method through Node IPC. Outside-the-loop surfaces: `GET /api/agents/:id/messages?unread=1` (list), `POST /api/agents/:id/messages` (now accepts `replyTo`), `GET|PATCH /api/messages/:id` (detail + mark-read). CLI: `bazilion inbox list <agent> [--unread]`, `inbox show <id>`, `inbox read <id>`. Web: `/agents/:id/inbox`.
- **`web_fetch` hardening: Readability + markdown + cache + SSRF guard** — `@mozilla/readability` over `linkedom`, output as markdown (or text via `extract_mode`). SSRF guard at `apps/daemon/src/runtime/tools/web-ssrf.ts` blocks loopback/private/link-local + DNS rebinding (re-validates resolved IPs, pins them into undici's `Agent.connect.lookup`). 15-min in-memory LRU per `${mode}|${url}` (100-entry cap). UA spoofs desktop Safari. 20s default timeout, 3 max redirects.
- **ChatGPT OAuth / `openai-codex` provider** — credentials in `secrets:OPENAI_CODEX_OAUTH`. CLI runs the loopback flow (port 1455) client-side and PUTs credentials to `/api/auth/openai`; web `/config` has a "Connect ChatGPT" card. `apps/daemon/src/lib/api-key.ts:resolveAgentApiKey` is the single helper every session-creating call site uses to pre-fetch the access token and its optional mid-turn refresher. Daemon-side sessions call the refresher directly; worker turns call it over the private `refreshApiKey` IPC method without opening the DB or receiving the stored refresh credential.
- **Team Templates are the only reusable Team roster.** `team_templates` owns revisioned
  stable slots and policy edges. HTTP uses `/api/team-templates`, CLI uses
  `bazilion team-template`, and web uses `/templates/teams`. Do not add a second roster model
  or compatibility alias.
- **Shared web `<Button>` component** (`apps/web/src/components/Button.tsx`) — `variant="primary|ghost|danger"`, defaults `type="button"`. Wraps the existing `.btn-primary` / `.ghost-btn` / `.danger-btn` classes in `styles.css`. Prevents the class of bug where bare `<button type="button">` falls through to Tailwind preflight and renders unstyled (`styles.css:282` only opt-styles `button[type='submit']:not(.unstyled)` or `.btn-primary`). New code should use `<Button>`; older callsites convert opportunistically as they're touched. Icon-only dropdown items and tabs still use bare `<button>` intentionally (they need transparent backgrounds).
- **Long-lived agent resources live in the daemon, reached over IPC** (shipped v0.4.0). Browser sessions and MCP connections are stateful and don't fit the per-turn worker (fresh subprocess, no state, dies at turn end). They live in a process-lifetime registry pinned to `globalThis[Symbol.for('bazilion.resources')]` (`apps/daemon/src/lib/resources.ts`) with an idle reaper (`BAZILION_RESOURCE_REAP_TICK_MS`, default 30s; per-entry `idleMs`) and a shutdown hook wired into the daemon's SIGINT/SIGTERM path. The worker's tools proxy back via two generic IPC RPC methods — `browserInvoke` / `mcpInvoke` (`worker/ipc-protocol.ts`, dispatched in `worker/spawn.ts` like the messaging host). **Tool results are multimodal**: `ToolHandler.invoke` returns `string | ToolResultPart[]` (`runtime/tools/types.ts`), mapped to pi's `(TextContent | ImageContent)[]` in `runtime/pi/tools.ts`. The `tool_result` `SessionEvent` carries an optional `images` array (base64) that `ChatPane` renders inline; persisted transcript re-renders are text-only (ProviderMessage has no image field).
- **Browser automation: native Playwright tools** (shipped v0.4.0). One persistent Chromium context per agent in `apps/daemon/src/lib/browser/` (`pool.ts` keyed by agentId, survives across turns; lazy `import('playwright')` so Chromium bindings load only on first use). Worker-side tool defs in `runtime/tools/browser.ts` (`browser_navigate/snapshot/click/type/hover/select/fill_form/press_key/go_back/tabs/take_screenshot/console/network`) proxy via `BrowserHost`. **Accessibility-tree-first**: `browser_snapshot` returns `page.locator('body').ariaSnapshot({mode:'ai'})` with `[ref=eN]` refs; interactions target `aria-ref=<ref>`. Screenshots are a secondary multimodal tool. **SSRF guard** (`lib/browser/ssrf.ts`) re-applies `web-ssrf.ts`'s loopback/private/link-local classification at the `context.route` layer (the browser bypasses undici); `BROWSER_ALLOW_PRIVATE_NETWORK` opens it for local dev. Config via the `browser` service in `core/services.ts` (`BROWSER_ENABLED/HEADLESS/ALLOW_PRIVATE_NETWORK/IDLE_MS/MAX_SESSIONS`). Needs `pnpm exec playwright install chromium` (playwright is in `pnpm.onlyBuiltDependencies`).
- **Bidirectional images; audio/video deferred** (shipped v0.4.0). pi (0.75.4) + every wired provider are **text+image only** — content blocks are `TextContent | ThinkingContent | ImageContent`, `UserMessage.content` is `string | (TextContent|ImageContent)[]`, and model metadata declares `input: ('text'|'image')[]` even for audio-named models. So images are first-class both directions; audio/video can't reach the model and are deferred (no `AudioContent`/`VideoContent` exists). **Image output**: tool-produced images surface as standalone deliverables — a dedicated `images` render entry outside the tool box on web (`ChatPane`), and a Telegram photo sent regardless of mirror mode (`lib/telegram/mirror.ts`, `sendPhoto`/`sendDocument` fallback). **Input is unified**: one generic `Attachment {name?,mimeType,data}` (api-types) rides `ChatRequest.attachments` → `runAgentTurn` is the **single central classifier** — `image/*` → `images` passed to the worker → `session.prompt(text,{images})` (pi vision); everything else → `lib/attachments.ts:saveInputFiles(agent.dir, docs)` writes to `agents/<id>/uploads/` + appends a `[file saved to <path> …]` note (no worker/model change — it's text). Clients just send attachments: web composer (📎/paste/**drag-and-drop**, ANY file, one list), CLI `bazilion agent chat --image|--file <path>` (both → `attachments`), Telegram inbound (`routing.ts` downloads any media via `media.ts:downloadMediaBytes` → one `Attachment`). `piMessagesToProviderView` carries `images` on user + toolResult roles so they persist across reloads. Audio/video deferred (model is text+image only; they ride as stored files).
- **Outbound files: `deliver_file` tool** (shipped v0.4.0). Always-available tool (`runtime/tools/deliver-file.ts`) reads a workspace file (worker shares the daemon fs), base64s it, emits a `file` SessionEvent via a `fileSink` injected in `worker/entry.ts`. Clients render it: web download link (`ChatPane` `file` render entry, live-only — pi session doesn't store it), Telegram `sendDocument` (`mirror.ts:mirrorFile`), CLI saves to cwd. 25 MB cap. (Tool-produced *images* — screenshots/MCP — still surface via the `images`-on-tool_result path + standalone web image block + Telegram photo.)
- **MCP client** (shipped v0.4.0). `@modelcontextprotocol/sdk` client pool in `apps/daemon/src/lib/mcp/` (`pool.ts`) supporting stdio (subprocess, inherits the merged secrets env), Streamable-HTTP, and SSE (bearer token in `secrets:MCP_TOKEN_<id>`). Servers are configured **globally** in the canonical `mcp_servers` table declared by `0001_init.sql` (`repos/mcpServers.ts`) — per-agent scoping is a deliberate fast-follow. Per turn, `lib/mcp/resolve.ts:resolveMcpForTurn` discovers each enabled server's tools (`tools/list`, pooled/cached), namespaces them `mcp__<server>__<tool>`, ships them to the worker on stdin (`WorkerInput.mcpTools`), and the worker builds proxy tools (`runtime/tools/mcp.ts`) that call back via `mcpInvoke`. A server that fails to connect is logged and skipped. HTTP: `/api/mcp-servers[/:id[/test]]`. CLI: `bazilion mcp add|list|show|rm|enable|disable|test`. Web: `/config/mcp`. Wire types `McpServer`, `McpServerInput`, `McpToolInfo`, `McpTransport` in `@bazilion/api-types`.
