---
id: BAZ-007
title: Simple installer and dashboard launch for non-technical users
status: done
size: M (≈1 week)
created: 2026-06-21
shipped: 2026-06-22
release: v0.6.0
priority: high
note: Inspired by OpenClaw's tabbed quickstart: one-liner installer, Windows equivalent, npm path, and hackable source path.
---

# BAZ-007 — Simple installer and dashboard launch for non-technical users

**Status:** Shipped in v0.6.0. `bazilion dashboard` starts or reuses the local
daemon, runs the bundled production web UI, prints the dashboard URL and token
path, and opens the browser by default.

**Dependency:** Packaging decision for the web UI. The story can ship either by
bundling a production web server/assets into the `bazilion` npm package or by
having the installer fetch a versioned web bundle next to the daemon. The user
contract matters more than the packaging mechanism.

## User stories

- **As a non-technical person trying Bazilion**, I want to paste one command into
  Terminal or PowerShell that installs everything required for the daemon and web
  UI, so I do not need to understand Node, pnpm, source checkouts, or ports.
- **As a returning user**, I want to run `bazilion dashboard` and have Bazilion
  start what it needs locally, then show me the web UI, so I do not have to keep
  track of separate daemon and web commands.
- **As a technical user or contributor**, I want the homepage to keep the npm and
  source-install paths visible, so I can still install globally or hack on the
  repo without the one-line installer hiding the underlying pieces.

## Goal

Ship a first-run install story that feels like OpenClaw's quickstart:

- **macOS / Linux one-liner:**
  `curl -fsSL https://bazilion.com/install.sh | bash`
- **Windows one-liner:**
  `irm https://bazilion.com/install.ps1 | iex`
- **npm path:**
  `npm install -g bazilion` followed by `bazilion dashboard`
- **Hackable path:**
  `git clone https://github.com/rullopat/bazilion.git`, `corepack enable`,
  `pnpm install`, then a source equivalent of `bazilion dashboard`

The one-liners must install at least:

- A compatible Node.js runtime if one is missing or too old.
- The Bazilion CLI/daemon.
- A runnable production web UI, without asking the user to clone the repo.
- Any small launcher metadata needed for `bazilion dashboard` to find the local
  web UI and daemon.

## Why now

The product is increasingly centered on the web UI: first-run provider setup,
templates, groups, inboxes, skills, MCP, browser automation, and Telegram config
are all much easier there than in the CLI. The current install flow sends a new
user through the hardest path before they see the easiest interface. Fixing this
turns the homepage CTA into a real non-technical onboarding path instead of a
developer-only quickstart.

## Scope

### Installer endpoints

- Add `install.sh` and `install.ps1` to the website deployment at
  `https://bazilion.com/install.sh` and `https://bazilion.com/install.ps1`.
- Each installer detects the platform, checks for a compatible Node.js runtime,
  and installs or upgrades only after printing what it will do.
- The installers are idempotent: re-running them upgrades Bazilion rather than
  creating duplicate checkouts, services, or launcher files.
- Installer output ends with exactly what to run next:
  `bazilion dashboard`.
- Failure output uses plain language and gives one next command where possible
  (`bazilion doctor`, a manual Node download URL, or a GitHub issue link).

### Web UI packaging

Pick one implementation path and document it in the As-built block when shipped:

- **Preferred:** include the production web UI in the `bazilion` npm package so
  `npm install -g bazilion` is enough for both daemon and dashboard.
- **Acceptable first cut:** installer downloads a versioned web UI bundle under
  `~/.bazilion/app/` while the npm package continues to own the CLI and daemon.

In both cases, normal users should not need `git clone`, `pnpm install`, or a
second terminal to reach the UI.

### CLI command

Add `bazilion dashboard` in the same mental model as `openclaw dashboard`:

- Ensures the daemon is running locally, or starts it in the foreground with
  readable logs if this is the first process.
- Starts the local web UI on `127.0.0.1:4322` by default, with `--port` and
  `--host` overrides matching the current web dev conventions where practical.
