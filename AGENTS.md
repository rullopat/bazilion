# AGENTS.md

This is the canonical cross-platform guidance for AI coding agents working in this repository.
Codex reads it directly; Claude Code imports it from `CLAUDE.md`.

## Dev commands

Supported Node lines are **24.22.0+ within 24.x or 26.4.0+ within 26.x**
(`^24.22.0 || ^26.4.0`). Earlier/other lines are refused before bootstrap because the native
cleanup-hook API needs the upstream fix. CLI/daemon launchers must guard before linking payloads;
keep manifests, guards and CI aligned. pnpm 10+ is the package manager. Everything runs via `tsx`,
pinned as a root dev-dependency.

```sh
pnpm install
pnpm test              # vitest run across the whole tree
pnpm security:acceptance # deterministic 0.13 adversarial security release gate
pnpm typecheck         # root tsc --noEmit plus web typecheck
pnpm lint              # biome check
pnpm format            # biome check --write
```

Running a single test: `pnpm vitest run apps/daemon/test/core/agents.test.ts` (or `pnpm vitest -t 'pattern'`).

Running the CLI locally (no build step — `tsx` executes `.ts` directly):

```sh
pnpm tsx apps/cli/src/index.ts <subcommand>
# e.g. pnpm tsx apps/cli/src/index.ts agent chat <uuid> --message "say hi"
#      pnpm tsx apps/cli/src/index.ts serve        # boots the daemon (web UI runs separately)
```

`README.md` has the full user-facing quickstart (`bazilion serve` auto-bootstraps `~/.bazilion` on first run → start the web UI on :4322 → finish first-run setup on /config → spawn from the auto-seeded `default` profile).

## Architecture

pnpm workspaces monorepo. **Three supported apps** (cli, daemon, web), **two packages** (api-types, client).

The **daemon** (`apps/daemon`) is the single owner of `~/.bazilion` AND the LLM/tool stack. It's also the only place server-side code lives — there's no `@bazilion/core` or `@bazilion/runtime` package; that code is internal to the daemon under `apps/daemon/src/core/` (DB schema, repos, domain ops, paths, secrets, services, skills) and `apps/daemon/src/runtime/` (pi adapter, providers, memory, tools, worker, sessions). Every other process — CLI, web frontend SSR, mobile app, future browser SPA — talks to the daemon over HTTP. **Workers spawned per turn don't hold their own DB handle either** — they receive pre-resolved data on stdin and round-trip live messaging back to the daemon over Node IPC.

Three invariants:

1. **Nothing outside `apps/daemon` imports daemon-internal code at runtime.** Clients talk to the daemon over HTTP via `@bazilion/client` + `@bazilion/api-types`. The CLI's tests are the one pragmatic exception: they reach into `apps/daemon/src/...` via relative imports for setup/inspection. No other consumer should follow that pattern.
2. **The daemon owns the DB, scheduler, agent-cancel registry, secrets table, and the bootstrap token in auth.json.** Other processes are stateless clients.
3. **The daemon self-bootstraps on first `bazilion serve`** — there is no `bazilion init` command. `apps/daemon/src/lib/ctx.ts:bootstrap()` runs idempotently at startup: when both `bazilion.db` and `auth.json` are absent it creates `~/.bazilion/{profiles,agents,skills,teams,logs}`, opens the DB, runs migrations, mints a bootstrap web_tokens row, and writes the plaintext to `auth.json`. If exactly one half of that identity pair exists, startup fails closed with reset guidance.

- **`packages/api-types`** — **hermetic** wire-shape package. Owns the canonical type definitions for everything that crosses the HTTP/IPC wire: entity shapes (`Agent`, `Team`, `Profile`, `Message`, `WebToken`, `AgentTrigger`, `ResolvedAgent`, `LoadedProfile`, `OpenAICodexStatus`, …) in `entities.ts`, chat/provider events (`ChatFrame`, `SessionEvent`, `ProviderMessage`, `ToolCall`, `ToolDef`) in `events.ts`, memory wire types in `memory.ts`, and request/response envelopes + `PROFILE_FILES` in `index.ts`. **Zero deps** — no node-only modules, no daemon code. The daemon imports its entity/wire types FROM here; that's what keeps `apps/web`, `apps/mobile`, and `@bazilion/client` from ever reaching Node-only code (`node:sqlite`, undici, pi-ai, the worker spawner).
- **`packages/client`** — HTTP client for cross-origin native consumers that need explicit device bearer auth. The web UI remains same-origin and uses daemon-owned session/CSRF cookies instead.

### Auth model

