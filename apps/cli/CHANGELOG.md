# bazilion

## 0.13.0

### Minor Changes

- Add credential-minimal protected execution for Telegram and autonomous Agent work, including
  fail-closed Docker isolation, trusted invocation identity, guarded web fetching, and restricted
  review workers. Replace Telegram first-sender ownership with authenticated one-time owner pairing
  and add privacy, membership, identity, and secret-safe diagnostic checks.

- Add a loopback-only private web gateway profile with Tailscale Serve preflight, expiring device
  credentials, bounded hashed browser sessions, session-bound CSRF, strict origin/header policy,
  protected identity, and CLI, web, mobile, backup, and restore parity.

- Add recipient-encrypted age backups, authenticated staged restore, secret-name-only inventories,
  crash-safe bootstrap rotation, non-bootstrap token revocation, and explicit credential recovery
  guidance. Plaintext backups now require `--plaintext`.

- Add a deterministic 60-case adversarial security acceptance gate covering the composed private
  gateway, credential recovery, Telegram ingress, protected workers, SSRF, and Docker boundaries.

- Extend protected and restricted-review workers across the complete pinned Pi provider catalog
  with exhaustive drift checks and fail-closed provider-specific credential projections.

- Update the bundled Pi agent engine to 0.84.3, add Baseten and Qwen Token Plan Individual, adapt
  OAuth cancellation and prompt normalization, and refresh curated model examples.

## 0.12.2

### Patch Changes

- Update the bundled Pi agent engine to 0.83.0, adapt OAuth and session runtime integration to its
  public provider APIs, add Qwen Token Plan providers, and refresh curated model examples.

## 0.12.1

### Patch Changes

- Pin the Pi dependency family to the tested 0.80.6 release so clean npm installs cannot resolve a
  newer incompatible OAuth API and crash the Bazilion CLI at startup.

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

