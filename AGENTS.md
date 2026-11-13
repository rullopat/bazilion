# AGENTS.md

Guidance for coding agents in this repository; Claude Code reads it through `CLAUDE.md`.
Bazilion is a local, single-user multi-agent runtime: one daemon, a CLI and a web UI. User-facing
docs start at `README.md` and `docs/README.md`.

## Commands

Node `^26.12.1` and pnpm 12.15.0, pinned in `mise.toml`; other Node versions are refused. If the
system Node differs, run through mise (`mise exec -- pnpm …`) or put its Node first:
`export PATH=$HOME/.local/share/mise/installs/node/26.12.1/bin:$PATH`.

```sh
pnpm install
pnpm typecheck                 # root tsc --noEmit, then the web app's typecheck
pnpm lint                      # biome check (pnpm format applies fixes)
pnpm test                      # vitest across the tree
pnpm test:docker               # the Docker sandbox suite (needs Docker and debian:bookworm-slim)
pnpm build                     # web build, then the CLI bundle
pnpm vitest run <file>         # one file; add -t 'name' for one test
pnpm tsx apps/cli/src/index.ts <command>   # the CLI from source; `serve` starts the daemon
cd apps/web && pnpm dev                    # the web UI on http://127.0.0.1:4322
```

There is no build step for development: `tsx` runs the TypeScript directly.

## Layout

- `apps/daemon`: Hono on `127.0.0.1:4321` (`HOST`/`PORT`); the only process that opens
  `~/.bazilion` (`BAZILION_HOME`). `src/index.ts` writes the pidfile, bootstraps the home
  (`src/lib/ctx.ts`), starts the scheduler, Telegram and the queue pump, then serves `src/app.ts`,
  which mounts `src/routes/` behind `src/lib/middleware-auth.ts`.
  - `src/core/`: the schema (`db/schema.sql`), repositories, domain operations (agents, teams,
    profiles, skills), paths, secrets, `services.ts` (the `/config` fields) and `providers.ts`
    (one entry per LLM provider).
  - `src/lib/`: turn preparation and running (`turn-preparation.ts`, `agent-turn.ts`),
    `scheduler.ts`, auth, and one module or directory per feature (browser, MCP, Telegram, …).
  - `src/runtime/`: `pi/` (Pi session, event translation, tool adapter), `session/` (the system
    prompt), `providers/` (Pi model runtime), `auth/` (ChatGPT OAuth), `tools/`, `shell/` (host
    and Docker bash, approval), `memory/` (qmd), `worker/` (the per-turn process and its IPC).
- `apps/cli`: the citty CLI (`src/index.ts`, `src/commands/`); its tsup build bundles the daemon,
  the worker and the web UI into the published `bazilion` package.
- `apps/web`: TanStack Start and React. `src/start.ts` checks Host/Origin and CSRF for every
  request; `src/routes/api/$.ts` forwards `/api/*` to the daemon and caps request bodies (64 KiB
  without a credential, 64 MiB with one); `src/lib/daemon-client.ts` is server-only.
- `packages/api-types` (wire types; no dependencies, no `node:` imports) and `packages/client`
  (fetch client used by the CLI and the web server): private workspace packages.
- `docs/` holds the guides and `docs/backlog/` the user stories.

## How it fits together

Paths in this section are relative to `apps/daemon/`.

- The daemon owns the database, secrets, scheduler, browsers and MCP connections. Each turn runs
  in a fresh worker process with no database handle: it reads a `WorkerInput` on stdin, writes
  NDJSON `ChatFrame`s to stdout and calls daemon hosts over Node IPC (`RpcMethods` in
  `src/runtime/worker/ipc-protocol.ts`, answered by `RPC_HANDLERS` in `spawn.ts`).
- Every turn origin (web or CLI chat, follow-up, Telegram, trigger, inbox wake) goes through
  `prepareAgentTurn` then `runAgentTurn` and gets the same tools; only `ask_user` and
  dangerous-command approval depend on someone being there to answer.
- Pi owns the loop, provider calls and the session JSONL, which is the only transcript (no runs
  or events tables). `src/runtime/pi/session.ts` builds sessions with in-memory credentials and
  settings and with Pi's resource discovery off; keep it that way.
