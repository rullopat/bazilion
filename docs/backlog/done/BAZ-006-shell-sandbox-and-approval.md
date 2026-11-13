---
id: BAZ-006
title: Docker shell sandbox and dangerous-command approval
status: done
created: 2026-05-29
shipped: 2026-08-02
release: v0.11.0
---

# BAZ-006 — Docker shell sandbox and dangerous-command approval

## Outcome

Shell commands run without Bazilion's own credentials in their environment. Optionally, `bash`
runs in a fresh, network-less Docker container that sees only the Team workspace, so a command
cannot read `~/.ssh`, `auth.json` or the database. Separately, risky commands can pause for a
one-click approval in chat.

## Scope

- `BAZILION_BASH_SANDBOX=off|docker`, the same for every turn (chat, Telegram, follow-ups,
  schedules, inbox wakes). `off`: Pi's host tools in the Team directory. `docker`: only `bash`,
  one `docker run --rm` per command with the Team at `/workspace`, `memory/`, `/inputs` and
  attached skills read-only, no network, a read-only root, no host environment, the local image
  only. A Docker failure is the command's error; nothing falls back to the host.
- `BAZILION_BASH_SANDBOX_IMAGE` (default `debian:bookworm-slim`); a Team can set its own image and
  a working directory inside the Team.
- `BAZILION_BASH_APPROVAL=off|dangerous`: a classifier flags credential paths, broad deletes,
  `curl | sh`, uploads and `sudo`; the web chat and a terminal CLI chat can allow once, every
  unattended turn denies, and an unanswered request is denied after two minutes.
- Bazilion's own credentials (ChatGPT sign-in, MCP tokens, the Telegram bot token, the bootstrap
  token) are removed from the environment of workers, shell commands and MCP stdio servers.

## As built

- Settings on `/config/services` (**Agent Runtime → Agent Shell Security**) or
  `bazilion config set`; `bazilion doctor` and `/config` show Docker readiness.
- Team defaults: `bazilion team environment show <team>`, `team environment set <team>
  [--image …] [--cwd …]`, the Team page's **Docker sandbox defaults**,
  `GET|PUT /api/teams/:id/coding-environment`, table `team_coding_environments`.
- Approvals: `command_approval` chat events, `GET /api/shell-approvals?agentId=…`,
  `POST /api/shell-approvals/:id`; pending approvals live only in daemon memory.
- Guide: [coding](../../coding-environments.md).

## Known limits

- Host mode is unisolated: a command runs as the daemon user and can read the Bazilion home.
- The classifier is a tripwire, not a sandbox.
- Docker bind mounts need Docker Engine 25 or later; a detached process is not tracked.
