---
id: BAZ-004
title: TUI client (apps/tui) — feature-parity terminal UI for the daemon
status: todo
size: L (≈1–2 weeks for v1; scaffolding lands in a day, full parity is staged)
created: 2026-05-25
refined: 2026-05-25
note: New workspace `apps/tui` built on Ink + React + TS; reuses `@bazilion/client` and `@bazilion/api-types` directly. Distribution via `bun build --compile` per-platform. Strictly additive — no changes to daemon, web, mobile, or CLI.
---

# BAZ-004 — TUI client (apps/tui)

**Status:** Backlog (draft). Today Bazilion ships two end-user surfaces: the CLI (`apps/cli`, citty-based, command-per-action) and the web UI (`apps/web`, TanStack Start, full multi-screen SPA). The CLI is great for scripting and one-shot operations but is awkward for a long live session — listing agents and then jumping into a chat means typing two unrelated commands; watching an inbox means polling by hand. The web UI fits browser-native users but requires running a Vite dev server on port 4322 alongside the daemon on 4321, which is friction for terminal-native operators who already live in tmux. This BAZ adds `apps/tui` — a single-binary terminal UI that opens directly against the local (or paired remote) daemon and gives you the same surfaces the web app exposes, with no Vite server, no browser, and the same auth as the CLI (loopback bearer from `~/.bazilion/auth.json`).

**Dependency:** None. Sits entirely on top of the existing HTTP surface; the daemon, CLI, web, and mobile apps are untouched. The TUI is a fourth client.