The daemon owns `web_tokens` and `web_sessions`. Native clients use active bootstrap/device bearers; browser login accepts device credentials only and exchanges them for a hashed bounded session plus session-bound CSRF. Public paths are exactly `/api/login` and minimal `/api/health`; detailed health and owner identity are protected.

The bootstrap token is the plaintext stored in `~/.bazilion/auth.json` — written there by the daemon's self-bootstrap on first `bazilion serve` (`apps/daemon/src/lib/ctx.ts:bootstrap()`) alongside its hash inserted into `web_tokens` (label `bootstrap`). Both the CLI (loopback bearer) and the daemon (PBKDF2 seed for the secrets table) read this file. **Do not allow revoking the bootstrap row**: `DELETE /api/tokens/:id` rejects (409) when the requested id matches the auth-token's hash, and the web UI hides the revoke button for that row. Otherwise the operator could lock themselves out.

**SSR cookie-forward**: server fns inside `apps/web/src/lib/daemon-client.ts` forward the session and CSRF cookies unchanged to the loopback daemon. They never convert browser sessions into bearer credentials. Native clients send device bearers via `@bazilion/client`.

### Mobile / LAN notes

The daemon and web application remain loopback-only. `BAZILION_PUBLIC_ORIGIN` activates the strict production gateway profile; Tailscale Serve publishes only the web listener over private HTTPS. QR pairing uses that exact origin and a separately minted expiring device credential. Funnel and direct daemon exposure are unsupported.

### Native clients

The Expo app was removed (BAZ-053); no native iOS/Android app is currently shipped or committed.
Leftover local/generated `apps/mobile` artifacts are not a supported application. Keep
`@bazilion/api-types` hermetic and native consumers on HTTP through `@bazilion/client`;
never add runtime imports of daemon internals.

- **`apps/cli`** — thin citty-based CLI. Every subcommand except `serve` talks to the daemon over HTTP via `@bazilion/client`. No direct DB access in the CLI's runtime path. The two filesystem-level commands are: `serve` (boots `apps/daemon` directly — the daemon then auto-bootstraps `~/.bazilion`); `uninstall` (two-tier teardown: reset vs. full — operates on the filesystem so it works even when the daemon isn't running). Local helpers `apps/cli/src/paths.ts` (`resolveCliPaths`) and `apps/cli/src/auth-file.ts` (`readAuthFile` + `AuthFile` type) duplicate just enough of the daemon's path/auth utilities for these filesystem-touching commands. The web UI runs separately during dev: `cd apps/web && pnpm dev`. Remote daemon is opt-in via `BAZILION_SERVER` + `BAZILION_TOKEN` env vars; otherwise the client reads `auth.json` and hits `http://127.0.0.1:4321`.

- **`apps/daemon`** — Hono on `@hono/node-server`, binds `127.0.0.1:4321` by default (`HOST`/`PORT` env override). Owns all server-side code under one roof:
  - `src/index.ts` — entry: eagerly calls `getCtx()` so the bootstrap message + auth.json land before the port binds, then starts Hono.
  - `src/lib/` — daemon-only glue: `ctx.ts` (singleton + self-bootstrap), `middleware-auth.ts`, `auth.ts`, `agent-cancel.ts`, `agent-id.ts`, `agent-turn.ts`, `api-key.ts`, `cron.ts`, `messaging-host.ts`, `scheduler.ts`.
  - `src/routes/` — HTTP routes by resource family: `agents.ts` (CRUD + team + skills + triggers + messages + sessions + chat NDJSON + `/cancel`), `teams.ts` (CRUD + USER.md + per-team shared memory at `/api/teams/:slug/memory*`), `profiles.ts`, `skills.ts`, `triggers.ts`, `messages.ts`, `config.ts`, `auth-login.ts` (ChatGPT OAuth + `/providers/test` + `/login`), `misc.ts` (`/health`, `/backup`, `/tokens`).
  - `src/core/` — what used to be `packages/core`: SQLite schema + migrations (`db/`), repos (`repos/`), domain ops (`agent/`, `team/`, `profile/`, `skills/`), `paths.ts`, `secrets.ts`, `services.ts`, `availableModels.ts`. Barrel export at `src/core/index.ts`.
  - `src/runtime/` — what used to be `packages/runtime`: pi-coding-agent integration (`pi/`), provider adapters (`providers/`), memory backends (`memory/`), Bazilion-specific tools (`tools/`), per-turn worker subprocess (`worker/{entry,spawn,ipc-protocol}.ts`), OpenAI Codex OAuth (`auth/`). Barrel export at `src/runtime/index.ts`.
  - Auth + first-run middleware (`src/lib/middleware-auth.ts`) gates every route; public paths whitelisted inside the middleware. The daemon installs its own SIGINT/SIGTERM handlers and shuts the HTTP server gracefully.
