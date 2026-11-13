# Architecture

Bazilion is a local, single-user multi-agent application. One daemon owns all state, credentials
and the LLM/tool stack; the CLI and the web UI are clients of its HTTP API. Each Agent turn runs
in a short-lived worker process that drives the embedded Pi agent engine.

## Processes

```text
CLI (@bazilion/client) ── bearer token ──────────────────┐
                                                         ▼
Browser ── session + CSRF cookies ── web UI ──────── daemon ─── SQLite + files
                                     :4322            :4321
                                                         │
                                       ┌─────────────────┴──────────────┐
                                       ▼                                ▼
                                turn workers                  browser and MCP processes
                          (stdin / stdout / Node IPC)        (live across turns)
```

Both listeners bind loopback. Remote access goes through the web UI behind Tailscale Serve
([private gateway](private-gateway.md)); the daemon itself is never exposed. The web server
forwards the browser's session cookie to the daemon and never turns it into a bearer token.

| Location | Holds |
| --- | --- |
| `apps/daemon/src/core/` | SQLite schema and wrapper, repositories, domain operations, paths, config and secrets, the provider table |
| `apps/daemon/src/lib/` | Turn preparation and running, auth middleware, scheduler, and one module or directory per feature (browser, MCP, Telegram, Git review, …) |
| `apps/daemon/src/routes/` | HTTP routes |
| `apps/daemon/src/runtime/` | Pi session and system prompt, provider runtime, ChatGPT OAuth, tool definitions, shell, memory backend, worker process and IPC |
| `apps/cli/` | The `bazilion` CLI, the daemon and dashboard launchers, the offline `backup restore` and `uninstall` |
| `apps/web/` | TanStack Start web UI and its same-origin gateway to the daemon |
| `packages/api-types/` | HTTP and IPC wire types, with no dependencies |
| `packages/client/` | The fetch-based HTTP client used by the CLI and the web server |

Only the daemon imports daemon code at runtime. The CLI's offline commands import a few daemon
helpers (pidfile, schema), and CLI tests reach into the daemon for setup.

## State

```text
~/.bazilion/                  # or $BAZILION_HOME
  bazilion.db                 # every record, settings, encrypted secrets, tokens, saved results
  auth.json                   # bootstrap token; the CLI's remote target after `bazilion login`
  daemon.pid                  # PID of the running daemon
  agents/<id>/                # SOUL.md IDENTITY.md AGENTS.md TOOLS.md [BOOTSTRAP.md], sessions/, uploads/
  teams/<slug>/               # Team workspace (a directory, or a symlink to a project); memory/
  profiles/<id>/              # Agent templates
  skills/<name>/              # SKILL.md and helper files
  browsers/<agent-id>/        # managed browser profile (cookies, logins)
```

| Data | Lives in | Written by |
| --- | --- | --- |
| Agent documents | `agents/<id>/` | Copied from the Profile at spawn; the Agent edits them with `home_write`. `BOOTSTRAP.md` is read-only to it and removed by `bootstrap_done` |
| Profile documents | `profiles/<id>/` | You; existing Agents keep their own copies |
| Team USER.md | `teams.user_md` | You; Agents through `user_md_get` / `user_md_write` with an etag |
| Team memory | `teams/<slug>/memory/` | `memory_*` tools, the Team Memory page, `bazilion memory`; the qmd index beside the notes is rebuilt from them |
| Conversations | `agents/<id>/sessions/<id>.jsonl` | Pi; the database keeps titles and which one is active |
| Uploaded files | `agents/<id>/uploads/` | The daemon, for non-image attachments |
| Saved results | `agent_results` | `deliver_file` and `image_generate` |
| Learned lessons | `agent_reviews`, `agent_lesson_proposals`; shared lessons as `memory/lessons/<id>.md` | The learning reviewer proposes, you decide |
| Messages, triggers, queue, policy, tokens, sessions | SQLite | The daemon |
| Credentials | `secrets` (encrypted) | `/config`, `bazilion config set`, ChatGPT sign-in |
| Browser profiles | `browsers/<agent-id>/` | The browser; left out of backups |