- [`1dc56d0`](https://github.com/rullopat/bazilion/commit/1dc56d01522bbacb5212a0d9f30fa00403667552) Thanks [@rullopat](https://github.com/rullopat)! - Make online backups use a verified SQLite snapshot instead of archiving live WAL state, and harden
  restore with archive/link validation, auth-to-database checks, offline-daemon detection, staged
  atomic installation, exact-schema verification, destination path rebasing, exclusive
  daemon/restore ownership, crash-phase recovery markers, rollback, and failed-download cleanup.
  Contained relative symlinks in work product are preserved while escaping targets remain rejected.

### Patch Changes

- [`1dc56d0`](https://github.com/rullopat/bazilion/commit/1dc56d01522bbacb5212a0d9f30fa00403667552) Thanks [@rullopat](https://github.com/rullopat)! - Refresh expiring ChatGPT OAuth access tokens during worker turns through provider-, Agent-, and
  turn-bound daemon IPC. Keep refresh credentials DB-owned, redact upstream failures, clean pending
  IPC calls on cancellation or disconnect, and single-flight concurrent rotating-token refreshes.

## 0.10.0

### Minor Changes

- [`b4c5b07`](https://github.com/rullopat/bazilion/commit/b4c5b0790153c33d81b2a532e8451902d0f86b3c) Thanks [@rullopat](https://github.com/rullopat)! - Refresh the web application shell and responsive management surfaces, strengthen Team Policy
  lifecycle handling, and replace the optional `HEARTBEAT.md` profile convention with explicit
  interval and cron trigger instructions.

## 0.9.0

### Breaking Changes

- Replace Group, Profile Group, and Harness commands/routes with canonical `team`,
  `team-template`, and `team policy` surfaces. Remove compatibility aliases and require a fresh
  alpha data bootstrap for the consolidated `0001_init.sql` schema.

### Minor Changes

- [#37](https://github.com/rullopat/bazilion/pull/37) [`6e65d3e`](https://github.com/rullopat/bazilion/commit/6e65d3e97ceb0c4bfdbf996eda3ae194ddc4890a) Thanks [@rullopat](https://github.com/rullopat)! - Update the bundled Pi agent packages to 0.80.6 and refresh provider examples for the GPT-5.6
  Luna, Terra, and Sol model family.

### Patch Changes

- [#26](https://github.com/rullopat/bazilion/pull/26) [`1989c29`](https://github.com/rullopat/bazilion/commit/1989c29feaa60a3f4f26e2e640ca04507664fe0f) Thanks [@rullopat](https://github.com/rullopat)! - Complete the breaking alpha cleanup to canonical Teams, Team Templates, and Team Policy. Remove
  Group, Profile Group, Harness prototype, compatibility API/URL, and incremental migration
  surfaces; consolidate fresh installs into the final `0001_init.sql` schema.

## 0.8.0

### Minor Changes

- Add static skill content scanning for prompt-injection, credential access, exfiltration wording, and stealth Unicode. Risky skills now require explicit confirmation on import and per-agent attach, with findings surfaced in CLI, API, and web UI.

## 0.7.0

### Minor Changes

- Update pi agent packages to 0.79.10 and refresh provider/model setup.

  Adds Bazilion config support for the new pi-ai providers, refreshes model catalog examples, and improves first-run setup guidance for enabling providers and saving curated models.

## 0.6.0

### Minor Changes

- Bundle the production web UI into the published CLI package and add `bazilion dashboard` to start or reuse the local daemon, run the bundled web server, and open the dashboard.

## 0.5.1

### Patch Changes

- [#22](https://github.com/rullopat/bazilion/pull/22) [`8099ddb`](https://github.com/rullopat/bazilion/commit/8099ddbb4d500b16da1cec8ae25a3a6256b3e2a4) Thanks [@rullopat](https://github.com/rullopat)! - Telegram now renders agent replies with the same Markdown formatting as the Web UI.

  Replies previously arrived as plain text (no `parse_mode`), so `**bold**`, `# headings`, and `` `code` `` showed up as literal syntax, and long replies were truncated. A new converter reuses `marked`'s lexer (the same parse the Web UI uses) and walks the tokens into Telegram's supported HTML entity set (`<b>`/`<i>`/`<s>`/`<code>`/`<pre>`/`<a>`/`<blockquote>`), approximating the features Telegram has no entity for: headings → emoji-prefixed bold (`▎`/`▸`/`·` by level, since Telegram has no font sizing), tables → aligned monospace `<pre>` block, lists → `•`/`1.` bullets with indent and `☐`/`☑` task items, `---` → a box-char rule. A tag-aware splitter replaces truncation, chunking long replies under Telegram's 4096-char limit while keeping every entity balanced across the cut; if Telegram rejects a chunk's entities the mirror retries it once as plain text so a reply is never dropped. Error and verbose tool-trace lines stay plain text.

## 0.5.0

### Minor Changes

- [#9](https://github.com/rullopat/bazilion/pull/9) [`2ab6537`](https://github.com/rullopat/bazilion/commit/2ab6537a227422c7e3fb063458b75a7ac72faf82) Thanks [@rullopat](https://github.com/rullopat)! - Agent templates refresh: a two-sided bootstrap, a seeded USER.md, a richer workspace manual, and agent identity (avatar + creature) in the web UI.

  **Two-phase bootstrap + seeded USER.md.** The first-run ritual now asks about _you_ as well as the agent. Phase 1 fills IDENTITY.md (name, creature, vibe, emoji, optional avatar); phase 2 reads `user_md_get` → writes USER.md → `bootstrap_done`. New teams are seeded with a starter `USER.md` instead of an empty string, and a one-shot migration backfills existing teams whose `user_md` is still empty.

  **Richer default templates.** SOUL.md, AGENTS.md (now a full workspace operating manual — memory discipline, red lines, and external-channel etiquette for Telegram + future channels), and TOOLS.md are substantially expanded. IDENTITY.md gains **Creature** and **Avatar** fields.

  **Default-on templates, HEARTBEAT opt-in.** AGENTS.md and TOOLS.md now ship with every profile by default (previously opt-in); HEARTBEAT.md stays opt-in. Pass `null` to opt any of them out. The bazilion-managed `default` profile is brought in sync with the shipped templates on boot (operator edits to custom profiles are never touched).

  **Agent identity in the web UI.** Agents now expose a parsed `identity` (name, creature, vibe, avatar) read from their own IDENTITY.md. The agent list and detail pages render an avatar (http(s):// or data: URIs only) and creature, falling back to the emoji.

  **Profile create form redesign.** The two collapsible template teams are replaced by a tab per template plus a "templates to include" checklist — SOUL/IDENTITY are always included; BOOTSTRAP/AGENTS/TOOLS default on; HEARTBEAT defaults off. Disabling a template greys out its tab. The profile-team create form now prefills the starter USER.md.

  Strictly additive: existing endpoints, profiles, and agents behave unchanged. `Agent`/`ResolvedAgent` gain an optional `identity`, and `CreateProfileRequest` accepts `null` for `agents`/`tools`/`heartbeat` to skip those files.

## 0.4.0

### Minor Changes

- [#19](https://github.com/rullopat/bazilion/pull/19) [`a9715c2`](https://github.com/rullopat/bazilion/commit/a9715c2b90aba9933affc9e77b19495791f93694) Thanks [@rullopat](https://github.com/rullopat)! - Add Playwright browser automation and MCP client support.

  **Browser automation** — agents get a `browser_*` tool suite (navigate, snapshot, click, type, hover, select, fill_form, press_key, go_back, tabs, take_screenshot, console, network) backed by a persistent per-agent Playwright session that survives across turns. Perception is accessibility-tree-first (`browser_snapshot` returns an aria tree with `[ref=eN]` element refs — no vision model needed); screenshots are a secondary, multimodal escape hatch rendered inline in chat. A network-layer SSRF guard blocks loopback/private targets (override with `BROWSER_ALLOW_PRIVATE_NETWORK` for local dev). Configure on `/config` (Browser Automation) or via env. Run `pnpm exec playwright install chromium` once.

  **MCP client** — connect the daemon to Model Context Protocol servers over stdio (local subprocess), Streamable-HTTP, or SSE (with optional bearer auth). Each enabled server's tools are discovered and injected into every agent turn, namespaced `mcp__<server>__<tool>`. Manage with `bazilion mcp add|list|show|rm|enable|disable|test` or the `/config/mcp` page.

  Both run as long-lived daemon-side resources (idle-reaped, closed on shutdown) reached from the stateless per-turn worker over IPC. Tool results are now multimodal (text + images).

  **Bidirectional attachments across all clients** — send any file _in_ and receive any file _out_, on web, Telegram, and CLI. Inbound files travel as one generic `Attachment {name?, mimeType, data}`; the daemon classifies each at turn assembly: `image/*` goes to the model as **vision** (pi `prompt({images})`), everything else is **stored under the agent's home and referenced by path** so the agent opens/processes it with its tools. Attach via the web composer (📎 / paste / **drag-and-drop**), a Telegram photo/document/voice/etc., or `bazilion agent chat <id> --image <path>` / `--file <path>`.

  Outbound: tool-produced images (browser screenshots, MCP image results) surface as first-class deliverables — a standalone image block in the web chat (not buried in the tool call) and a photo on Telegram (regardless of mirror mode). Agents send arbitrary files back with a new **`deliver_file`** tool — a download link in the web chat, a document on Telegram, saved to disk on the CLI.

  Audio and video are intentionally deferred: pi and every wired provider are text+image only, so the model can't perceive non-image media as input yet (it gets a stored file + path) — revisit when a provider exposes those modalities. 25 MB per file.

### Patch Changes

- [#19](https://github.com/rullopat/bazilion/pull/19) [`a9715c2`](https://github.com/rullopat/bazilion/commit/a9715c2b90aba9933affc9e77b19495791f93694) Thanks [@rullopat](https://github.com/rullopat)! - Upgrade dependencies and refresh the model catalog examples.

  **pi 0.75.4 → 0.77.0** — bump `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-coding-agent`, which ships an expanded built-in LLM model catalog. The `/config` provider catalog is already data-driven off pi's `getModels()`, so the new models surface automatically; the hardcoded per-provider example hints (`exampleModelFor` on `/config`, plus the `welcome` page and the `profile`/`provider`/`auth` CLI help) were refreshed to mirror the 0.77 catalog (e.g. `claude-opus-4-8`, `gpt-5.5`, `gemini-3-pro-preview`) and drop entries pi no longer lists.

  Also picked up in-range patch/minor updates across the tree (`@tobilu/qmd`, `hono`, `@hono/node-server`, `playwright`, `typebox`, `@biomejs/biome`, `tsup`, and the web/mobile toolchains). Mobile's Expo-pinned native modules (`react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`) were intentionally held at the versions Expo SDK 56 blesses.

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