- **`apps/web`** — TanStack Start frontend and the only supported remote gateway. SSR and browser requests forward bounded session/CSRF cookies to the loopback daemon through a hardened same-origin proxy. **CLI/web parity is mandatory** for management endpoints.

### Embedded Pi ownership

The daemon and packed CLI pin the embedded Pi engine to **1.4.0**, shipped in 0.24.0. SDK sessions do not
implicitly enable Pi's CLI MCP/codemode/tool-search extensions. Keep explicit tool admission,
in-memory credentials/settings, `modelsPath: null`, `allowModelNetwork: false` and
`cacheWarming: 'off'`; do not add implicit provider requests or ambient resource discovery.
Research qualification defaults to `openai-codex:gpt-6.1-sol` / medium when explicitly selected;
this does not rewrite existing Agent/Profile choices or prove search entitlement.

MCP uses Pi's standalone `@earendil-works/pi-mcp@1.4.0` **inside the daemon**, not worker
extensions. Legacy SSE is retired across the schema/API/CLI/web; prior schemas need clean
rebootstrap, never ALTER/import/fallback adapters. Keep turn-specific tool/config/credential
revalidation, no POST/tool-call replay, opening-client retirement, busy reaping and ownership
until close settles. Linux `stdio-owner.ts` retains the surviving-descendant close guard with Pi 1.4;
unknown identity/cleanup retains a blocked slot. Published 0.24 stdio admission refuses off-Linux.
Unreleased BAZ-072 adds a macOS candidate using daemon-only public libproc inspection through
pinned `koffi@3.3.3` (install scripts disabled). Preserve exact BSD and monotonic Mach birth facts,
uid/session/group revalidation, bounded lists and unknown-state refusal before spawn or signalling;
never substitute shell `ps`, a native-availability label, persisted PIDs or Pi's unsafe close path.
The binding stays out of workers and is never loaded on Linux. Streamable HTTP remains available.
See `docs/mcp.md` and `docs/pi-runtime.md`.

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

Path resolution is centralized in `apps/daemon/src/core/paths.ts`. The `Paths` struct has `home`, `db`, `authFile`, `profilesDir`, `agentsDir`, `teamsDir`, `skillsDir`, `logsDir`, plus `agentDir(id)` / `teamDir(slug)` / `profileDir(id)` / `skillDir(name)` computed helpers. The CLI has its own minimal `apps/cli/src/paths.ts` (`resolveCliPaths` returns just `{home, authFile}`) for the filesystem-level commands (`uninstall`, `backup`, `login`, `token show-local`) — they don't need the full struct. **There is no longer a `configFile` field — `config.json` and `secrets.enc` were collapsed into the DB.** `bazilion uninstall` mirrors this layout as a two-tier teardown: the reset tier removes the DB, its paired `auth.json`, `profiles/`, `agents/`, `teams/`, and obsolete `groups/`, `config.json`, and `secrets.enc` paths; full wipe additionally removes `logs/` and `skills/`. A symlinked `BAZILION_HOME` root remains as an empty slot so its canonical ownership identity survives interruption; symlinked Team/legacy Group slots are unlinked without touching their external targets.

### Team registration

Teams always live at `~/.bazilion/teams/<slug>/`. The CLI (`bazilion team add <slug> [--link <target>]`) and the web `/teams` create form pass only the slug + optional name + optional link target; the daemon decides where the slot goes. `--link <abs-path>` materializes the slot as a symlink to an existing directory (the "agents working on my existing project tree" path); the target must exist and be a directory. Without `--link`, a fresh real directory is created. `teamRepo.get/list/insert(db, ..., paths)` derive `Team.path` from `paths.teamDir(id)` at read time — there is no `path` column anymore.

### Repository context (BAZ-039, shipped in v0.16.0)

The daemon resolver under `src/lib/repository-context/` prepares bounded Team-relative repository
instructions and passive Git/command context. `GET /api/teams/:id/repository-context`,
`bazilion team context`, and the Team page share hermetic report types. Normal/protected coding
workers receive admission snapshots and can request targeted refresh through `repositoryContext`
IPC / Pi's `repository_context` tool. Pi's public resource-loader interface consumes supplied
context; automatic context/extension/skill discovery remains disabled. Private Agent documents
are labelled Agent instructions, separately from repository guidance. Restricted reviews gain no
repository capability. See `docs/repository-context.md` and
`docs/backlog/done/BAZ-039-repository-coding-context.md` for limits and accepted scope. Do not treat context fingerprints as code checks.