- Prints the URL and bootstrap-token location:
  `open http://127.0.0.1:4322` and `token: ~/.bazilion/auth.json`.
- Opens the browser by default on desktop platforms unless `--no-open` is passed.
- Never binds non-loopback by default. If a user passes `--host 0.0.0.0`, reuse
  the daemon's existing loud warning style.

### Homepage and docs

- Update the Bazilion homepage install area to a top-of-section tabbed quickstart
  with these tabs: `macOS / Linux`, `Windows`, `npm`, `Hackable`.
- Keep the current developer source path, but demote it from the default path.
- Update `/docs/getting-started/` after the command and installers actually work.
- The homepage snippets must not point at commands that are still unimplemented
  unless they are explicitly labelled as "planned" or "coming next".

## Out of scope

- Native desktop apps, tray icons, launch agents, Windows services, or auto-start
  at login. This story is a one-line installer plus dashboard launcher, not a
  full desktop distribution.
- Hosted Bazilion or account-based onboarding. The install remains local-first
  and single-user.
- Mobile pairing changes. Mobile can benefit from a running daemon later, but it
  is not part of this install simplification.
- Sandboxing third-party skills or changing the skill trust model.

## Acceptance criteria

- A fresh macOS or Linux machine with shell access can run the one-liner, then
  `bazilion dashboard`, and reach the web UI without cloning the repo manually.
- A fresh Windows machine can run the PowerShell one-liner, then
  `bazilion dashboard`, and reach the web UI without WSL.
- `npm install -g bazilion && bazilion dashboard` works on machines that already
  have Node 24+.
- `bazilion dashboard --help` documents ports, host binding, and browser-opening
  behavior.
- The command behaves sensibly if the daemon is already running: it reuses it
  instead of starting a second daemon on the same port.
- The command behaves sensibly if the web UI port is occupied: it prints the
  occupied port and suggests `--port`.
- The website homepage shows the four install paths in a tabbed quickstart
  before the lower-page feature sections.

## Tests

- **CLI unit/smoke tests:**
  - `bazilion dashboard --help` renders.
  - Dashboard launcher detects an already-running daemon via `/api/health`.
  - Dashboard launcher reports a clear error when the web UI asset/bundle is
    missing.
  - Port-conflict path is covered with a local occupied port fixture.
- **Packaging smoke:**
  - Build the published package, install it into a temp prefix, run
    `bazilion dashboard --no-open`, and assert both daemon health and the web UI
    root respond locally.
- **Installer smoke:**
  - Shell script dry-run mode covers missing Node, old Node, existing Node 24+,
    and re-run/upgrade paths.
  - PowerShell script has at least parser validation and a mocked install path
    before manual Windows verification.
- **Website check:**
  - `bazilion-web` builds successfully.
  - Homepage install tabs fit desktop and mobile widths without horizontal
    overflow or overlapping code snippets.

## As-built

- The production TanStack Start web UI is bundled into the published
  `bazilion` npm package under `dist/web`, with `dist/web-server.js` serving
  static assets and forwarding application routes to the built server handler.
- `bazilion dashboard` starts or reuses the daemon on `127.0.0.1:4321`, starts
  or reuses the web UI on `127.0.0.1:4322`, prints `dashboard:` and `token:`,
  and supports `--port`, `--host`, `--daemon-port`, `--daemon-host`, and
  `--no-open`.
- Port-conflict handling distinguishes a real Bazilion daemon/web UI from an
  unrelated process and suggests `--daemon-port` or `--port`.
- The website ships `https://bazilion.com/install.sh` and
  `https://bazilion.com/install.ps1`; both ensure Node 24+ via Volta where
  practical, install `bazilion`, verify `bazilion dashboard --help`, and end
  with `bazilion dashboard`.
- The homepage install area uses four tabs: macOS/Linux, Windows, npm, and
  Hackable. The npm and one-line paths now point at the dashboard flow, while
  the hackable path keeps the source checkout route visible.
