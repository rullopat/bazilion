---
id: BAZ-007
title: One-command install and dashboard launch
status: done
created: 2026-06-21
shipped: 2026-06-22
release: v0.6.0
---

# BAZ-007 — One-command install and dashboard launch

## Outcome

`npx bazilion dashboard` (or `bazilion dashboard` after `npm install -g bazilion`) starts
everything and opens the web UI. No source checkout, pnpm or port juggling.

## Scope

- The production web UI is bundled into the `bazilion` npm package (`dist/web`), served by
  `dist/web-server.js`.
- `bazilion dashboard` starts the daemon on `127.0.0.1:4321` and the web UI on `127.0.0.1:4322`,
  or reuses ones already running, prints the dashboard URL and how to get the sign-in token, and
  opens the browser.
- A port held by something other than Bazilion is reported with the flag to pick another port.
- The one-line installer script lives with the project website, outside this repository.

## As built

- CLI: `bazilion dashboard [--port N] [--host H] [--daemon-port N] [--daemon-host H]
  [--no-open]`; `bazilion serve [--port N] [--host H]` starts the daemon alone.
- Code: `apps/cli/src/commands/dashboard.ts`, `apps/cli/src/web-server.ts`; the CLI build copies
  the web build into the package.

## Known limits

- Windows is not supported.
- The daemon and web UI bind loopback; remote use goes through the
  [private gateway](../../private-gateway.md).