Shipped in **0.24.0**, BAZ-057 adds macOS ordinary chat through a shared capture
adapter using public `@openclaw/fs-safe@0.26.8` APIs. Preserve Linux fd-relative access;
macOS guarded opens need capture-wide registration/directory/file/absence checks, not a
native-mode label or an atomic-snapshot claim. In that release, hardened Git and MCP stdio remain Linux-only.
In 0.24, macOS worker settlement requires live ChildProcess authority, normal exit, natural pipe EOF
and an absent original group. Persisted receipts never authorize PID signalling; unknown
ownership after restart/restore remains blocked. See `docs/repository-context.md`,
`docs/agent-engine.md` and `docs/backlog/done/BAZ-057-portable-safe-reads.md` for scope.
The historical 0.23.0 package does not have this ordinary macOS chat support.

Unreleased **0.25 / BAZ-072** adds a bounded private-worktree backend to the single hardened Git
inspector on macOS. Never give external Git the live macOS source pathname: ignore-aware guarded
reads materialize private scratch, source observations validate independently, and snapshot file
reads use the frozen private bytes. Linux retains its fd-pinned worktree. Unsafe/oversized layouts
still refuse; the Git increment does not qualify complete macOS feature parity, MCP stdio or
worker-process parity. See `docs/repository-context.md` and the active BAZ-072 story.

The 0.25 candidate also binds macOS workers to live ChildProcess authority plus daemon-only public
libproc observations before executable input. Group escalation needs original anchors captured while
the parent is live; never create an anchor from a stored/restored PID. Natural output EOF and group
absence are required for cleanup. Coded nonzero exit is not a success verdict; a forced host-command
exit still cannot prove detached work stopped. Shutdown fences new turns and settles registered
workers before closing resources/DB. Unknown cleanup retains its writer and private scratch.

### Coding evidence: progress, retained diagnostics and change review (BAZ-041/042, shipped in v0.17.0)

Retained diagnostics and source snapshots are **narrow evidence stores**, not a general runs/events
layer and not a second transcript. Pi's session JSONL stays the authoritative conversation record.

- `coding_command_logs` holds bounded retained output (2 MiB/command, 256 MiB/home, seven-day TTL).
  Truncation is a stored flag, never inferred from byte counts, because redaction changes lengths.
  **Retention and disclosure are separate**: captured bytes stay private until source-owned egress
  (terminal operator delivery, an authorized peer read, or an approved communication) releases them, and
  a held log must read as *not shared*, never as an empty result. `releaseCodingCommandLog` is called
  from every such site — direct delivery, Telegram mirroring, peer reads, and approval dispatch.
- `source_snapshots` holds bounded manifests of **paths and digests only, never content**: HEAD, the
  index, sha256 of each path differing from a pinned baseline, and sha256 of explicitly selected
  untracked files. The id is content-addressed (identical trees share it) and `complete` is part of the
  id, so an incomplete capture can never collide with an exact one. A snapshot records its capture
  instant: one capture reads a frozen copy of refs and index, so it cannot be re-read live later.
- Applicability is **three-valued** — `identical` / `changed` / `unknown` — and is never rendered as a
  pass. Absence is **Not checked**. Comparing source states establishes that code *changed*, never that
  the change was relevant to what was tested; do not add a "verified" badge.
- Git inspection has **one** hardened implementation, `src/lib/git/capture.ts`. Do not add a second Git
  path: it copies bounded metadata into scratch with a Bazilion-authored config, refuses unsupported
  layouts, reaches Linux source through a pinned directory descriptor (macOS uses bounded private
  worktree scratch), and applies every hardening flag inside `runGit` so a caller cannot forget them.
  Inspection never mutates the repository and never runs
  repository-configured helpers.
- Review feedback is **file-level**: identity is `(team, snapshotId, path)`, with a selected line range
  carried as context only. A snapshot already records a digest per changed path, so staleness stays
  decidable without synthesizing hunk identities.
- Scope policy (`lib/git-review/scope.ts`) excludes Bazilion-owned state (the Team-root `memory/` store
  **only** — never a directory merely named `memory`, `dist` or similar) and credential-shaped paths.
  Refusals are recorded and counted, never silently dropped.
- Provider model resolution **fails closed**: an unknown model id is refused rather than falling back to
  a build with an empty base URL, which resolved to a provider default and carried the configured
  provider's credential to it.

See `docs/coding-evidence.md`, `docs/backlog/done/BAZ-041-coding-command-verification.md` and
`docs/backlog/done/BAZ-042-git-change-review.md`.

### Memory model