- Only the daemon imports daemon code at runtime. Exceptions: the CLI's offline commands
  (`backup restore`, `uninstall`) and the CLI tests.
- `src/core/db/schema.sql` is the whole schema and is edited directly. A home whose schema
  differs is refused at startup; there are no migrations, so a schema change means resetting dev
  homes (`bazilion uninstall --yes`).
- `bazilion.db` and `auth.json` are a pair: the bootstrap token in `auth.json` seeds secret
  encryption and cannot be revoked. Effective settings: process env over secrets over config.
- Agent fetches go through `src/runtime/tools/web-ssrf.ts`, browser traffic through
  `src/lib/browser/proxy.ts`. Bazilion's own credentials are removed from worker, shell and MCP
  environments (`toolEnvironment` in `src/runtime/shell/security.ts`).
- In a source checkout the worker runs under Node's type stripping, so code it reaches must be
  erasable TypeScript: no enums, no parameter properties.

The home (`~/.bazilion`, or `BAZILION_HOME`):

```text
bazilion.db  auth.json  daemon.pid
agents/<id>/        SOUL.md IDENTITY.md AGENTS.md TOOLS.md [BOOTSTRAP.md] sessions/ uploads/
teams/<slug>/       the Team workspace (or a symlink to a project), with memory/ (qmd notes)
profiles/<id>/  skills/<name>/  browsers/<agent-id>/
```

## Adding things

Daemon paths are again relative to `apps/daemon/`.

- A management feature: a route in `src/routes/`, its types in `packages/api-types`, a CLI
  command in `apps/cli/src/commands/` and a web page or component; both clients call the same
  route.
- A setting: a field in `src/core/services.ts` (a provider: an entry in `src/core/providers.ts`).
  It then shows on `/config` and is accepted by `bazilion config set`.
- An Agent tool: a handler in `src/runtime/tools/`, added in `src/runtime/pi/tools.ts`. When it
  needs the daemon (the database, credentials, a long-lived resource), add a host in `src/lib/`,
  an RPC method and the worker-side proxy.
- A table or column: edit `src/core/db/schema.sql` and its repository in `src/core/repos/`.

## Tests

- `vitest.setup.ts` gives every test file a throwaway `BAZILION_HOME` under a temporary root that
  is removed after the run. Never point a test or a manual run at the real `~/.bazilion`; use a
  scratch home and a free port when you start a daemon by hand.
- CLI tests boot the real daemon from source on a free port.
- Opt-in suite: `BAZILION_TEST_DOCKER=1` (Docker sandbox).

## Conventions

- Biome: single quotes, no semicolons, trailing commas, 2-space indent, 100 columns. It covers
  `apps/web` too, except the generated `apps/web/src/routeTree.gen.ts`, which only the web build
  writes.
- TypeScript is strict, with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`; relative
  imports end in `.ts` (`apps/web` uses extensionless Vite imports).
- Web: use the shared `<Button>` (`apps/web/src/components/Button.tsx`).
- Docs are short operator guides of current behaviour; update them with the code. Stories in
  `docs/backlog/` stay at 25–60 lines. Do not commit test evidence, release journals or build
  output.

## Standing decisions

- Build features directly for one local user, without admission, lease, receipt, evidence or
  qualification ceremony.
- No legacy paths, compatibility shims, feature flags for cutover, deprecation periods or
  migrations: change the code directly.
- Every management feature ships in both the CLI and the web UI.
- Linux first; macOS runs plain host execution and is untested; Windows is unsupported.
- Docker is the only sandbox (`BAZILION_BASH_SANDBOX=off|docker`) and applies to every kind of
  turn.
- Removed in the November 2026 cleanup and not to be reintroduced unless the owner asks: review
  packets, specialist verification, publication to a code host, the native Bubblewrap sandbox, the
  separate protected turn surface, the communication approval queue, workspace leases and
  recovery, `coding_*` tools with receipts, logs and snapshots, macOS process adapters, pairing
  codes and token scopes, and release-qualification scaffolding.
- Only the `bazilion` package is published to npm.
