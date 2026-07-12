# @bazilion/api-types

## 0.9.0

## Unreleased

### Breaking Changes

- Replace Group/Profile Group/Harness wire contracts with canonical Team, Team Template, and Team
  Policy types. Removed aliases are not retained in the alpha API.

## 0.8.0

### Minor Changes

- Add static skill content scanning for prompt-injection, credential access, exfiltration wording, and stealth Unicode. Risky skills now require explicit confirmation on import and per-agent attach, with findings surfaced in CLI, API, and web UI.

## 0.7.0

## 0.6.0

## 0.5.1

## 0.5.0

## 0.4.0

## 0.3.0

### Minor Changes

- **Telegram integration.** Agents can now live in a Telegram forum supergroup — one topic per agent, two-way chat, and a ⚙ bazilion control-plane topic.

  - **Connect** a bot + forum supergroup via the web (`/config/integrations/telegram`) or CLI (`bazilion telegram config set`), with a preflight health check (bot identity, supergroup reachable, forum topics enabled, Manage Topics permission, Privacy Mode off).
  - **Spawn and bind** agents from Telegram (`/spawn`, `/spawn_team`, `/talk`), the web agent page, or `bazilion telegram bind`. Each agent gets its own named topic with a profile-derived icon; per-team templates control topic naming and rename propagation.
  - **Two-way chat:** type in an agent's topic to run a turn; replies mirror back with a typing indicator and a 👀 reaction. Messages sent while the agent is busy are queued and answered together. Inbound photos/documents/voice are downloaded (≤20 MB) and referenced for the agent.
  - **Access control** with trust-on-first-use: the first user to message the bot becomes owner; owners manage members with `/allow` / `/deny` (also the web Access control card and `bazilion telegram allow`).
  - **Resilience:** per-agent inbound/outbound rate budgets, an outbound send queue, a polling stall-watchdog auto-restart, supergroup-migration reconnect, and lazy reconciliation when a topic is deleted in Telegram.

  New Telegram wire types in `@bazilion/api-types`; `@bazilion/client` and `bazilion` bump in lockstep (fixed team).

## 0.2.1

### Patch Changes

- [#5](https://github.com/rullopat/bazilion/pull/5) [`9707acc`](https://github.com/rullopat/bazilion/commit/9707acceb58983b6fc83be2accba1312d5ac00f3) Thanks [@rullopat](https://github.com/rullopat)! - **Fix `bazilion@0.2.0` crash on `serve`** — the npm package was broken; `npx bazilion serve` exited with `ERR_MODULE_NOT_FOUND: Cannot find package 'sqlite'` before the daemon could bind a port.

  Two build-pipeline bugs in `apps/cli/tsup.config.ts`:

  - esbuild's hardcoded known-builtins list predates `node:sqlite` (Node 22+). It auto-externalizes `node:` imports before plugin `onResolve` hooks can intercept them, then strips the `node:` prefix at print time — so `from 'node:sqlite'` shipped as `from "sqlite"` in the bundle, which Node tried to resolve from `node_modules` and failed. There's no esbuild flag to force-keep the prefix; the fix is a post-build string replace in tsup's `onSuccess` hook.
  - SQL migration files weren't being staged into `dist/`. `migrate.ts` reads them relative to `import.meta.url` (i.e. `dist/migrations/`), but tsup only emits JS. The published 0.2.0 has this bug too — the sqlite crash just masked it. The same `onSuccess` hook now copies `apps/daemon/src/core/db/migrations/*.sql` into `dist/migrations/`.

  Verified with a clean `BAZILION_HOME`: `node dist/cli.js serve` boots, auto-bootstraps `~/.bazilion`, writes `auth.json`, listens on the port, and `/api/health` returns 200.

  No source changes; no API or wire-shape changes. The `@bazilion/client` and `@bazilion/api-types` bumps are lockstep-fixed by `.changeset/config.json`.

## 0.2.0

### Minor Changes

- [#1](https://github.com/rullopat/bazilion/pull/1) [`27a0456`](https://github.com/rullopat/bazilion/commit/27a0456d244361fbab9c79a61491b00c23727cfb) Thanks [@rullopat](https://github.com/rullopat)! - **Profile Teams (BAZ-002)** — preconfigured team templates that spawn N agents into a target team in one atomic call.

  - New `profile_groups` + `profile_group_members` schema; CRUD via `GET|POST|PATCH|DELETE /api/profile-teams` and `PUT /api/profile-teams/:id/members`.
  - `POST /api/profile-teams/:id/spawn` resolves member name collisions with `-2`, `-3`, … suffixes, auto-creates the target team when its slug doesn't exist, and rolls back the whole batch on any failure (with retry-with-backoff cleanup of orphan agent dirs).
  - CLI: `bazilion profile-team create/list/show/update/edit/delete/spawn`.
  - Web UI: `/profile-teams` list + detail pages under a new "templates" tab that shares space with profiles; the sidebar `+ new ▾` menu has two sections (spawn agent from template / spawn team from template); empty teams show a "spawn team from template" CTA.
  - Wire types: `ProfileGroup`, `ProfileGroupMember`, `ProfileTeamDetail`, `ProfileGroupWithCount`, plus `Create|Update|PutMembers|SpawnProfileGroupRequest` and `SpawnProfileGroupResponse` in `@bazilion/api-types`.

  **Other fixes shipped with this release**

  - Friendly error when deleting a profile that's still referenced by a profile team (was a raw SQLite FK error).
  - Web UI now surfaces daemon errors on profile delete (was silently swallowed).
  - New shared `<Button variant="primary|ghost|danger">` component + `.danger-btn` CSS class — prevents the "bare `<button type='button'>` lost all styling" class of bug.
  - Theme flash on navigation fixed (root layout now uses `data-layout` instead of `className` so the pre-paint `.dark` class survives reconciliation).

## 0.1.1

### Patch Changes

- Release v0.1.1.

  - **Shared USER.md editing for agents.** New `user_md_get` / `user_md_write` tools let any agent in a team update the shared USER.md with optimistic-etag concurrency control. Previously agents could only read it. USER.md is capped at 12 KB (it's inlined into every system prompt).
  - **Provider expansion.** Switched the underlying pi-ai package from `@mariozechner/pi-ai` to `@earendil-works/pi-ai`. New providers wired through `loadProviderConfigFromEnv`: DeepSeek, Fireworks, Together, Moonshot AI, Kimi Coding, MiniMax, Xiaomi MiMo, OpenCode, GitHub Copilot, Cloudflare AI Gateway, Cloudflare Workers AI, llama.cpp.
  - **Web fetch tool hardened.** Readability extraction + markdown output, SSRF guard with DNS-rebinding re-validation, 15-min LRU per `${mode}|${url}`. UA spoofs desktop Safari.
  - **Worker IPC protocol extended.** `UserMdHost` joins `MessagingHost` as a daemon-side RPC surface; the worker no longer needs a SQLite handle to touch shared state.
  - **Web UI polish.** Services config page, root chat layout, theme tokens, FieldRow component.
  - **Backlog system grows.** BAZ-002 (Profile Teams — preconfigured team templates) and BAZ-003 (Hermes-style self-learning loop) added as drafts under `docs/backlog/draft/`.