Memory is **per-team**, shared across every agent in the team. The qmd backend lives at `<team.path>/memory/`; each turn's worker calls `qmdBackend(join(agent.team.path, 'memory'))`. The `memory_*` tool descriptions explicitly tell the LLM the store is shared and direct personal notes (persona quirks, preferences) to `home_write IDENTITY.md` instead. The schema's per-agent memory dir is gone — `spawnAgent` only creates `agents/<id>/sessions/`. External surfaces match the ownership: HTTP at `/api/teams/:slug/memory*`, web UI at `/teams/:slug/memory`, CLI at `bazilion memory <write|read|list|search|rm> <team-slug> ...`. There are no `/api/agents/:id/memory*` routes — clients always address the team.

### Worker subprocess + IPC

Every chat turn runs in its own Node subprocess (`apps/daemon/src/runtime/worker/{entry,spawn,ipc-protocol}.ts`). The daemon's `apps/daemon/src/lib/agent-turn.ts:runAgentTurn`:
1. Resolves the agent + provider gate + merged secrets env in-process (the worker no longer holds a SQLite handle).
2. Pre-fetches the OAuth access token for `openai-codex` agents via `apps/daemon/src/lib/api-key.ts:resolveAgentApiKey` (env-key providers return `{}`).
3. Spawns the worker with `stdio: ['pipe', 'pipe', 'pipe', 'ipc']` — stdout/stderr are drained by the daemon (stderr is bounded and redacted); IPC makes messaging tools work without a worker DB handle.
4. Sends `{agent, message, enabledProviders, apiKey?}` on stdin.
5. Line-parses NDJSON `ChatFrame`s from worker stdout and yields them.
6. Services worker `process.send({type:'rpc', method, args, id})` calls (daemon-owned tools, shell approval, and OAuth refresh) by dispatching to turn-scoped hosts and replying with `child.send({type:'rpc-reply', id, ok, result|error})`.

`SessionEvent` types: `user_message` / `assistant_message` / `assistant_delta` / `tool_call` / `tool_result` / `tool_error` / `error`. `ChatFrame` shapes: `{kind:'event', event}` / `{kind:'done', messages}` / `{kind:'fatal', error}`. **There is no `runId`, no `runs` table, no `events` table** — those were dropped along with the per-run audit metadata layer; pi's session JSONL files are the canonical transcript and the only persistent record of what an agent has said.

Cancellation: keyed by **agentId** (not runId). The daemon's `apps/daemon/src/lib/agent-cancel.ts` registers an `AbortController` per active agent on each `runAgentTurn` start; `POST /api/agents/:id/cancel` aborts the controller, which SIGTERMs the worker (3 s grace → SIGKILL); the child's own SIGTERM handler aborts its internal controller so pi unwinds the provider fetch and emits an `error` event with `error: 'cancelled'` before exiting. CLI: `bazilion agent cancel <id>`. The worker also calls `process.disconnect()` in its `finally` so the IPC channel doesn't pin the event loop alive after the turn settles.

See `docs/agent-engine.md` for the full turn-loop walkthrough.

### Providers

Model strings are `provider:model` (e.g. `lmstudio:my-loaded-model`, `anthropic:claude-opus-5`, `google:gemini-3.6-flash`, `openai-codex:gpt-6-astra`, `qwen-token-plan-individual:qwen3.8-max`). `createProviderRegistry` + `loadProviderConfigFromEnv` in `apps/daemon/src/runtime/providers/registry.ts` resolve strings to `{ provider, model }`. Credentials come from env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `QWEN_TOKEN_PLAN_API_KEY`, `BASETEN_API_KEY`, `LMSTUDIO_URL`/`LMSTUDIO_API_KEY`, `OLLAMA_URL`); plain API-key providers never touch the DB. The daemon's `mergeSecretsIntoEnv(db, authToken)` layers DB-stored secrets + plaintext config over `process.env` — this happens **server-side** per API request (chat, provider test, health) and again per worker spawn (the merged env is passed via `child_process.spawn`'s `env` option).

**`openai-codex`** is the OAuth exception: credentials live as a JSON `{refresh, access, expires}` blob under the `OPENAI_CODEX_OAUTH` row of the `secrets` table. The provider registry's `apiKey` field is invoked as an async supplier so refreshes happen lazily on each chat() without rebuilding the cached Provider instance. Pass `{db, authToken}` as the second arg to `loadProviderConfigFromEnv(env, oauth?)` to enable it. For the worker subprocess specifically, `runAgentTurn` pre-fetches the initial access token via `resolveAgentApiKey` and passes it through `WorkerInput.apiKey` → `createBazilionSession({apiKey})`; the session's mid-turn refresher calls back through a private IPC request bound to the worker's provider, Agent, and turn. The daemon alone reads/writes the OAuth secrets row, and only the refreshed access token returns over IPC.