Pi's session JSONL is the only transcript: there is no runs or events table. Agent documents live
outside the Team tree; the Team's own `AGENTS.md` files are read separately as
[repository instructions](coding-environments.md#repository-instructions).

The database uses `node:sqlite` with WAL and foreign keys; transactions are explicit
`BEGIN`/`COMMIT`/`ROLLBACK`. Only the daemon opens it while it runs: it writes `daemon.pid` first,
and a second daemon, `backup restore` and `uninstall` refuse a home whose pidfile names a live
process.

`apps/daemon/src/core/db/schema.sql` is the whole schema, and schema changes edit it directly. An
empty database gets it in one transaction; an existing one must match it (comments and whitespace
aside), otherwise the daemon refuses to start. There are no migrations: see [upgrades](upgrades.md).

## Authentication and secrets

On first start the daemon creates the home, the database and a bootstrap token, whose plaintext
it writes to `auth.json`. `bazilion.db` and `auth.json` are a pair: when only one of them exists,
or `auth.json` does not match the token row, the daemon refuses to start. The bootstrap token
cannot be revoked.

- The CLI sends the bootstrap token (or a device token) as a bearer. Every token has full access;
  a device token expires only when created with an expiry.
- The browser logs in with any active token and receives a session cookie and a session-bound
  CSRF cookie; the token itself is not stored. A session ends after 30 days without use, or when
  its token is revoked.
- Without a token only `POST /api/login` and a minimal `GET /api/health` answer. Until an
  enabled provider has a saved model, the API answers 409 except for configuration, auth, token,
  session and provider-test routes, and the web UI shows `/welcome`. Crossing that line creates the
  `default` Profile and the `default` Team.
- The web gateway checks Host and Origin, drops forwarding headers it does not expect, caps
  request bodies (64 KiB without a credential, 64 MiB with one) and requires the CSRF header for
  writes made with a session.

Settings are environment-variable-shaped keys. Plain values (URLs, ids) are in `config`; secrets
are AES-256-GCM envelopes in `secrets`, with the key derived from the bootstrap token (PBKDF2).
Anyone who can read both the database and `auth.json` can decrypt them. The daemon's effective
environment is its process environment over stored secrets over stored config.

## Turns

Every turn, whatever started it (web or CLI chat, a follow-up, Telegram, a trigger or an inbox
wake), is prepared and run the same way: the daemon resolves the Agent and its conversation,
starts a worker, hands it the turn on stdin and streams its NDJSON frames back. The worker has no
database handle; messaging, results, questions, search, image generation, browser and MCP calls go
back to the daemon over Node IPC. Cancelling is keyed by Agent id. Details:
[agent engine](agent-engine.md).

Provider tests, web search and image generation run in the daemon, which keeps their
credentials. The ChatGPT refresh token never leaves the daemon; a worker asks for a fresh access
token over IPC.

## Capabilities

- **Tools and skills.** Each turn gets an explicit tool list; Pi discovers no extensions, skills,
  prompt templates or context files. Skills are prompt text: each attached `SKILL.md` body is
  added to the system prompt, and its scripts run through `bash`.
- **Shell.** With `BAZILION_BASH_SANDBOX=off` (the default) Pi's file tools and `bash` run on the
  host in the Team directory, unisolated. With `docker`, only `bash` remains, and each command runs
  in a fresh network-less container. Optional dangerous-command approval pauses flagged commands.
  See [coding](coding-environments.md).
- **Teams and messages.** An Agent belongs to one Team: its workspace, USER.md, shared memory and
  policy. Agents message each other through the mailbox; [Team Policy](team-policy.md) limits who
  may message whom, and a hop limit stops message loops.
- **Scheduling.** An in-process scheduler (5 s tick) fires interval and cron triggers and wakes
  Agents that have unread mail. Each trigger occurrence runs at most once and is never retried.
- **Long-lived resources.** Browsers and MCP connections live in the daemon across turns and are
  reached from workers through IPC proxies. See [managed browser](browser-research.md) and
  [MCP](mcp.md).
- **Results.** Delivered files and generated images are stored in the database and survive the
  turn. See [results](results.md).
- **Code changes.** Tool output streams live; Git is read through one read-only capture for the
  Team Review page. See [change review](change-review.md).

## Not built

- A2A federation or any other remote-agent protocol: the HTTP API is the integration point.
- Native mobile apps: phones use the web UI through the private gateway.
- Windows. Bazilion is developed on Linux; macOS runs plain host execution and is untested.
