# Bazilion Architecture — Components & Communication

Comprehensive engineer-to-engineer reference for every component in the monorepo and how they talk to each other.

For the LLM turn loop itself, see `agent-engine.md`. Bazilion is based on [Pi's coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) as that core engine: Pi owns the session loop, replay, compaction, provider/tool execution, and coding tools. This doc is about the system *around* the engine: the DB, the daemon, the CLI, the subprocess boundary, and the flows that stitch them together.

The HTTP API lives in a standalone Hono daemon (`apps/daemon`, port 4321); the web UI is a TanStack Start app (`apps/web`, port 4322) that calls it. A team is a collaboration context (one filesystem root, one USER.md, one roster, one shared memory) and an agent belongs to exactly one team. Pi's session JSONL files are the canonical transcript — there is no separate `runs` / `events` audit layer. Config + secrets live in two SQLite tables; the only remaining file at the bazilion home root besides `bazilion.db` is `auth.json` (the bootstrap bearer used by both the daemon and the CLI). Workers spawned per turn don't hold a SQLite handle of their own — agent resolution happens in the daemon, while daemon-owned tools and turn-scoped shell approval round-trip via Node IPC.

## 0. Topology at a glance

```
                ┌────────────────────────┐
   terminal ──▶ │  apps/cli  (citty)     │
                │  ─ src/index.ts        │──── HTTP + bearer ─────────┐
                │  ─ src/client.ts       │                            │
                └────────────────────────┘                            │
                                                                      │
  browser ─────────────▶ ┌────────────────────────────┐               │
                         │  apps/web (TanStack Start) │               │
                         │  127.0.0.1:4322            │               │
                         │  ─ __root.tsx auth gate    │               │
                         │  ─ /api/$ catch-all proxy  │── HTTP + bearer
                         │     (cookie → bearer)      │               │
                         └────────────────────────────┘               │
                                                                      ▼
                              ┌───────────────────────────────────────────────┐
                              │  apps/daemon  (Hono on @hono/node-server)     │
                              │  127.0.0.1:4321                               │
                              │  ─ src/app.ts (route mounts)                  │
                              │  ─ src/lib/middleware-auth.ts (auth + gate)   │
                              │  ─ src/routes/{agents,teams,profiles,        │
                              │      skills,triggers,messages,config,         │
                              │      auth-login,misc}.ts                      │
                              │  ─ src/lib/{ctx, agent-cancel, scheduler,     │
                              │      agent-turn, api-key, messaging-host,     │
                              │      auth, cron, agent-id}.ts                 │
                              └───────────┬───────────────────────────────────┘
                                          │ in-proc
                                          ▼
                              ┌───────────────────────────────────────────────┐
                              │  apps/daemon/src/core  (pure data layer)      │
                              │  ─ db/{client, migrate, migrations/0001…}     │
                              │  ─ repos/* profile/* agent/* team/* skills/* │
                              │  ─ paths · services · secrets                 │
                              │  ─ availableModels                            │
                              └──────────────────┬────────────────────────────┘
                                                 │ reads/writes
                                                 ▼
                              ┌───────────────────────────────────────────────┐
                              │  ~/.bazilion                                  │
                              │  bazilion.db (SQLite WAL)                     │
                              │  auth.json {token, remote?}                   │
                              │  teams/<slug>/{memory,…}                     │
                              │  agents/<id>/{sessions/*.jsonl, *.md}         │
                              │  profiles/<id>/  skills/<name>/  logs/        │
                              └───────────────────────────────────────────────┘
                                                 ▲
                                                 │ fork (subprocess per turn,
                                                 │  stdio: pipe/pipe/inherit/ipc)
                                                 │
  ┌──────────────────────────────────────────────┴─────────────────────────────┐
  │  apps/daemon/src/runtime  (spawned per-turn, NO DB handle)                 │
  │  node --import <tsx-loader> apps/daemon/src/runtime/worker/entry.ts        │
  │  ─ worker/{entry, spawn, ipc-protocol}                                    │
  │  ─ pi/{session, tools, events}    ← bridge to pi-coding-agent             │
  │  ─ session/{prompt, frame}                                                │
  │  ─ providers/{pi-adapter, registry, retry, catalog, types}                │
  │  ─ tools/{registry, memory, messaging, home, web, web-ssrf,               │
  │     web-extract, bootstrap}                                               │
  │  ─ shell/{security, tooling, docker}                                      │
  │  ─ memory/{qmd, files, types}  ─ auth/openai-codex                        │
  └────────────────────────────────────────────────────────────────────────────┘
                                                 │
                                                 ▼
                              Upstream LLM providers via pi-ai
                              (anthropic, openai, google, groq, bedrock,
                               lmstudio, ollama, openai-codex/OAuth, …)
```

Three processes during a chat: the **web UI** (long-lived Vite/Node), the **daemon** (long-lived Hono, sole DB owner), and the **worker** (short-lived, one per turn — no DB handle, talks back via IPC). The CLI is a fourth process that talks straight to the daemon over HTTP.

Wire boundaries:
- **Local CLI ↔ daemon; remote CLI/mobile ↔ gateway ↔ daemon; web UI ↔ gateway ↔
  daemon**: native clients use expiring device bearers; browsers use daemon-owned session cookies
  forwarded unchanged by the web proxy. Streaming endpoints emit NDJSON. Remote clients are never
  directed to an exposed daemon listener.
- **Daemon ↔ worker**: stdin (one JSON line: `{agent, message, enabledProviders, apiKey?, turnId, bashApprovalMode}`), stdout NDJSON `ChatFrame`, plus a Node IPC channel (fd 3) for DB-backed tools and turn-scoped shell approval (`process.send({type:'rpc', method, args, id})` ↔ `child.send({type:'rpc-reply', id, ok, result|error})`).

The `ChatFrame` shape is the same across the worker→daemon boundary and the daemon→client boundary — no translation. Worker stdout → daemon HTTP body → CLI stdout / browser parser.

## 1. `packages/api-types` — the anti-drift ring

**Hermetic** — zero deps, no `node:*` imports, no daemon code. Owns the canonical type definitions for everything that crosses the HTTP/IPC wire. Four modules:

1. **`entities.ts`** — entity shapes that originate in the DB but cross the wire: `Agent`, `Profile`, `Team`, `Message`, `SkillMeta`, `WebToken`, `AgentTrigger`, `LoadedProfile`, `ResolvedAgent`, `OpenAICodexStatus`, …
2. **`events.ts`** — chat/provider wire events: `ChatFrame`, `SessionEvent`, `ProviderMessage`, `ToolCall`, `ToolDef`.
3. **`memory.ts`** — memory wire types (`MemoryEntry`, `MemoryHit`, …).
4. **`index.ts`** — request/response envelopes (`SpawnAgentRequest`, `UpdateProfileRequest`, `ChatRequest`, `RegisterTeamRequest`, `SetTeamUserMdRequest`, `ImportSkillsRequest`/`Response`, `ProviderTestRequest`/`Response`, `HealthReport`, `ChatContextResponse`, `ApiError`, `ServiceCard`, `ProviderConfigResponse`, …) plus `PROFILE_FILES` (the whitelist of editable profile markdown filenames) and the matching `ProfileFileName` string-literal union.

The flow has reversed compared to earlier shapes: the daemon imports its entity/wire types **from** `@bazilion/api-types`, not the other way around. That's what keeps `apps/web`, `apps/mobile`, and `@bazilion/client` from ever reaching Node-only code (`node:sqlite`, undici, pi-ai, the worker spawner). Nothing here executes; it's a compile-time contract.

## 1b. `packages/client` — cross-origin HTTP client

One file: `src/index.ts`. Pure `fetch` + `TextDecoder` + an NDJSON stream async generator. No `node:*` imports, no node-only deps, so it works in Node (the CLI), React Native (the mobile app), and anywhere else with a real `fetch`. Exports `createClient({serverUrl, token})`, `BazilionClient` (the typed `{get, post, put, patch, del, postMultipart, stream}` surface), `ApiClientError`. `token` is `string | (() => string | Promise<string>)` so OAuth refresh / mobile keychain reads plug in without rebuilding the client.

`apps/cli/src/client.ts` wraps `createClient` with `loadClientConfig()` (reads `~/.bazilion/auth.json` + `BAZILION_SERVER`/`BAZILION_TOKEN` env). The mobile app uses `clientFor(creds)` (`apps/mobile/src/auth.ts`) which loads the bearer from `expo-secure-store`. The browser does **not** use this package — it talks to its own server (`apps/web`) same-origin via relative `/api/*` URLs; the web's `/api/$` catch-all then translates the cookie to a bearer header for the daemon.

## 2. `apps/daemon/src/core` — pure data layer

**Rule**: no LLM, no network, no process spawning. Everything here is pure functions, DB queries, and filesystem I/O on `~/.bazilion`. Lives inside the daemon — not a separate package.

### 2.1 Paths — `paths.ts`

`resolvePaths(home?)` returns the `Paths` struct: `home`, `db`, `authFile`, `profilesDir`, `agentsDir`, `skillsDir`, `teamsDir`, `logsDir`, plus `profileDir(id)` / `agentDir(id)` / `teamDir(slug)` / `skillDir(name)` computed helpers. Override `home` via `$BAZILION_HOME`, default `~/.bazilion`. Every other core + runtime module takes `Paths` as input — no one recomputes paths independently. **There is no `configFile` field anymore** — the previous `config.json` + `secrets.enc` pair was collapsed into DB tables.

### 2.2 DB client — `db/client.ts` + `db/migrate.ts`

Uses Node 22's built-in `node:sqlite` (`DatabaseSync`). No `better-sqlite3`, no `bun:sqlite`.

**`openDb(path)`** applies `PRAGMA journal_mode=WAL` and `foreign_keys=ON`. WAL was originally what made the worker↔server concurrency work; today the worker doesn't open the DB at all, so WAL mostly buys us "daemon can read while it writes" semantics for in-process operations.

**`QueryableDatabase`** wraps `DatabaseSync` with a **prepared-statement cache** keyed by SQL string, and exposes a typed `QueryStmt<Row, Params>` with `get() / all() / run()`. The wrapper also implements manual `BEGIN / COMMIT / ROLLBACK` in a `transaction()` method because `node:sqlite` has no callable transaction wrapper.

**`BazilionDb`** is the public type: `{ raw: QueryableDatabase; backupTo(path): Promise<number>; close(): void }`. Everything downstream (repos, runtime helpers) takes `BazilionDb`, not the raw sqlite handle; `backupTo` is the daemon-owned SQLite online-snapshot seam.

**`runMigrations(db)`** is idempotent for the current canonical schema. It creates a
`schema_migrations(version, applied_at)` bookkeeping table, loads numbered `*.sql` files from
`db/migrations/` in lexical order, and runs each unapplied file inside a transaction. Called from
`apps/daemon/src/lib/ctx.ts:bootstrap()` at daemon startup — the daemon eagerly initializes the
context so the bootstrap message + auth.json land before the HTTP port binds. While the alpha
contract remains clean-install-only, startup rejects an older or structurally incompatible schema
before starting background services or binding HTTP and points the operator to the safe reset path;
it does not attempt an in-place upgrade.

### 2.3 Schema (migrations)

`0001_init.sql` is the consolidated authoritative baseline (the project is alpha; the prior chain has been collapsed multiple times rather than maintaining ALTER history). Live tables:

| Table | Purpose |
|---|---|
| `teams` | Collaboration contexts (`id` (slug, PK), `name`, `user_md`, `created_at`). One filesystem root per team, derived from `paths.teamDir(id)` at read time — there is no `path` column. `user_md` is the per-team human-context block injected into every member's prompt. |
| `profiles` | Agent templates (`id`, `name`, `dir`, `default_model`, `skills_mode IN ('all','selected')`, timestamps). No `memory_backend` column anymore (memory is per-team, not per-profile). |
| `profile_default_skills` | `(profile_id, skill_name)` — seed skills for `selected` mode. |
| `agents` | Running/archived agent instances (`id`, `profile_id`, `name`, `model_override`, `reasoning_level`, `status`, `dir`, `team_id` `ON DELETE RESTRICT`, timestamps). One agent → one team. |
| `agent_skills` | `(agent_id, skill_name)` — per-agent skill attachments. Cascade on agent delete. |
| `agent_triggers` | Per-agent wake-ups (`kind='interval' \| 'cron'`, `interval_sec`, `cron_expr`, `message`, `last_fired_at`, `enabled`). |
| `trigger_dispatches` | Durable delivery state for scheduled occurrences. Unique `(trigger_id, scheduled_at)` materialization plus pending/running/retrying/succeeded/failed/cancelled status, attempt count, lease, retry time, and terminal error metadata. It deliberately contains no prompt, response, tool, or provider-event transcript. |
| `messages` | Inter-agent mailbox (`id`, `from_agent_id`, `to_agent_id`, `payload`, `reply_to`, `read_at`). FKs do **not** cascade; `agent/delete.ts` nulls inbound `reply_to` and purges rows manually before removing the agent. |
| `skill_meta` | Import provenance — `(name PK, source, imported_at)`. No trust column — see "Skill model" in AGENTS.md. |
| `web_tokens` | Per-token access records (hashed). The `bootstrap` row's plaintext lives in `auth.json`; revoking it returns 409 (would lock the operator out). |
| `provider_models` | Curated model list per provider (what shows up in dropdowns). |
| `provider_state` | Per-provider enabled flag. |
| `secrets` | `(key PK, envelope, updated_at)` — AES-256-GCM blobs. PBKDF2 key derived from `auth.json:token`. |
| `config` | `(key PK, value, updated_at)` — plaintext for env-var-shaped config that doesn't need confidentiality (server URLs, region slugs). `CONFIG_KEYS` allowlist enforced in the repo on writes. |

**Dropped during the alpha**: `runs`, `events` (audit layer for chat turns — pi's session JSONL is now the canonical record), `chat_messages` column on `agents` (pi owns the transcript), `memory_backend` column on `profiles` (memory is per-team), `path` column on `teams` (derived from slug + paths), `agents.chat_messages` (same migration as runs/events).

### 2.4 Repos — `repos/*.ts`

One module per table, each exporting narrow operations. Nothing in a repo opens a DB handle; they all take `db: BazilionDb`.

| File | Scope |
|---|---|
| `agents.ts` | Insert / get (with name + UUID-prefix fallback) / list / `resolveId(prefix)` / archive / unarchive / update (name / model / reasoning) / `setTeam` / attach+detach skill. |
| `profiles.ts` | CRUD + `profile_default_skills` set ops. |
| `teams.ts` | CRUD (`insert / get / list / remove`, all taking `paths` to derive the path field) + `setUserMd`. No `getByPath` — slug is the unique key. |
| `messages.ts` | `send({from, to, payload, replyTo?}) / get / listInbox(agentId, {unread}) / markRead / findReplies(msgId) / drainUnreadForAgent(agentId)` (txn used by the auto-deliver scheduler). |
| `triggers.ts` | Insert / list per agent / listEnabled (all agents) / advance the occurrence-materialization watermark / setEnabled / delete. Disabling also cancels pending/retrying dispatches. |
| `triggerDispatches.ts` | Idempotently materialize occurrences / list claimable work / transactionally claim with a lease / defer a busy Agent / succeed / bounded retry or terminal failure / cancel / list recent history. |
| `skillMeta.ts` | `get / listAll / upsert / remove` — import provenance only. |
| `webTokens.ts` | Insert (hashes), findActiveByToken, markUsed, revoke, list, delete. |
| `providerModels.ts` | List / listAll / replace / remove per provider. |
| `providerState.ts` | `isEnabled / setEnabled / listEnabled` — returns a `Set<string>` consumed by the provider registry. |
| `secrets.ts` | `openSecrets(db, password) → SecretsStore` — per-row AES-GCM, password derived from `auth.json:token`. |
| `config.ts` | `openConfig(db) → ConfigStore`, plus `CONFIG_KEYS` and `isConfigKey`. |

### 2.5 Domain ops — `agent/`, `profile/`, `skills/`, `team/`

Higher-level than repos; they combine DB writes with filesystem operations.

**`agent/`**:
- `spawn.ts:spawnAgent(db, paths, input)` — allocates UUID, creates `agents/<id>/{sessions/}`, copies profile markdown templates (`SOUL.md`, `IDENTITY.md`, `BOOTSTRAP.md`, `AGENTS.md`, `TOOLS.md`) so the agent can diverge per-instance, writes `agent.json`, picks the team (caller-supplied or the seeded `default`), inserts into `agents` with `team_id`, attaches skills (honoring `profile.skillsMode`). **Does not create a per-agent `memory/` dir** — memory is at the team level now.
- `resolve.ts:resolveAgent(db, paths, id)` — joins agent + profile + team + skills into a `ResolvedAgent` (the type the runtime consumes). Accepts UUID prefixes and unique names.
- `archive.ts` / `unarchive.ts` — flip `status` + enforce state transitions.
- `delete.ts:deleteAgent(db, id)` — tx: null out inbound `messages.reply_to` pointers, purge messages where the agent is sender or recipient, then `agentRepo.remove` which cascades skills.

**`profile/`**:
- `create.ts` — validates slug, creates `profiles/<id>/`, writes template files, inserts profile + default_skills.
- `load.ts:loadProfile(db, id)` — returns `LoadedProfile` = the profile row + the parsed files (including `parseIdentityMarkdown`) + `defaultSkills[]` + `skillsMode`.
- `update.ts` — patch name / default_model / skills_mode / default skills.
- `delete.ts` — refuses while any non-archived agents reference the profile, removes the dir.
- `seed.ts:seedDefaults(db, paths, {model})` — idempotent bootstrap: creates the `default` team at `~/.bazilion/teams/default/` + a `default` profile wired to `model` with `skillsMode: 'all'`. `ensureSetupSeeded(db, paths)` is the call-site-safe wrapper that exits early when the default profile already exists. Called on the 0→1 available-models threshold (see §6.7).
- `validate.ts` — slug regex.
- `templates.ts` — the markdown strings used for the six profile files.
- `identity.ts` — structured parser for IDENTITY.md (pulls out `name`, `context`, etc.).

**`team/`**:
- `register.ts:registerTeam(db, input, paths)` — validates slug, materializes `paths.teamDir(id)` either as a fresh real directory (default) or a symlink to `input.link` (the "agents working on my existing project tree" path), creates the `memory/` subdir, inserts the row.
- `delete.ts:deleteTeam(db, paths, id)` — refuses while members exist (`agents.team_id` FK is `RESTRICT`), removes the row + the on-disk slot.

**`skills/`**:
- `discover.ts:discoverSkills(paths)` — walks `skillsDir`, returns `[{name, dir, skillFile}]` for each SKILL.md.
- `parse.ts:parseSkillFile(path)` — YAML frontmatter (`name`, `description`, `tags`) + markdown body.
- `import.ts:importSkills(db, paths, input)` — local path or `.zip` blob. Zip-slip guard on every entry. Copies into `skillsDir`, records `skill_meta` row with source + timestamp.
- `resolve.ts:resolveAgentSkills(db, paths, agentId)` — honors `profile.skillsMode === 'all'` (discover + attach everything) vs `'selected'` (use `profile_default_skills`).

### 2.6 Services, secrets, config

**`services.ts`** — static registry (`SERVICES`) of every provider and supporting service (Brave Search, SearXNG) the user might configure. Each `ServiceDef` has `id`, `displayName`, `category: 'provider' | 'service'`, `hint`, and a `fields[]` array where each field knows its env-var name, `kind: 'secret' | 'config'`, label, placeholder, description. **This single array drives**:
- the `/config` page UI (cards + forms),
- the env-var → store dispatch (`isConfigKey` → `config` table vs `secrets` table),
- the provider registry's "what hint do I show when this isn't set" error.

**`secrets.ts`** — top-level helpers tying the auth file to the secrets repo. `readAuthFile(authFile)` parses `~/.bazilion/auth.json` (`{token, remote?}`) and throws when the file is missing or malformed (callers treat that as "bazilion not initialized"). `mergeSecretsIntoEnv(db, password, env=process.env)` returns a fresh env object combining (lowest → highest precedence): the `config` table → the `secrets` table (decrypted with `password`) → `process.env`. Each request / each worker spawn gets a clean snapshot.

**`repos/secrets.ts`** — AES-256-GCM with PBKDF2 (100k iter, SHA-256). Envelope JSON stores `{salt, iv, tag, ciphertext}`. The `SecretsStore` exposes `get / set / remove / has / list (preview: first 6 chars + "…") / getAll`. Each row is encrypted independently with a fresh salt; the password is the `auth.json:token`.

**`repos/config.ts`** — companion plaintext store. `CONFIG_KEYS` derived from `SERVICES` (every field with `kind='config'`: URLs, project IDs, region slugs). `isConfigKey(key)` routes writes to the right store. The repo enforces the allowlist on `set`.

### 2.7 Available models

**`availableModels.ts:isSetupComplete(db)`** returns true iff at least one enabled provider has ≥1 curated model. The web middleware gates every non-API route to `/welcome` until this flips. `listAvailableModels(db)` and `groupAvailableModels(db)` produce flat + grouped views for dropdowns.

### 2.8 Public surface — `index.ts`

Flat barrel: `openDb`, `runMigrations`, `resolvePaths`, `spawnAgent`, `resolveAgent`, `agentRepo`, `messageRepo`, `profileRepo`, `triggerRepo`, `skillMetaRepo`, `webTokenRepo`, `teamRepo`, `providerStateRepo`, `providerModelRepo`, the profile/skill/team domain ops (`createProfile`, `updateProfile`, `deleteProfile`, `loadProfile`, `registerTeam`, `deleteTeam`, `discoverSkills`, `importSkills`, `resolveAgentSkills`, …), `mergeSecretsIntoEnv`, `readAuthFile`, `openSecrets`, `openConfig`, `isSetupComplete`, `SERVICES`, `findFieldByEnvVar`.

`apps/daemon/src/lib` (HTTP routes, middleware, lifecycle glue) and `apps/daemon/src/runtime` (LLM/tool stack) import from this flat namespace. `apps/cli` keeps a tiny local copy of just the path/auth helpers it needs for filesystem-level commands (`uninstall`, `backup`, `login`, `token show-local`) — it never opens the live daemon DB; offline restore opens only its private staged snapshot for validation. `apps/web` never reaches into the daemon's source at all; every data access goes through HTTP.

## 3. `apps/daemon/src/runtime` — the LLM side

See `agent-engine.md` for the full turn-loop walkthrough. Structural summary here:

- **`worker/{entry,spawn,ipc-protocol,ipc-client,api-key-refresh}.ts`** — subprocess boundary. `spawn.ts:spawnWorkerTurn` is the parent-side generator. `entry.ts` is the child script — reads stdin → runs the turn → emits NDJSON on stdout → on exit calls `process.disconnect()` so the IPC handle doesn't pin the event loop. `ipc-protocol.ts` declares the host interfaces, `IpcRequest`/`IpcReply`, and RPC methods for messaging, USER.md, browser, MCP, OAuth refresh, and `bashApproval`; `ipc-client.ts` correlates replies and rejects all pending calls on disconnect; `api-key-refresh.ts` enforces the provider/Agent/turn binding for refreshed access tokens. Stdio: `['pipe','pipe','inherit','ipc']`. The parent merges worker stdout with daemon-authored `command_approval` frames so registration always happens before a client can respond. SIGTERM cancels both the child and any pending approval or refresh wait; 3s grace before SIGKILL.
- **`pi/`** — the Pi engine bridge. `session.ts:createBazilionSession` builds a pi-coding-agent `AgentSession` for an agent (loads/creates the JSONL session file, selects the shell-policy tool surface, picks a provider). This is the core engine seam: Bazilion enters Pi here and then listens to Pi's events. Takes `enabledProviders: Set<string>`, optional `messagingHost: MessagingHost`, optional `apiKey: string` (pre-fetched OAuth token), and optional `refreshApiKey: (provider) => Promise<string>` (mid-turn refresher, direct in daemon sessions or IPC-backed in workers). `tools.ts:createBazilionCustomTools` adapts Bazilion's scoped `ToolHandler` shape to pi's `ToolDefinition` shape and composes memory, home, web, bootstrap, delivery, and optional IPC-backed tools. Host mode also enables Pi's coding tools; Docker mode enables none of those host-backed definitions and adds only the custom same-name `bash`. `events.ts` translates Pi session events back into Bazilion `SessionEvent`s for downstream NDJSON emission.
- **`session/`** — `prompt.ts` composes the system prompt from the Agent markdown files, Team block, USER.md, and attached skill bodies. Each skill block includes the directory from which its relative scripts/assets must resolve: the installed host directory in host mode or its matching read-only `/skills/...` mount in Docker mode. `frame.ts` owns the `ChatFrame` type.
- **`shell/`** — BAZ-006 runtime controls. `security.ts` owns strict default-off sandbox/approval config, structured command-risk classification, and environment scrubbing. `approval.ts` wraps Pi's bash tool at its tool-call boundary and refuses risky commands until the daemon returns a one-shot allow. `tooling.ts` preserves Pi's unchanged host surface with both controls off, replaces only host bash when approval is enabled, or selects the containerized bash in Docker mode; Docker never keeps host `read`/`edit`/`write`/`grep`/`find`/`ls`. `docker.ts` runs one `--rm` container per command with `/workspace` read/write, bounded read-only mounts, a read-only root plus tmpfs `/tmp`, dropped capabilities, the host uid/gid, and `--network none`. The runner rejects remote Docker contexts and image `VOLUME`s, discards image `ENV`, pins a local image id, and never falls back to host execution.
- **`providers/`** — `pi-adapter.ts` (pi-ai → Bazilion `Provider` adapter), `registry.ts` (provider registration + `enabledSet` gate + model-string parser, takes optional `oauth: {db, authToken}` to pick up `openai-codex` credentials), `retry.ts` (uniform transient-error retry with "no retry once streamed" invariant), `types.ts` (`Provider`, `ProviderRequest`, `ProviderResponse`, `ToolCall`, `ReasoningLevel`, `StopReason`).
- **`tools/`** — `registry.ts` (Map-backed dispatcher) + one file per tool category:
  - `memory.ts` — `memory_write / memory_read / memory_search / memory_list` (qmd BM25 over markdown files in `<team.path>/memory/`). Tool descriptions explicitly call out team-shared scope and direct personal notes to `home_write IDENTITY.md`.
  - `home.ts` — `home_read / home_write / home_list`. Scope: `agents/<id>/` with a hard whitelist of identity files (`SOUL.md`, `IDENTITY.md`, `BOOTSTRAP.md`, `AGENTS.md`, `TOOLS.md`). No path arg, no traversal. `BOOTSTRAP.md` is read-only — its lifecycle belongs to `bootstrap_done`.
  - `messaging.ts` — `send_message / read_inbox / wait_for_reply`. Takes a `MessagingHost` (not a DB handle) — the worker's host proxies via Node IPC, the daemon's host calls repos directly.
  - `web.ts` + `web-ssrf.ts` + `web-extract.ts` — `web_search` (Brave → SearXNG fallback) + `web_fetch` (Readability + markdown, SSRF guard, 15-min LRU cache, UA spoof, 20s timeout, 3 max redirects).
  - `bootstrap.ts` — `bootstrap_done` (deletes `BOOTSTRAP.md` after onboarding).
  - Coding tools are policy-selected: with sandboxing off, `read`/`bash`/`edit`/`write`/`grep`/`find`/`ls` come from pi-coding-agent's `createCodingTools(cwd, …)` with the Team directory as `cwd`; with Docker sandboxing on, all host-backed coding tools are hidden and only Bazilion's containerized `bash` is registered.
- **`memory/`** — `qmd.ts` (BM25 via `@tobilu/qmd`, one `.qmd-index.sqlite` per team memory dir, `storeCache` module-scope Map dedupes per-process), `files.ts` (zero-deps substring fallback, currently dormant), `types.ts`.
- **`auth/openai-codex.ts`** — OAuth storage/refresh for the ChatGPT-backed `openai-codex` provider. Credentials blob lives under secrets-table key `OPENAI_CODEX_OAUTH`. `loadAccessToken(db, authToken)` is what the provider registry hands pi-ai as its `apiKey` supplier.

## 4. `apps/daemon` — the HTTP server (Hono)

Hono on `@hono/node-server`, bound to `127.0.0.1:4321` by default (`HOST` / `PORT` env override). **Only the daemon holds the long-lived DB handle.** Boot via `bazilion serve`, which runs `node --import tsx/esm apps/daemon/src/index.ts`.

### 4.1 App composition — `src/app.ts`

Auth + first-run middleware mounted on `*`, then route families mounted under their resource roots:

```
app.use('*', authMiddleware)            // src/lib/middleware-auth.ts
app.route('/api/agents',   agentsRouter)
app.route('/api/teams',   groupsRouter)
app.route('/api/profiles', profilesRouter)
app.route('/api/skills',   skillsRouter)
app.route('/api/triggers', triggersRouter)
app.route('/api/messages', messagesRouter)
app.route('/api/config',   configRouter)
app.route('/api', miscRouter)           // /health, /backup, /tokens, /tokens/:id
app.route('/api', authRouter)           // /auth/openai*, /providers/test, /login
```

`src/index.ts` calls `serve()` from `@hono/node-server`, installs SIGINT/SIGTERM handlers that gracefully close the HTTP server, and exits.

### 4.2 Per-process singletons

**`src/lib/ctx.ts:getCtx()`** returns `{db, paths, authToken}`.
- Initializes `{db, paths}` once per process. Lazy: the first request pays the cost.
- Runs migrations on open.
- Reads `auth.json` once and caches the bootstrap token in `authToken` — used as the PBKDF2 seed for the secrets table on every `mergeSecretsIntoEnv` call.
- Kicks off the scheduler on first call (unless `BAZILION_SCHEDULER=off`).

**`src/lib/agent-cancel.ts`** — `Map<agentId, AbortController>`, pinned to `globalThis[Symbol.for('bazilion.agent-cancel.registry')]` so module reloads don't split the map. Exports `registerAgent`, `unregisterAgent`, `cancelAgent`, `isActiveAgent`. Replaces the older runId-keyed registry — runIds are gone now that the runs table is gone.

**`src/lib/scheduler.ts`** — `setInterval` tick loop pinned to `globalThis[Symbol.for('bazilion.scheduler')]`. Unrefed so tests can exit. See `agent-engine.md` §8 for the firing rules.

**`src/lib/messaging-host.ts`** — `createDbMessagingHost(db)` returns a `MessagingHost` backed by repos. Used by both the in-process compact/context routes and the worker IPC handler in `worker/spawn.ts`.

**`src/lib/api-key.ts`** — `resolveAgentApiKey(db, authToken, agent, opts?)` — the helper every session-creating call site uses to pre-fetch an `apiKey` (and optionally a `refreshApiKey`) for the agent's provider. For env-key providers it returns `{}` (pi pulls from the merged env). For `openai-codex` it fetches the OAuth access token from the secrets table; callers pass `withRefresher: true` so pi can swap an expired JWT mid-turn. In-process sessions invoke the callback directly, while worker sessions reach it through a provider- and turn-bound IPC request.

### 4.3 Middleware — `src/lib/middleware-auth.ts`

Two sequential gates on every request:

1. **Auth gate** — reads `Authorization: Bearer <t>` for native clients or a daemon-owned
   browser-session cookie. Device tokens are hashed, expiring credentials; browser sessions store
   only hashes, have 12-hour idle and seven-day absolute limits, and require a session-bound CSRF
   header on unsafe methods. The bootstrap token in `auth.json` is explicitly typed and
   non-expiring. `/api/login` accepts it only while setup is incomplete, creates an internal
   expiring/revocable device identity as the session source, and never stores the bootstrap bearer
   in browser cookies. Once setup completes, browser login rejects it. Public paths are exactly
   `/api/login` and minimal `/api/health`.
2. **First-run gate** — `isSetupComplete(db)` (see §2.7). Before setup is done, authenticated
   configuration, auth, token/session management, detailed health, and provider-test paths remain
   open so the operator can prove a provider and finish setup. Everything else returns
   `409 setup incomplete`.

The web UI also enforces a setup gate client-side (its `__root.tsx` `beforeLoad` redirects to `/welcome` until setup is done) but the daemon's gate is the load-bearing one.

### 4.4 HTTP API surface — `src/routes/*.ts`

Grouped by resource. Request/response shapes all live in `@bazilion/api-types`. URL params resolve through `src/lib/agent-id.ts:resolveAgentIdParam()` so prefixes/names expand to full UUIDs before hitting tables keyed by full id.

**Agents** (`routes/agents.ts`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agents?includeArchived` | List agents. |
| POST | `/api/agents` | Spawn new agent from a profile (accepts `teamId`). |
| GET | `/api/agents/:id` | Full resolved agent (profile, team, skills). |
| PATCH | `/api/agents/:id` | Edit name / model override / reasoning level. |
| PATCH | `/api/agents/:id/team` | Move to a different team. |
| POST | `/api/agents/:id/chat` | **Streaming NDJSON** — the main turn endpoint. Calls `runAgentTurn()`. |
| POST | `/api/agents/:id/cancel` | Abort the in-flight turn for this agent (keyed by agentId). 409 if the agent is idle. |
| POST | `/api/agents/:id/chat/reset` | Drop the agent's pi session(s) so the next turn starts with an empty transcript. |
| GET | `/api/agents/:id/chat/context` | `ChatContextResponse` — system prompt / tools / skills / team / history breakdown. `?detail=1` or `?json=1` includes every entry. |
| POST | `/api/agents/:id/chat/compact` | Pi-style compaction: summarize the head, preserve `keepTail` entries (default 10) verbatim, persist a compaction marker. |
| POST | `/api/agents/:id/chat/truncate` | Keep first N entries. |
| POST | `/api/agents/:id/archive` / `unarchive` | Status flip. |
| DELETE | `/api/agents/:id` | Hard delete (via `agent/delete.ts`). |
| GET / POST | `/api/agents/:id/messages` | Inbox list / send (accepts `replyTo`). |
| GET | `/api/agents/:id/loop-breaks` | Recent payload-free causal-chain stops involving this Agent. |
| GET / POST | `/api/agents/:id/skills` | List attached / attach. |
| DELETE | `/api/agents/:id/skills/:name` | Detach. |
| GET / POST | `/api/agents/:id/triggers` | List / create. |
| GET | `/api/agents/:id/sessions/messages` | SSR transcript replay (the JSONL contents rendered as `ProviderMessage[]`). |
| GET | `/api/agents/:id/sessions/head` | Latest session metadata for the stale-banner poller. |
| GET / POST / DELETE / PATCH | `/api/agents/:id/memory*` | qmd-backed memory CRUD + search (`/search`, `/[...key]`). Note: writes to the **team's** shared memory, not a per-agent store. |

**Teams** (`routes/teams.ts`): `GET / POST /api/teams`, `GET / DELETE /api/teams/:id`, `PUT /api/teams/:id/user-md`. POST body is `{id (slug), name?, link?}` — no `path` field; the daemon picks `paths.teamDir(id)`.

**Messages** (`routes/messages.ts`): `GET / PATCH /api/messages/:id` — detail + mark-read.

Agent messages retain durable causal ancestry (`causal_chain_id`, `causal_hop`).
`sendAgentMessage` enforces `BAZILION_AGENT_LOOP_MAX_HOPS` before insertion,
independently of Team Policy. Inbox-wake turns pass a causal parent into their
turn-scoped `MessagingHost`, preventing a model from resetting the budget by
omitting `reply_to`. Stops are stored without payloads in
`agent_loop_break_events` and exposed through the Agent API, CLI, and inbox UI.

**Profiles** (`routes/profiles.ts`): list, create (POST, seeds markdown files), get, update (PATCH: name, default_model, skills_mode, default_skills), delete. Profile-file editing: `GET / PUT /api/profiles/:id/files/:file` where `:file` is whitelisted to `PROFILE_FILES`. `GET /api/profiles/_/templates` returns the default SOUL/IDENTITY/BOOTSTRAP/AGENTS/TOOLS strings.

**Skills** (`routes/skills.ts`): `GET /api/skills` (discovered + parsed + metadata), `POST /api/skills/import` (multipart zip or JSON body with path/source), `DELETE /api/skills/:name`.

**Triggers** (`routes/triggers.ts`): `PATCH / DELETE /api/triggers/:id` (enable/disable + patch).

**Config** (`routes/config.ts`):
- `GET /api/config/providers` — provider cards: per-provider `{ enabled, configured, curatedModels, liveModels?, envHints }`. Live-models lookup hits the provider's `/v1/models` when possible.
- `GET /api/config/services` — same shape for non-LLM services (Brave, SearXNG).
- `GET /api/config/available-models` — provider-grouped curated models for dropdowns.
- `PUT /api/config/fields/:envVar` — dispatch to `config` or `secrets` table via `isConfigKey`.
- `PUT /api/config/providers/:name/enabled` — set `provider_state.enabled`.
- `PUT /api/config/providers/:name/models` — replace the curated list. **Both this and the enabled toggle call `ensureSetupSeeded(db, paths)` after the write** — that's what fires the 0→1 seed.

**Auth** (`routes/auth-login.ts`): `POST /api/login` normally exchanges a device credential for
secure session and CSRF cookies. While setup is incomplete it may instead accept the bootstrap
secret, create an internal expiring/revocable device identity, and issue the same bounded session;
the bootstrap secret is never placed in browser cookies. `POST /api/logout` revokes that session;
`GET /api/auth/whoami` proves the authenticated principal; `GET / DELETE /api/sessions[/:id]`
manages browser sessions. OAuth and provider-test routes remain daemon-owned.

**Misc** (`routes/misc.ts`): public `GET /api/health` returns liveness only; protected `GET /api/health/details` returns `HealthReport`. Backup remains a verified SQLite snapshot. Token endpoints create expiring device credentials and expose bounded metadata; revocation invalidates derived sessions. The explicit bootstrap kind cannot be revoked.

### 4.5 Chat streaming path in detail

```
POST /api/agents/:id/chat   body = {message, bashApprovalMode?}
   │
   ▼
 routes/agents.ts: resolveAgentIdParam()  // prefix → UUID
   │
   ▼
 runAgentTurn(id, message)  [apps/daemon/src/lib/agent-turn.ts]
   │
   │  resolveAgent(db, paths, id)                       // joins agent+profile+team+skills
   │  enabledProviders = providerStateRepo.listEnabled(db)
   │  env = mergeSecretsIntoEnv(db, authToken)          // process.env > secrets > config
   │  apiKey = resolveAgentApiKey(db, authToken, agent) // OAuth pre-fetch for openai-codex
   │  messagingHost = createDbMessagingHost(db)         // for the IPC handler
   │  registerAgent(agentId, controller)                // cancel registry (keyed by agentId)
   │
   ▼
 spawnWorkerTurn(spec, opts)  [apps/daemon/src/runtime/worker/spawn.ts]
   │
   │  stdio: pipe/pipe/inherit/ipc
   │  stdin: JSON.stringify({agent, message, enabledProviders, apiKey, turnId, bashApprovalMode})
   │  child.on('message', ...) → dispatch via daemon hosts → child.send(reply)
   ▼
 node --import <tsx-loader-URL> apps/daemon/src/runtime/worker/entry.ts
   │
   │  (full turn — see agent-engine.md §2–§5)
   │
   │  worker tool calls for messaging:
   │     process.send({type:'rpc', id, method:'sendMessage', args})
   │     ← child.send({type:'rpc-reply', id, ok:true, result})
   │
   ▼
 stdout NDJSON:
   {kind:'event', event:{type:'user_message',...}}
   {kind:'event', event:{type:'assistant_delta', delta}}
   ... more deltas ...
   {kind:'event', event:{type:'assistant_message', text}}
   {kind:'event', event:{type:'tool_call', ...}}
   {kind:'event', event:{type:'command_approval', approval:{status:'pending',...}}}
   ... POST /api/shell-approvals/:id while this stream stays open ...
   {kind:'event', event:{type:'command_approval', approval:{status:'allowed'|'denied'|...}}}
   {kind:'event', event:{type:'tool_result', ...}}
   {kind:'done', messages:[...]}
   │
   ▼
 agent-turn.ts line-buffers stdout → yields ChatFrame
 In finally: unregisterAgent(agentId)
   │
   ▼
 route serializes each frame as "{...}\n" and writes to the Hono streamed body
   │
   ▼
 client (CLI or browser via web's /api/$ proxy): line-buffered NDJSON parser
```

Cancellation: `POST /api/agents/:id/cancel` → `cancelAgent(id)` → the stored `controller.abort()` → `spawn.ts`'s abort handler `child.kill('SIGTERM')` → child's signal handler aborts its internal controller → pi unwinds the provider fetch → translator emits `{type:'error', error:'cancelled'}` → child emits `done` → parent `unregisterAgent`. There is no per-run row to update — pi's session JSONL records the partial assistant message + the error event as the last entries on the branch.

## 4b. `apps/web` — the browser UI (TanStack Start)

React 19 + Vite 8 + Tailwind v4 + shadcn/ui. File-based routes via `@tanstack/react-router`; `src/router.tsx` exports `getRouter`. Server fns use `.inputValidator()`. Bound to `127.0.0.1:4322` by default (`WEB_HOST` / `WEB_PORT`).

**Daemon-only client** — `apps/web` never reaches into daemon source. Loaders forward the host-only session and CSRF cookies to the loopback daemon; they never translate browser credentials into bearer tokens. Native clients continue to send device bearers through `@bazilion/client`.

**`daemon-client.ts` is server-only** — Vite's import-protection rejects `@tanstack/react-start/server` in any module that ends up in the client bundle. Client-safe wire constants live in `apps/web/src/lib/wire-constants.ts` (`DEFAULT_TEAM_ID`, `DEFAULT_PROFILE_ID`, `REASONING_LEVELS`).

Browser fetches hit relative `/api/*`. The `/api/$` catch-all validates the canonical origin,
enforces session-bound CSRF on unsafe requests, strips forwarding and hop-by-hop headers, bounds
bodies, forwards only the session cookies, and streams daemon responses back. This preserves chat
NDJSON without turning a browser session into a bearer.

**Markdown rendering**: chat output goes through `marked` + DOMPurify (`apps/web/src/lib/md.ts`); the rendered HTML lands in divs with class `md-content`. Typography rules for that class live in `apps/web/src/styles.css` (headings, lists, code, pre, blockquote, table). Without those rules, Tailwind preflight strips list markers + header sizes etc., so chat reads as flat plain text.

Routes (under `src/routes/`):

| Route | Purpose |
|---|---|
| `__root.tsx` | Root layout + `beforeLoad` auth/setup gate. |
| `index.tsx` | Homepage with sidebar + spawn dropdown. |
| `login.tsx` | Token paste form. |
| `welcome.tsx` | First-run setup landing. |
| `agents/index.tsx` + `agents/$id/{index,memory,inbox,triggers}.tsx` | Agents UI. |
| `profiles/{index,$id}.tsx` | Profile list + 2-tab editor (basics / skills). After-save `router.invalidate()` keeps `useLoaderData()` fresh on tab toggles. |
| `teams/{index,$id}.tsx` | Team list (slug + optional `--link` target form) + per-team USER.md editor + member roster. |
| `skills/index.tsx` | Skill library (import card + installed list). |
| `config/{index,services,tokens}.tsx` | Provider config / service config / token management. The bootstrap row in `tokens.tsx` is badged `auth.json` and has its revoke button hidden. |
| `api/$.ts` | Hardened same-origin session-cookie reverse proxy. |

## 5. `apps/cli` — the command-line client

Citty-based. Two "modes":

- **Direct mode** (no HTTP): `uninstall`, `serve`, `dashboard`, `login`, `backup restore`, `backup inventory`, `backup rotate-bootstrap`, `backup recovery-guide`, `token show-local`. These operate on the filesystem directly so they work when the daemon isn't running. Restore opens only its decrypted/extracted staging DB, never the live source DB, and holds the same realpath-keyed sibling ownership record that the daemon acquires before opening SQLite. Bootstrap rotation copies and snapshots the home into private sibling staging, re-encrypts every secret under a new bootstrap, revokes non-bootstrap tokens, validates and syncs the pair, then uses the same recoverable whole-home swap.
- **Client mode** (HTTP): everything else, including `backup create`. The daemon returns the existing authenticated plaintext tar stream; the trusted CLI validates it while streaming it through an age recipient envelope and never sends the recovery identity to the daemon. Talks to the daemon via `src/client.ts` (which wraps `@bazilion/client`).

### 5.1 Entry — `src/index.ts`

Registers the subcommand tree: `serve · dashboard · login · profile · team · agent · skill · memory · provider · send · inbox · config · doctor · backup · trigger · token · auth · uninstall · completion`. Custom `printTopLevelHelp()` renders a grouped layout (setup / catalog / agents / ops / remote / shell) instead of citty's default flat help.

Top-level error handler catches `ApiClientError` subclasses (401 token mismatch, 403 origin mismatch) and low-level network errors (`ECONNREFUSED`, `ENOTFOUND`) with friendly hints ("is the daemon running? `bazilion serve`").

### 5.2 Client — `src/client.ts`

`loadClientConfig()` resolves, in order:
1. `$BAZILION_SERVER + $BAZILION_TOKEN` — for remote daemons.
2. `auth.json:remote.{server,token}` — set by `bazilion login`.
3. `http://127.0.0.1:4321` + `auth.json:token` — local default.

The result is wrapped with `createClient({serverUrl, token})` from `@bazilion/client`, which returns `{ get, post, put, patch, del, postMultipart, stream }`. All requests send `Authorization: Bearer <token>` + `Origin: <serverUrl>`.

`stream(method, path, body)` is an async generator: fetches the endpoint, parses NDJSON line-by-line from the response body, yields `T` per line. This is what `bazilion agent chat` uses.

### 5.3 Commands

| File | Subcommands | Endpoint(s) |
|---|---|---|
| `serve.ts` | `serve [--port N] [--host H]` | (direct) — spawns `apps/daemon/src/index.ts` under `node --import tsx/esm`. On first run the daemon auto-bootstraps `~/.bazilion` (mkdir, migrate, mint bootstrap token to `auth.json`) before binding the port. |
| `dashboard.ts` | `dashboard [--port N] [--no-open]` | (direct) — reuses or starts the daemon, starts the bundled TanStack Start web server from `dist/web`, prints the dashboard URL + auth token path, and opens the browser by default. |
| `uninstall.ts` | `uninstall` | (direct) — two-tier teardown (reset vs full). Both tiers remove `bazilion.db*`, its paired `auth.json`, profiles, Agents, Teams, and the legacy `groups/`, `config.json`, and `secrets.enc` paths; managed symlink slots are unlinked without traversing their external targets. `--all` additionally removes logs and skills, then removes a real home when no unmanaged entries remain; a symlinked home root stays as an empty stable slot for interruption recovery. |
| `login.ts` | `login` | (direct) — writes `auth.json:remote` (or `--clear` to remove it). |
| `token.ts` | `create / list / revoke / show-local` | `/api/tokens/*`. `show-local` reads the bootstrap token from local `auth.json`. |
| `agent.ts` | `spawn / edit / list / show / chat / archive / unarchive / delete / move / cancel / skill / chat-{reset,trim,context,compact} / session-head` | `/api/agents*` — `chat` drains NDJSON from `/api/agents/:id/chat`; `cancel` POSTs to `/api/agents/:id/cancel`. |
| `profile.ts` | `create / list / show / edit / update / delete` | `/api/profiles*`. |
| `team.ts` | `add [--link] / list / rm / user-md {show,set,clear}` | `/api/teams*`. |
| `skill.ts` | `list / import / rm` | `/api/skills*` (import uses multipart). |
| `provider.ts` | `list / enable / disable / models / models-set / test` | `/api/config/providers*`, `/api/providers/test`. |
| `config.ts` | `get / set` | `/api/config/fields/:envVar`. |
| `auth.ts` | `openai login / logout / status` | `/api/auth/openai*` (login runs the OAuth loopback flow client-side, then PUTs credentials). |
| `send.ts` | `send` | `POST /api/agents/:id/messages`. |
| `inbox.ts` | `list / show / read` | `/api/agents/:id/messages`, `/api/messages/:id`. |
| `trigger.ts` | `add / list / rm / enable / disable / update` | `/api/agents/:id/triggers`, `/api/triggers/:id`. |
| `memory.ts` | `list / read / write / search / rm` | `/api/agents/:id/memory*` (writes to the team's shared store). |
| `backup.ts` | `create / restore` | `/api/backup` (online SQLite snapshot download); restore validates a private archive copy, auth/DB pairing, complete canonical schema, SQLite integrity/FKs, then swaps staged state into `--home` with rollback under exclusive per-home ownership (offline target only). |
| `doctor.ts` | `doctor` | `/api/health` + local checks. |
| `completion.ts` | `completion <shell>` | (direct) — prints bash/zsh/fish completion script. |

## 6. Cross-cutting flows

### 6.1 Serve + first-run bootstrap

```
bazilion serve [--port N] [--host H]
  └─ spawn('node', ['--import', 'tsx/esm', 'apps/daemon/src/index.ts'])
```

The daemon's `apps/daemon/src/index.ts` eagerly calls `getCtx()` before `serve()` so the bootstrap message + `auth.json` land before the HTTP port binds:

```
getCtx()
  └─ bootstrap()
       └─ require bazilion.db + auth.json to be both present or both absent
       └─ on a fresh pair, mkdir ~/.bazilion + {profiles,agents,skills,teams,logs}
       └─ openDb + runMigrations (reject an incompatible alpha schema)
       └─ if both identity artifacts were absent:
            webTokenRepo.create(db, 'bootstrap') → randomBytes(24).toString('hex')
            writeFile auth.json {token}          → mode 0600
       └─ otherwise verify auth.json matches an active bootstrap row
       └─ cache authToken in getCtx() for PBKDF2-seeding the secrets table
       └─ startScheduler  (unless BAZILION_SCHEDULER=off)
```

Idempotent: existing current installs short-circuit the mkdir + token-mint steps. A missing identity
half or incompatible alpha schema fails before the listener and background services start.

The web UI is **not** booted by `serve`. Published installs use `bazilion dashboard`, which spawns `dist/web-server.js` against the copied production build in `dist/web`. Source development still usually runs the Vite dev server separately with `cd apps/web && pnpm dev`.

### 6.2 Login / auth

**Local**: the daemon's first-run bootstrap mints the bootstrap row + writes its plaintext to `auth.json:token` (see §6.1); every subsequent CLI call reads it and sends `Authorization: Bearer <token>`. Daemon validates against `web_tokens.findActiveByToken`.

**Remote**: `bazilion login --server https://host --token <token>` writes `{remote:{server,token}}` to `auth.json`, or the user exports `$BAZILION_SERVER` + `$BAZILION_TOKEN`. `client.ts` picks those up.

**Browser**: normal login POSTs a separately minted device token to `/api/login`. During a fresh
install, and only until provider setup completes, the route also accepts the `auth.json` bootstrap
secret. That exceptional exchange creates an internal device identity whose expiry matches the
session's absolute bound and whose revocation invalidates the derived session. In both cases the
daemon returns an opaque bounded session cookie plus a readable, independently random CSRF cookie;
neither source bearer is stored in the browser cookies. Production uses Secure, Strict, host-only
`__Host-` cookies. The gateway validates exact Host and Origin, adds no client identity, strips
forwarding headers, and proxies the cookies only to the loopback daemon. Once setup completes, the
bootstrap secret is rejected and named device credentials are the only browser-login credentials.

**Mobile**: pairing via `bazilion token create <label> --qr` mints a device token + emits
`bazilion://pair?server=<url>&token=<t>` as a QR code. The URL identifies the supported private
HTTPS web gateway, never the loopback daemon. The mobile app stores the credentials in
`expo-secure-store` and uses `@bazilion/client` directly with the bearer. Direct daemon exposure,
direct LAN access, public reverse proxies, and Tailscale Funnel are unsupported.

### 6.3 Chat turn (CLI)

```
bazilion agent chat <id>               # interactive REPL
 ↓ reads user line
client.stream('POST', '/api/agents/:id/chat', {message})
 ↓ HTTP NDJSON body
server: runAgentTurn → resolve + pre-fetch apiKey → spawnWorkerTurn → node worker entry
 ↓ stdout NDJSON (worker → daemon over the parent's stdout pipe)
   plus IPC RPC for daemon-owned tools and shell approval (worker → daemon over fd 3)
server: pipe to response body
 ↓
client: yield ChatFrame, pretty-print deltas/tool_calls/tool_results
```

### 6.4 Chat turn (web UI)

```
ChatPane.tsx (React) onSubmit
 ↓ fetch('/api/agents/:id/chat', {method:'POST', body:{message}})
 ↓ web's /api/$ catch-all proxies to daemon (cookie → bearer, body streams through)
 ↓ same daemon path as CLI — runAgentTurn → subprocess → NDJSON
 ↓ ReadableStream consumer parses + renders deltas via marked + DOMPurify (md-content typography in styles.css)
```

### 6.5 Scheduler fire

```
setInterval(5s) tick
 ↓
triggerRepo.listEnabled(db)
 ↓ filter isDue(t, now, cronCache)
 ↓ per due trigger, when it has no open dispatch:
    triggerDispatchRepo.materialize(triggerId, agentId, scheduledOccurrence)
      ← unique(trigger_id, scheduled_at); durable pending work
    triggerRepo.markFired(triggerId, scheduledOccurrence)
      ← scheduling watermark, not execution status
 ↓ triggerDispatchRepo.listClaimable(now)
 ↓ per pending/retrying dispatch or expired running lease:
    acquire Agent lifecycle lease
    triggerDispatchRepo.claim(dispatchId)   ← transactional running lease
    busy Agent → defer without consuming an attempt
    otherwise authorize
      approval required → defer; operator grants this captured occurrence
      allowed/granted → runAgentTurn(agentId, trigger.message)
      success → succeeded
      fatal/provider error → retrying with backoff, then failed at the attempt bound
```
Only one open dispatch is retained per trigger, so missed interval occurrences coalesce while
an Agent is busy or a retry is pending. An expired running lease makes an abandoned attempt
claimable after daemon restart. The same worker-spawn path as HTTP is used; Pi's session JSONL
remains the content transcript, while `trigger_dispatches` contains operational delivery
metadata only. Approval does not execute a scheduled turn inside the HTTP request: it durably
grants the captured dispatch, which the scheduler revalidates and executes on a later tick.

### 6.6 Provider test

```
bazilion provider test --model anthropic:claude-opus-4-6 --message "ping"
 ↓
POST /api/providers/test {model, message?}
 ↓
server:
  env = mergeSecretsIntoEnv(db, authToken)
  reg = createProviderRegistry(loadProviderConfigFromEnv(env, {db, authToken}),
                              {enabledSet: providerStateRepo.listEnabled(db)})
  {provider, model} = reg.resolve(modelString)
  resp = await provider.chat({system:'', messages:[{role:'user',content:message}]})
 ↓
{content, usage}
```

### 6.7 First-run seed (the 0→1 moment)

```
user configures ANTHROPIC_API_KEY via /config
 ↓ PUT /api/config/fields/ANTHROPIC_API_KEY  → openSecrets(db, authToken).set(...)
user enables the provider
 ↓ PUT /api/config/providers/anthropic/enabled  {enabled:true}
      → providerStateRepo.setEnabled('anthropic', true)
      → ensureSetupSeeded(db, paths)
      → isSetupComplete(db)? still false (no curated model) → noop
user curates a model
 ↓ PUT /api/config/providers/anthropic/models {models:['claude-opus-4-6']}
      → providerModelRepo.replace('anthropic', [...])
      → ensureSetupSeeded(db, paths)
      → isSetupComplete(db)? NOW true
      → seedDefaults(db, paths, {model:'anthropic:claude-opus-4-6'})
          → registerTeam({id:'default', name:'Default'}, paths)
              (mkdir paths.teamDir('default') + memory/)
          → createProfile({id:'default', name:'Default',
                           defaultModel:..., skillsMode:'all'})
 ↓
middleware: isSetupComplete → true → /welcome redirect stops
homepage: sidebar shows "+ new ▾" dropdown with the 'default' profile floated to top
```

### 6.8 Inter-agent messaging (worker via IPC)

**Send from inside a turn**:
```
agent-A's worker invokes send_message({to:'agent-B', text:'…'})
 ↓
messagingTools (runtime, MessagingHost interface)
 ↓
process.send({type:'rpc', id, method:'sendMessage', args:{from, to, payload, replyTo}})
 ↓                                                           (over fd 3 IPC)
daemon: child.on('message') dispatches via createDbMessagingHost(db)
 ↓
messageRepo.send(db, ...) → SQLite row inserted
 ↓
child.send({type:'rpc-reply', id, ok:true, result:{messageId}})
 ↓
worker awaits the reply in createIpcMessagingHost; tool returns "sent message <id>"
```

**Read** (`read_inbox`) and **wait** (`wait_for_reply`) follow the same IPC pattern.

**From outside** (web UI or CLI):
```
bazilion send <from> <to> "text"
 ↓ POST /api/agents/:to/messages {from, text, replyTo?}
 ↓ messageRepo.send(...) — daemon-side, no IPC needed
```

**Inbox reads**: `GET /api/agents/:id/messages?unread=1`, `GET /api/messages/:id`, `PATCH /api/messages/:id {read:true}`. CLI `inbox list/show/read` wraps these.

## 7. Invariants you can rely on

- **Daemon is sole live owner of `~/.bazilion`**: workers don't open `bazilion.db`. Before opening SQLite, the daemon acquires a hashed, realpath-keyed ownership record beside the home. CLI restore acquires that same stable sibling for its full validation/install/rollback window and opens only the extracted staging DB read-only for integrity, foreign-key, complete-schema, and auth-token checks. Restore persists `swapping` before its first rename and `installed` after the new home is durable; a dead `swapping`/`recovery-required` record blocks startup with the retained recovery path. Graceful daemon shutdown closes SQLite before removing ownership. The web UI never touches the DB directly.
- **One owner of LLM traffic**: the worker subprocess. The daemon never calls `provider.chat` in its own event loop.
- **One agent, one team**: enforced by `agents.team_id NOT NULL REFERENCES teams(id) ON DELETE RESTRICT`. To delete a team with members, move them first.
- **Memory is team-shared**: every agent in the team reads + writes the same qmd index at `<team.path>/memory/`.
- **`apps/web` never reaches into daemon source**: every data access goes through HTTP, including SSR loaders. Wire shapes are imported from `@bazilion/api-types`.
- **`daemon-client.ts` is server-only**: any module ending up in the client bundle imports from `wire-constants.ts` instead.
- **Env vars win over stored secrets**: for debugging / override, a shell export always takes precedence over the `secrets` and `config` tables.
- **Shell controls are explicit, independent, and fail-closed**: the default `off` modes preserve host coding tools. In `docker` mode there are no host-backed coding tools, and `bash` runs only in the bounded local-image container described above. A configuration, Docker, image, or mount error never downgrades to host execution. With dangerous-command approval enabled, classified commands require a one-shot web/TTY decision; callers without an interactive response path auto-deny.
- **Bootstrap token can't be revoked**: `DELETE /api/tokens/:id` rejects (409) when the requested id matches `getCtx().authToken`'s hash.
- **HMR-safe singletons**: `agent-cancel`, `scheduler` are pinned on `globalThis[Symbol.for(...)]` so dev-mode module reloads don't double them.
- **Pi owns the transcript**: there is no `chat_messages` blob, no `runs`/`events` audit layer. Conversation state lives in `~/.bazilion/agents/<id>/sessions/<sessionId>.jsonl` under pi-coding-agent's `SessionManager`.
- **Worker IPC is fd 3**: the worker spawns with `stdio: ['pipe', 'pipe', 'inherit', 'ipc']`. Stdin = turn spec. Stdout = worker NDJSON `ChatFrame`. Stderr = inherited. fd 3 = JSON RPC for daemon-owned tools and shell approval; the parent injects approval state into the same yielded frame stream.
- **CLI ↔ web parity**: every endpoint has both a CLI command and a web UI surface. If you add one without the other, you haven't shipped the feature.