### Secrets and config

`secrets.enc` and `config.json` are gone. The DB has two tables:

- **`secrets(key TEXT PK, envelope TEXT NOT NULL, updated_at INTEGER)`** — AES-256-GCM envelopes (salt+iv+tag+data hex JSON), one row per env-var-shaped key (`ANTHROPIC_API_KEY`, `OPENAI_CODEX_OAUTH`, …). Encryption key derived from `auth.json`'s `token` via PBKDF2-SHA256 100k. Same crypto as the previous file-based store; only the storage medium changed. Threat model is unchanged: anyone who can read both `bazilion.db` *and* `auth.json` can decrypt — the encryption guards against accidental exposure (cat'd dumps, screenshares), not against filesystem read.
- **`config(key TEXT PK, value TEXT NOT NULL, updated_at INTEGER)`** — plaintext for env-var-shaped values that don't need confidentiality (server URLs, region slugs, project IDs). The `CONFIG_KEYS` allowlist (derived from `services.ts`) is enforced in `repos/config.ts` on writes.

API in `apps/daemon/src/core/`: `openSecrets(db, password)` and `openConfig(db)` (ConfigStore + SecretsStore types). The daemon caches the auth token in `getCtx().authToken` so all routes can call `mergeSecretsIntoEnv(db, authToken)` without re-reading `auth.json`.

## Documentation

- Keep `docs/` for current product/architecture documentation and canonical user stories.
- Stories live in `docs/backlog/{draft,todo,in_progress,done}/`; their scope, acceptance criteria,
  unresolved work and concise As-built summary belong in the story, not separate progress files.
- Active stories must describe concrete product capabilities or defects. Keep example configurations
  in `examples/`; do not track recipes or open-ended acceptance campaigns as implementation features.
  Retiring such tracking must never relabel unfinished validation as passed.
- Do not check in test evidence dumps, release journals, review transcripts, temporary paths,
  generated artifacts or archive folders. Use CI/release records and Git history for those.
- Update product guides when behavior changes; do not leave superseded plans presented as current
  support. Keep account entitlement, synthetic checks and live/human acceptance distinct.

## Conventions

- Biome formatter: single quotes, no semicolons, trailing commas, 2-space indent, 100-col width.
- TS is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. `.ts` extensions are required on all relative imports (`allowImportingTsExtensions: true`) — `tsx` and Vite both handle it.
- `apps/web/` is excluded from the root `tsconfig.json` and from biome (it has its own Vite/TanStack-managed tooling). Run `pnpm --filter @bazilion/web typecheck` for web-only TS checks. The whole-tree `typecheck` intentionally skips it.
- **The alpha database contract is clean-install only.** The complete canonical schema lives in
  `apps/daemon/src/core/db/migrations/0001_init.sql`. Until a stable migration contract is
  announced, schema changes edit that file directly and require wiping/rebootstrapping
  `~/.bazilion`; do not add ALTER migrations, legacy-table importers, or API/URL/filesystem
  compatibility adapters. The bootstrap runner remains idempotent for an already-current schema.

## Implemented and released invariants (don't re-implement)

These are shipped and load-bearing; none of them is a proposal.

- **BAZ-046: publication to a code host is an operator decision with no model in the path.** A reviewed
  packet's revision is committed to a new branch and opened as a pull request by the daemon itself — there is
  no publication worker, tool or capability, because publishing is deterministic and a capability an Agent
  must be denied is weaker than no path at all. Content is read from the working tree **only while every
  path's digest still matches the capture**, and a mismatch refuses rather than substituting bytes. A refusal
  (`refused`) means nothing was sent — no commit, no push, no pull request — and the schema enforces that only
  a refusal carries a reason. `published` means the branch exists on the host, and a pull request is recorded
  only when the host returned one. `uncertain` is an interrupted attempt: a push may have landed, so it is
  never replayed. No force push, ever; a head branch that already exists on the remote is refused before the
  commit is built; protected branches are never the head; commits are unsigned and the schema refuses to store
  anything else; the credential travels only as an environment `http.extraheader`, never as an argument or a
  URL; and the remote comes from configuration, never from the Team repository's own `origin`. A
  `PUBLICATION_HOST=local` bare-repository adapter exists so a publication can be observed end to end without
  a network. See `docs/publication.md`.