**Framework decision (resolved 2026-05-25 via 10-agent fan-out research):** TypeScript + [Ink](https://github.com/vadimdemedes/ink) (React for terminals) bundled with `bun build --compile`. The deciding factor was code reuse — `packages/client` and `packages/api-types` were explicitly built hermetic (no `node:*` imports) so any TS client gets the wire layer for free; every other stack (Go+Bubble Tea, Rust+Ratatui, Python+Textual, etc.) would have required hand-porting ~30 entity/event types and maintaining them on every wire-shape change with no compile-time link to the source-of-truth. Trade-off accepted: ~80–100 MB single-file binary (vs ~15 MB for Go, ~5 MB for Rust) because it embeds the Bun runtime — acceptable for a developer-facing client where the bottleneck is HTTP I/O, not render throughput. Proof-of-life: Claude Code, GitHub Copilot CLI, Codex CLI all ship Ink + a runtime-embedded binary in production. Full evaluation notes archived in the conversation history that produced this BAZ.

## User stories

- **As a terminal-native operator**, I want one binary I can launch in any pane (`bazi`) that connects to my local daemon via `~/.bazilion/auth.json` and drops me into a navigable, multi-screen UI, so I don't need to context-switch to a browser tab and don't need to run `apps/web`'s Vite server alongside the daemon.
- **As an operator paired against a remote daemon (Tailscale / LAN)**, I want to launch the TUI against a remote daemon by pasting a `bazilion://pair?server=…&token=…` URL or passing `--server …` / `--token …`, so a remote-host Bazilion instance is as ergonomic as the local one.
- **As an operator deep in a chat with one of my agents**, I want the streaming `assistant_delta` frames to render token-by-token inside the chat view with markdown + syntax-highlighted code blocks, so the TUI feels as live as the web UI does today — not "log a line per chunk".
- **As an operator watching multiple agents**, I want the agent-list screen to show unread-inbox counts, currently-running indicator, and last-activity timestamp, so I can see at a glance which agent wants my attention.
- **As a release-engineer publishing the TUI**, I want one `pnpm --filter @bazilion/tui release` workflow to produce signed single-file binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64, and windows-x64 via `bun build --compile`, so distribution doesn't depend on the user's having Node/Bun/pnpm installed.

## Goal

Ship `apps/tui` — a new workspace that produces a single executable per platform giving feature parity with `apps/web` for the surfaces an operator actually uses interactively. "Feature parity" is scoped (see Scope below): the parity bar is the *interactive* surfaces (chat, agent list, inbox, triggers, config), not every form-edit-button the web has. The TUI does NOT replace the CLI for scripting (one-shot commands stay in `apps/cli`) and does NOT replace the web (which keeps being the canonical configuration surface for end-users who prefer a browser).

**Strict additivity:** the existing CLI's commands and the existing web routes stay exactly as they are. The TUI is a new client of the daemon, not a refactor of anything.

## Why now

Three pressures converge:

1. **CLI/web parity is mandatory per `CLAUDE.md`, but the CLI is not actually parity for interactive flows.** The CLI shines for `bazilion serve`, `bazilion agent spawn`, `bazilion inbox list <agent>` and similar one-shots. The web UI handles everything else. There is no terminal-native option for "I want to chat with my agent without leaving my terminal" — `bazilion agent chat <id>` exists but it's a one-shot blocking call inside a shell, not a live persistent UI. The TUI closes that gap without requiring a browser.
2. **The hermetic-package investment pays off best when we have a third TS client.** `packages/api-types` and `packages/client` were deliberately built `node:`-free precisely to support clients outside the daemon process. `apps/cli` and `apps/mobile` already reuse them; `apps/tui` is the third user and the one that benefits most (full TS App with React + Hooks, not a thin command wrapper or a mobile experiment).
3. **Mobile pairing infrastructure exists and is unused on desktop.** `bazilion://pair?…` and `bazilion token create --qr` ship today for `apps/mobile`. The TUI can reuse the same pairing URL parser (it's already a unit-tested pure TS module at `apps/mobile/src/pair-url.ts`) to let users pair against a remote daemon by pasting the URL — no extra protocol work.

Doing this now also gives us a clean place to dogfood streaming-chat UI patterns (delta batching, scrollback virtualization, markdown re-render) that the web UI also wrestles with, before next-generation features (richer tool-call rendering, inline diff approvals from `BAZ-003`) ossify a different shape.

## Scope

### v1 — scaffold + read-only parity (in this BAZ)

Lands a working `apps/tui` workspace with the framework in place and the read-mostly screens implemented. Write/CRUD screens stub to a "switch to web" prompt initially and fill in over follow-up BAZs.

**Workspace structure:**

```
apps/tui/
  package.json          # @bazilion/tui, private, bin: bazi
  tsconfig.json         # extends root base, adds jsx: 'react-jsx'
  src/
    index.tsx           # entry — load creds, render <App/>
    paths.ts            # mirrors apps/cli/src/paths.ts (resolveTuiPaths)
    auth-file.ts        # mirrors apps/cli/src/auth-file.ts (readAuthFile)
    client.ts           # loadClientConfig — same env-vars + auth.json fallback chain as CLI
    pair-url.ts         # copy of apps/mobile/src/pair-url.ts (or extracted to packages/pair later)
    app.tsx             # top-level <App/> — owns route state + sidebar
    router.tsx          # screen enum + dispatcher
    screens/
      agents-list.tsx
      agent-chat.tsx
      agent-inbox.tsx
      agent-triggers.tsx
      profiles-list.tsx
      groups-list.tsx
      config.tsx
      welcome.tsx       # first-run gate handler (catches 409s)
    components/
      sidebar.tsx
      statusbar.tsx
      spinner.tsx
      markdown.tsx      # marked + cli-highlight → Ink <Text/> tree
    hooks/
      use-agents.ts     # `useQuery`-shaped wrapper over client.get
      use-chat-stream.ts # owns the NDJSON consumer + delta batcher
  test/
    pair-url.test.ts    # copied from apps/mobile, kept independent
    markdown.test.ts    # markdown renderer snapshots
```

**v1 screens (parity scope):**

| Screen | Web route | TUI behavior |
|---|---|---|
| Agents list | `/agents` | List with name, group, model, status badge, unread-inbox count. Enter → chat. |
| Agent chat | `/agents/:id` | Streaming chat view (NDJSON `ChatFrame` → markdown render with `marked` + `cli-highlight`). `/` slash-command palette for compact/reset/cancel. |
| Agent inbox | `/agents/:id/inbox` | Read-only list initially. Send-message form lands in v1.1. |
| Agent triggers | `/agents/:id/triggers` | Read-only list initially. CRUD lands in v1.1. |
| Profiles list | `/profiles` | Read-only list with default-model + skill mode. Edit punts to "open in web". |
| Groups list | `/groups` | Read-only list. USER.md / memory views punt to web. |
| Config / providers | `/config` | Read-only: which providers are enabled + their curated models + their hasKey state. Editing punts to web ("Press w to open in browser"). |
| Welcome | `/welcome` | Triggered by a 409 from any data screen. Tells the operator to finish setup in the web UI (or via CLI), then press `r` to retry. |

**v1 NOT in scope (deferred to v1.1 / later BAZs):**

- Profile editor (SOUL.md / IDENTITY.md / BOOTSTRAP.md / AGENTS.md / TOOLS.md / HEARTBEAT.md textareas).
- Provider config (enabling providers, entering API keys, curating models).
- Skills install / import.
- Group USER.md editing.
- Per-group memory search and write.
- Profile-group templates editor + spawn.
- ChatGPT OAuth flow (`POST /auth/openai/login` requires loopback browser flow — same caveat as the CLI; surface link to the web for now).
- Theme switcher (ship with one good default; theming lands when there's demand).

### Auth model

Same fallback chain as the CLI (`apps/cli/src/client.ts:loadClientConfig`):

1. `BAZILION_SERVER` + `BAZILION_TOKEN` env vars win when both are set.
2. Otherwise read `~/.bazilion/auth.json` and use `auth.remote` if present (remote pairing target), else `auth.token` against `http://127.0.0.1:4321`.
3. CLI flags `--server <url>` / `--token <t>` override both (for ad-hoc testing).

`bazilion://pair?…` URL handling: TUI accepts the URL via `--pair <url>` flag OR `bazi pair` interactive prompt that parses the URL via `apps/mobile/src/pair-url.ts` (copied initially; consider extracting to `packages/pair-url` if a third consumer appears). Successful pair writes `auth.remote = {server, token}` into `~/.bazilion/auth.json` — matching what `bazilion login` does today.

### Streaming chat (the hardest piece)

`POST /api/agents/:id/chat` returns NDJSON `ChatFrame`s via `@bazilion/client`'s `stream()` async generator (already implemented at [packages/client/src/index.ts](../../../packages/client/src/index.ts)). The TUI's `use-chat-stream.ts` hook:

- Calls `client.stream<ChatFrame>('POST', `/api/agents/${id}/chat`, {message})` and pushes frames into a `useReducer` state.
- **Coalesces `assistant_delta` frames** into a `requestAnimationFrame`-equivalent batch (60ms window) to avoid React-thrashing the terminal — chat models can emit 200+ frames/sec, and re-rendering a 1000-line scrollback per token will flicker.
- **Partitions the chat view into two render zones**: finished messages live under Ink's `<Static>` (rendered once, never re-rendered) + the active in-flight assistant message is the only dynamic component. This is the same pattern Claude Code uses and is the difference between "fluid" and "stuttering".
- Wires Ctrl+C / `q` to abort: closes the response body (which triggers the daemon's `/cancel` agentId-keyed AbortController on its own — no extra HTTP call needed when the operator just wants to stop watching).
- Surfaces `kind:'fatal'` frames as an error toast; surfaces `tool_call` / `tool_result` as collapsed-by-default detail blocks the user can expand with `Enter`.

### Markdown rendering

`marked` + `cli-highlight` is the boring correct choice (mirrors what `apps/web`'s [lib/md.ts](../../../apps/web/src/lib/md.ts) does conceptually, since both apps use `marked`). DOMPurify is not needed — there's no DOM. Output is folded into an Ink `<Text/>` tree with ANSI colors. Known Windows-Terminal tokenizing issue with `cli-highlight` is real (substrings inside identifiers mis-colored) — ship the workaround of `--no-highlight` flag for users hitting it; the highlight tax for the rest is small.

### Packaging — `bun build --compile`

Builds per platform run via `pnpm --filter @bazilion/tui compile:<target>`. Targets:

- `bun-darwin-arm64`
- `bun-darwin-x64`
- `bun-linux-x64`
- `bun-linux-arm64`
- `bun-windows-x64`

Output: `apps/tui/dist/bazi-<target>` (~80–100 MB each). The release pipeline (a follow-up CI workflow) runs all five in parallel matrix, hashes each, publishes them as GitHub Release assets on tag push. Bun is pinned in CI; **devs do not need Bun installed locally** — `pnpm dev` and `pnpm typecheck` use `tsx` (consistent with the rest of the monorepo). Only the release pipeline needs Bun.

The `bin` field in `apps/tui/package.json` points at the tsx entry for `pnpm dlx`-style local invocation; the compiled binary is the actual end-user artifact and is published outside npm (GitHub Releases + later Homebrew tap + Scoop bucket).

### Tooling exceptions

- `apps/tui` is **excluded from the root `tsconfig.json`** (mirrors `apps/web` / `apps/mobile`) because it uses JSX and needs `jsx: "react-jsx"` which the root base doesn't set. Run `pnpm --filter @bazilion/tui typecheck` for TUI-only TS checks. The whole-tree `typecheck` script intentionally skips it (same precedent as web/mobile).
- `apps/tui` **stays inside `biome.json`'s default include** — unlike `apps/web` and `apps/mobile`, it follows root conventions (single quotes, no semicolons, 2-space, 100-col) and Biome handles `.tsx` natively. No need to opt out.
- `apps/tui` is **excluded from the root `vitest run`** by directory globbing today, since Ink components need their own renderer. Add `apps/tui/vitest.config.ts` if/when component tests land; for v1 the unit tests are pure-TS (pair-url, markdown) and can run under the root vitest.

## Out of scope

- **TUI-side OAuth flows.** ChatGPT OAuth (`POST /auth/openai/login`) needs a loopback HTTP server + browser handoff. The CLI handles this with citty + qrcode-terminal; the TUI's first version will surface a "press `w` to log in via web" prompt instead of re-implementing the flow inside Ink. Revisit if user demand appears.
- **A TUI-native config editor.** Provider enable/disable + API-key entry + model curation are configuration ceremonies; doing them once via the web UI (or CLI) is fine. The TUI surfaces *status* but not *editing* in v1.
- **Skill import / management.** Same reasoning — install-once operation, fine to do via CLI or web.
- **Per-group memory write / search UI.** The shared-memory backend works fine, but a polished editor + search-result-with-snippets renderer is a separate piece of work. v1 shows the memory entries list as read-only.
- **Profile / profile-group editor.** v1 read-only.
- **Theme system.** Ship one good default — Charm-style palette. Add theming when a second theme is actually requested.
- **Replacing the CLI.** `apps/cli` keeps existing for scripting / one-shot ops. The TUI is an *additional* interactive surface, not a replacement. `bazilion agent spawn`, `bazilion serve`, `bazilion token create` stay in the CLI.
- **Web-feature catch-up.** Anything that doesn't have a v1 row in the screens table (above) is explicitly punted. Don't grow scope here; spawn a new BAZ.

## Open questions

1. **Binary name: `bazi` or `bazilion-tui` or `bz`?** Leaning `bazi` — short enough for muscle memory, distinct from `bazilion` (the CLI), doesn't collide with `bz` (which is taken by a few tools). Decide before publishing.
2. **Single binary or `bazilion tui` subcommand?** Could pack the TUI as a subcommand of the existing CLI rather than a separate binary. Pros: one install. Cons: explodes the CLI's `pnpm dlx bazilion` size by ~80 MB; couples release cadences. Leaning separate binary; revisit if users ask.
3. **Static markdown footnotes vs link-in-status-bar for clickable URLs?** TUI can't make links truly clickable across all terminals. Initial answer: render link as underlined coloured text with the URL appended in dim parentheses inline; OSC-8 hyperlinks supported in modern terminals (iTerm2, Kitty, WezTerm, Windows Terminal recent) as a progressive enhancement.
4. **Sidebar always-visible vs collapsible?** Leaning always-visible at ≥120-col, auto-collapsed below. Confirm after building it.
5. **Should the pair-url parser move to a shared `packages/pair-url`?** Three consumers (mobile, TUI, future browser SPA) would justify extracting. v1: just copy from mobile (10 LOC, zero deps); extract on the third consumer.

## Decisions (resolved 2026-05-25)

1. **Stack:** TypeScript + Ink + React, packaged via `bun build --compile`. (See "Framework decision" in the header note for the why.)
2. **Dev runtime is `tsx`, not Bun.** Matches the rest of the monorepo's `pnpm tsx …` convention. Bun is only required in the release pipeline. Devs don't need Bun installed to develop the TUI.
3. **Reuse `@bazilion/client` and `@bazilion/api-types` directly** — no wire-type re-declaration anywhere in `apps/tui`.
4. **Markdown:** `marked` + `cli-highlight`. Output folded into Ink `<Text/>` tree.
5. **NDJSON consumption:** use `@bazilion/client`'s existing `stream()` generator. Coalesce `assistant_delta` into 60ms batches, partition chat view via `<Static>` for finished messages.
6. **Mirror, don't import, CLI's local `paths.ts` + `auth-file.ts`.** They're ~10 LOC each; cross-app imports between `apps/cli` and `apps/tui` would be awkward and CLAUDE.md's pragmatic-exception rule is scoped to CLI ↔ daemon, not app ↔ app.
7. **v1 ships read-mostly; write CRUD lands per-screen over v1.1/v1.2** (separate BAZs as scope demands). The framework is the load-bearing piece; getting it solid is more valuable than rushing 17 half-implemented forms.

## Tests

- **Pure-TS unit tests** (run under root `pnpm test`):
  - `apps/tui/test/pair-url.test.ts` — pair URL parsing (copy / port from `apps/mobile/test/pair-url.test.ts`).
  - `apps/tui/test/markdown.test.ts` — markdown renderer snapshots for: headings, lists, fenced code with language, links, inline code, blockquotes.
  - `apps/tui/test/use-chat-stream.test.ts` — the delta-coalescing reducer (pure logic, no Ink).
- **Ink-rendered smoke tests** (per-app `vitest` config, lands when first component test is needed):
  - `apps/tui/test/screens/agents-list.test.tsx` — render with a mocked client returning a small fixture, assert the list shows the names + statuses.
  - `apps/tui/test/screens/agent-chat.test.tsx` — feed a scripted async-iterator of `ChatFrame`s into `use-chat-stream`, assert the rendered output ends with the accumulated message text.
- **Manual / scripted acceptance:**
  - `pnpm --filter @bazilion/tui dev` against a running local daemon: agent list → chat → send message → watch streaming output → cancel mid-stream → see "cancelled" tool-error frame. Repeat against a remote (Tailscale) daemon paired via `bazi pair <url>`.
  - `pnpm --filter @bazilion/tui compile:darwin-arm64` produces a binary; running it from a clean shell with no Node/Bun/pnpm in PATH reaches the daemon and renders the agent list.
- **First-run regression:** with a fresh `~/.bazilion/` (deleted), launch the TUI → expect a clear "daemon not running, start with `bazilion serve`" error (not a stack trace, not a hang). Then start the daemon → relaunch → expect the welcome screen (because setup-gate 409 will fire on `/api/agents`) → finish setup via web → press `r` → expect the agent list.
- **TS check parity:** `pnpm --filter @bazilion/tui typecheck` runs cleanly. The root `pnpm typecheck` continues to ignore `apps/tui` (mirroring web/mobile precedent) and remains green.
- **Biome:** `pnpm lint` continues to pass with `apps/tui` included (no opt-out, unlike web/mobile).

## Deliverable

A new `apps/tui` workspace producing a TypeScript + Ink + React app that:

- Launches against the local daemon by default (or a remote one via env vars, `--server`/`--token` flags, or `bazi pair <url>`).
- Renders the v1 screen set (agent list, chat with streaming, inbox/triggers/profiles/groups/config as read-only).
- Compiles to a single per-platform binary via `bun build --compile`.
- Has its own per-app `typecheck` script, stays inside the root `biome.json` and root `vitest.config.ts` for pure-TS unit tests.
- Does not modify `apps/daemon`, `apps/web`, `apps/mobile`, `apps/cli`, or any `packages/*`.
