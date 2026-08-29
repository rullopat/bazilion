# @bazilion/api-types

## 0.14.0

## 0.13.0

### Minor Changes

- Add wire contracts for credential-minimal protected execution, trusted invocation identity,
  protected readiness, and secret-free remediation.

- Add wire contracts for the private gateway, expiring device credentials, bounded browser
  sessions, session-bound CSRF, protected identity, detailed health, and backup/restore parity.

## 0.12.2

## 0.12.1

## 0.12.0

### Minor Changes

- Add the Operator Attention Center: one source-owned queue and navigation badge for pending
  communication approvals, reviewed-learning proposals, terminal review and trigger failures, and
  Agent message loop breaks. Operators can filter the queue, navigate to canonical decision screens,
  and acknowledge or restore informational failures through authenticated HTTP, CLI, and responsive
  web surfaces without copying payloads into a second audit store.

- [`6991fde`](https://github.com/rullopat/bazilion/commit/6991fdebd44cca2b7bd82079dd418fa75c20d2aa) Thanks [@rullopat](https://github.com/rullopat)! - Add an opt-in reviewed learning loop for long-lived Agents. Successful user turns can enqueue
  durable, restricted background reviews that produce evidence-backed private or shared lesson
  proposals. Operators can configure cadence/model/reasoning, inspect and edit proposals, approve or
  reject them, and later revoke approved lessons through authenticated HTTP, CLI, and the Agent
  Learning web tab. Approved private lessons enter only that Agent's prompt; shared lessons become
  deterministic Team-memory notes.

- [`f0395a7`](https://github.com/rullopat/bazilion/commit/f0395a7df7388ef8ca19ebda51053c0fc90e11ad) Thanks [@rullopat](https://github.com/rullopat)! - Add a durable agent-message loop circuit breaker. Messages now retain causal
  chain and hop metadata, inbox wake turns propagate that ancestry even when an
  Agent omits `reply_to`, and the daemon rejects over-budget sends before they can
  wake another LLM turn. Configure the ceiling with
  `BAZILION_AGENT_LOOP_MAX_HOPS`; inspect payload-free stop events through the
  Agent API, `bazilion inbox loop-breaks`, or the web inbox.

## 0.11.0

### Minor Changes

- [`e63f48a`](https://github.com/rullopat/bazilion/commit/e63f48a9c15e12f3dc7e5f204fc060abb0f2aa7e) Thanks [@rullopat](https://github.com/rullopat)! - Add opt-in Docker isolation and dangerous-command approval for agent shell commands. Docker mode runs a same-name Pi
  `bash` replacement with scrubbed image and worker environments, no network, a read-only root, one
  writable team workspace, and non-recursive bounded read-only memory, skill, and attachment mounts;
  host-backed coding tools are hidden so absolute paths cannot bypass the container boundary. Reject
  remote Docker contexts and implicit image volumes, surface the posture through shared service
  configuration and `bazilion doctor`, and harden host-side memory and file delivery against symlink
  escapes. Dangerous mode gates classified commands through turn-scoped daemon IPC, inline web and
  TTY CLI decisions, timeout/cancellation cleanup, and non-interactive auto-denial.

- [`675200b`](https://github.com/rullopat/bazilion/commit/675200b019957f3406820aa47976f6b3633c3777) Thanks [@rullopat](https://github.com/rullopat)! - Make scheduled triggers durable across agent contention, retries, and daemon restarts. Add
  coalesced dispatch persistence, bounded retry with lease recovery, API and CLI diagnostics, and
  recent dispatch status in the web UI. Provider errors now enter the retry state machine, while
  approval-gated occurrences remain pending until a durable grant is executed by the scheduler.

## 0.10.0

## 0.9.0

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