- **BAZ-034: durable Agent results.** Explicit `deliver_file` calls await turn-bound daemon IPC
  publication into `agent_results` in `Paths.db`. Bytes, SHA-256 and source provenance commit
  together; canonical Pi tool-result details retain the opaque reference. Private receipts become
  owner-visible only through the shared Agent-to-user authorizer/approval dispatcher. Background
  library delivery uses the closed `agent_result` approval tuple; HTTP and Telegram retain their
  transport-owned attempts. Results use `/api/results`, `bazilion result`, persistent chat cards,
  Team Results and native browser handoff. Limits are 25 MiB/file and 1 GiB retained bytes/home.
  Deletion tombstones cannot resurrect; Agent transfer/deletion retain original Team provenance,
  Team deletion cascades, and backup/restore verifies blob hashes. See `docs/results.md`.

- **BAZ-044: specialist verification of a captured code change.** One typed request
  (`verification_requests` + `verification_checks`, with `verification_attempts` and
  `verification_check_outcomes`) binds exactly one BAZ-042 snapshot to at most eight captured commands
  and the frozen BAZ-040 admitted environment, and names one same-Team specialist. It is a bounded
  dispatch-and-evidence record, not a workflow engine: no stages, transformations, approver assignment
  or automatic retries. The invariants are load-bearing — do not re-derive them:
  - **The captured contract is immutable and outcomes are per attempt.** A rerun is a new attempt that
    links to the result it supersedes, so history is never rewritten. Claiming is transactional,
    leased, and persisted *before* a command runs, which is what makes an interrupted execution
    `uncertain` (never replayed) instead of silently retried.
  - **Capture and admission validate, never substitute.** Capture refuses an unavailable or incomplete
    snapshot, a non-member or archived specialist, and a self-verification, leaving no rows behind.
    Admission revalidates membership, evidence window and directed policy on every attempt, reserves the
    workspace exclusively, and **refuses drift**: `source_changed` names a fresh capture as the remedy
    rather than re-capturing silently.
  - **The specialist capability is two tools and cannot be widened.** `verification_request` reads the
    request; `verification_check` runs one declared ordinal, once. No command, cwd, timeout or env
    argument exists to pass, the worker input keys are exact, and the spawner rejects coding/container/
    context/result/messaging/USER.md/browser/MCP/question hosts for a restricted kind rather than
    trusting the caller. The daemon re-checks the worker's request/attempt identity against its own
    binding, so a compromised worker still cannot reach another attempt.
  - **The frozen environment is authoritative and unattended approval is blocked.** A request captured
    for a container is refused when isolation is off (and vice versa); a check needing an approval an
    unattended turn cannot obtain is `blocked`, never auto-approved. A command carrying protected
    credential material is refused, and retained output is redacted with a **live** secrets supplier.
  - **Outcomes are executor facts, and settling reports evidence availability, not a verdict.** A
    receipt is written for every executed check (one is required; provenance is never fabricated) and
    it names the snapshot it was verified against. `completed` means the check set finished — a
    non-zero exit is a *result*, reported per check — and only "nothing executed at all" fails the
    attempt. Unrun checks settle as `skipped`, distinct from `blocked` and `unknown`.
  - **One dispatch owner, never the inbox path.** A request is dispatched by the scheduler tick through
    its own state machine, is never a peer message, and cannot be smuggled through the inbox in either
    direction. Its invocation is a *restricted* invocation (like a restricted review), not a turn with
    a preclaimed lifecycle claim.
  - Surfaces: `/api/teams/:id/verifications[/:requestId[/cancel]]`, `bazilion team verify
    create|list|show|cancel`, and the Team **Verifications** section — all built from one report
    composition so they cannot disagree. Restore revalidates: expired requests are dropped, requests
    whose evidence did not survive are `blocked`, open attempts become `uncertain`, and receipt-backed
    outcomes are invalidated to `unknown`.
  See `docs/backlog/done/BAZ-044-specialist-verification-handoff.md` for accepted scope and gaps
  (no live-model run; container execution implemented but unobserved).

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
- **Bootstrap auth lives in `auth.json`.** The daemon reads it once at startup (`getCtx().authToken`), verifies that it matches an active bootstrap row in the paired DB, and uses it as the PBKDF2 seed for the secrets table. A missing DB/file half fails closed; only a genuinely fresh pair is minted. The CLI reads it as its loopback bearer. The `bootstrap` row in `web_tokens` cannot be revoked — `DELETE /api/tokens/:id` rejects a hash match against the auth token.
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
- **BAZ-069 managed browser research** — ordinary interactive Agents receive `browser_*` tools when `BROWSER_ENABLED` is on (default); protected/restricted, inbox and scheduled turns do not. Status is configuration/session evidence only, never proof a site works. Each Agent's persistent profile lives under the daemon-owned home-root `browsers/<agent-id>/`, contains sensitive cookies/logins, and is excluded from backup/restore. Stop/archive preserve the profile; reset/delete/Team transfer clear it. The daemon directly spawns the installed browser on its persistent local profile, verifies its loopback debugging listener, and then attaches Playwright via CDP; do not replace this with Playwright-owned launching. Normal launches require the daemon's validating SSRF proxy, including for persisted service-worker egress (registration is not blocked); `BROWSER_ALLOW_PRIVATE_NETWORK=true` is a local-development exception that disables it. Downloads are explicitly denied after attachment. Closing the CDP client is not process shutdown: retire the owned child/group before releasing the profile. Unknown/live owner state is recovery-required: never manually delete browser slots, lock files or owner markers and never add an Agent recovery capability. Agents must observe current refs with their matching `observationId`, cite pages actually read, report blockers, and never blindly replay uncertain submissions. No guarantee of Google/site access or anti-bot success. Operator controls: `bazilion agent browser status|stop|reset`; see `docs/browser-research.md` and `docs/backlog/done/BAZ-069-browser-backed-default-web-search.md`.
- **Bidirectional images; audio/video deferred** (shipped v0.4.0). the admitted chat path is **text+image only** — content blocks are `TextContent | ThinkingContent | ImageContent`, `UserMessage.content` is `string | (TextContent|ImageContent)[]`, and model metadata declares `input: ('text'|'image')[]` even for audio-named models. So images are first-class both directions; audio/video can't reach the model and are deferred (no `AudioContent`/`VideoContent` exists). **Image output**: tool-produced images surface as standalone deliverables — a dedicated `images` render entry outside the tool box on web (`ChatPane`), and a Telegram photo sent regardless of mirror mode (`lib/telegram/mirror.ts`, `sendPhoto`/`sendDocument` fallback). **Input is unified**: one generic `Attachment {name?,mimeType,data}` (api-types) rides `ChatRequest.attachments` → `runAgentTurn` is the **single central classifier** — `image/*` → `images` passed to the worker → `session.prompt(text,{images})` (pi vision); everything else → `lib/attachments.ts:saveInputFiles(agent.dir, docs)` writes to `agents/<id>/uploads/` + appends a `[file saved to <path> …]` note (no worker/model change — it's text). Clients just send attachments: web composer (📎/paste/**drag-and-drop**, ANY file, one list), CLI `bazilion agent chat --image|--file <path>` (both → `attachments`), Telegram inbound (`routing.ts` downloads any media via `media.ts:downloadMediaBytes` → one `Attachment`). `piMessagesToProviderView` carries `images` on user + toolResult roles so they persist across reloads. Audio/video deferred (model is text+image only; they ride as stored files).
- **Outbound files: `deliver_file` tool** (shipped v0.4.0). Always-available tool (`runtime/tools/deliver-file.ts`) reads a workspace file (worker shares the daemon fs), base64s it, emits a `file` SessionEvent via a `fileSink` injected in `worker/entry.ts`. Clients render it: web download link (`ChatPane` `file` render entry, live-only — pi session doesn't store it), Telegram `sendDocument` (`mirror.ts:mirrorFile`), CLI saves to cwd. 25 MB cap. (Tool-produced *images* — screenshots/MCP — still surface via the `images`-on-tool_result path + standalone web image block + Telegram photo.)
- **MCP client** (shipped v0.4.0). Daemon-owned `@earendil-works/pi-mcp@1.4.0` client pool in `apps/daemon/src/lib/mcp/` (`pool.ts`) supporting stdio (subprocess, inherits only the supplied merged secrets env) and Streamable HTTP (bearer token in `secrets:MCP_TOKEN_<id>`). Legacy SSE is retired; no automatic OAuth, ambient Pi discovery, codemode or worker connection. See `docs/mcp.md`. Servers are configured **globally** in the canonical `mcp_servers` table declared by `0001_init.sql` (`repos/mcpServers.ts`) — per-agent scoping is a deliberate fast-follow. Per turn, `lib/mcp/resolve.ts:resolveMcpForTurn` discovers each enabled server's tools (`tools/list`, pooled/cached), namespaces them `mcp__<server>__<tool>`, ships them to the worker on stdin (`WorkerInput.mcpTools`), and the worker builds proxy tools (`runtime/tools/mcp.ts`) that call back via `mcpInvoke`. A server that fails to connect is logged and skipped. HTTP: `/api/mcp-servers[/:id[/test]]`. CLI: `bazilion mcp add|list|show|rm|enable|disable|test`. Web: `/config/mcp`. Wire types `McpServer`, `McpServerInput`, `McpToolInfo`, `McpTransport` in `@bazilion/api-types`.
