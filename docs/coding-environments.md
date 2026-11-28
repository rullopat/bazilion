# Coding with Agents

Agents work on code with the `bash` tool and, when the sandbox is off, Pi's file tools. Ask for
the work ("fix this bug and run the relevant test") and the Agent runs what it needs. Output
streams into the chat while a command runs; the result carries the output and the exit code, and
a non-zero exit is a result to investigate. To work on an existing project, register a Team on it:
`bazilion team add my-app --link /path/to/my-app` (or **New → Create a team** in the web
workspace); the Team directory is the Agent's working directory. Review the changes under
**Changes** ([change review](change-review.md)).

## Repository instructions

When a turn starts, the daemon reads `AGENTS.md` in the Team workspace root and, in Docker mode,
in each directory down to the Team's working directory. Pi gets them as project instructions, at
the path the model sees (`/workspace/...` in Docker). The system prompt adds that an `AGENTS.md`
governs its directory and everything below it, so the Agent reads deeper ones before editing
there.

A file is used when it is a regular file of at most 128 KiB whose real path stays inside the Team
workspace; a link to another workspace file (such as `AGENTS.md -> CLAUDE.md`) is fine. Anything
else is skipped with a line in the daemon log, never an error. The Agent's own documents (its
`SOUL.md` and `IDENTITY.md`) are separate and labelled Agent instructions. Pi's own discovery of
extensions, skills, context files and prompt templates stays off, so a repository's `.pi/` runs
nothing.

## Host or Docker

`BAZILION_BASH_SANDBOX` applies to every turn: chat, Telegram, follow-ups, schedules and inbox.
Set it on the **Commands** card under **Setup → Tools** (`/config/tools`), which says whether
Docker has the image before you save, or with `bazilion config set BAZILION_BASH_SANDBOX docker`.

| Setting | What runs |
| --- | --- |
| `off` (default) | `bash` and Pi's file tools (`read`, `edit`, `write`, `grep`, `find`, `ls`) run on the host as the daemon's user, in the Team directory. Nothing is isolated. |
| `docker` | `bash` runs each command in a fresh container. The file tools take the container's paths (`/workspace`, `/inputs`, `/skills`) and reach only what commands see. |

`apply_patch` works in both: one patch that adds, changes, moves and deletes several files, every
change worked out before any file is written.

### File tools in Docker mode

`read`, `write`, `edit`, `grep`, `find`, `ls` and `apply_patch` take container paths and work on
the host folders behind the mounts: `/workspace` (with `memory/` read-only), `/inputs` and
`/skills` (both read-only). Any other path is refused. A path is checked by its real location, so
a symbolic link in the workspace cannot lead outside the mounts or into a read-only one; files are
opened without following a final link and checked again once open.

In Docker mode every command is one `docker run --rm` with:

- no network;
- the Team directory read/write at `/workspace`, with its `memory/` store read-only;
- the Agent's uploaded files read-only at `/inputs` and attached skills read-only under `/skills`;
- a read-only root filesystem and a 64 MiB `/tmp` that does not persist between commands;
- the daemon user's uid/gid, no capabilities, `no-new-privileges` and at most 256 processes;
- nothing from the host environment (`HOME` and `TMPDIR` are `/tmp`);
- the local image only: Bazilion never pulls.

Cancelling a turn removes its running container; containers a killed worker or a stopped daemon
left behind are removed at the end of the turn and when the daemon starts. Background jobs have
containers of their own, which outlive the turn (below). If Docker or the image
is missing, the command fails and the Agent sees the error; nothing falls back to the host.
`bazilion doctor` and **Setup → System** (`/config/system`) show whether the configured image is
available.

## The image

The default image is `debian:bookworm-slim` (`docker pull debian:bookworm-slim`). Any local image
with `/bin/bash` works; select it with `BAZILION_BASH_SANDBOX_IMAGE`. The example
[Dockerfile](../examples/coding-environment/Dockerfile) adds Node and pnpm:

```sh
docker build -t bazilion-coding:node26-pnpm12 examples/coding-environment
bazilion config set BAZILION_BASH_SANDBOX_IMAGE bazilion-coding:node26-pnpm12
```

There is no network inside the container, so dependencies must already be in the image or in the
workspace (for example an offline package store).

## Team defaults

A Team can name its own image and a working directory inside the Team; both apply only in Docker
mode. On the web, open **Settings** in the Team tab: **Commands in Docker** is under **Workspace**. From
the CLI:

```sh
bazilion team environment show <team>
bazilion team environment set <team> --image bazilion-coding:node26-pnpm12 --cwd app
bazilion team environment set <team> --image ''   # back to the installation image
```

The API is `GET`/`PUT /api/teams/:id/coding-environment` with `{"image": "…" | null, "cwd": "app"}`.
The directory must exist when it is saved, and neither it nor a parent inside the Team may be a
symbolic link.

## Credentials

Bazilion's own credentials are kept out of the environment of shell commands and MCP stdio
servers: the ChatGPT sign-in (`OPENAI_CODEX_OAUTH`), MCP bearer tokens (`MCP_TOKEN_*`), the
Telegram bot token and the bootstrap or CLI token (`BAZILION_TOKEN`). On the host, the provider
API keys and other secrets saved on `/config` are in the commands' environment, and a command runs
as the daemon's user: it can read the Bazilion home, including `auth.json` and the database whose
secrets that token decrypts. In Docker only the Team directory, the uploads and the attached skills
are mounted and no host environment is passed, so those stay out of reach.

An Agent's own secrets, the ones it asked for with `secret_request` or you gave it on its
**Secrets** sheet, are in its commands' environment by name in both modes; Docker gets them with
`--env NAME`, so a value is never on a command line. Other Agents' turns do not get them. See
[secrets an Agent asks for](questions.md#secrets-an-agent-asks-for).

## Background jobs

`bash` with `background: true` starts the command as a job and answers at once with its id and
what it printed so far: a dev server, a watcher, a long build. The daemon runs it, on the host as
its own process group or in Docker as a container of the turn's image and mounts (network still
off), and keeps it past the turn. The Agent reads new output with `job_output` (waiting as long
as it asks for new output or the end), types into it or interrupts it as Ctrl-C does with
`job_input`, stops it with `job_stop` and lists its jobs with `job_list`.

A job runs until it ends or is stopped, by the Agent or by you; no clock ends it. When one ends and
the Agent has not seen it end, the end wakes the Agent: a turn of its own in the conversation that
started the job, with the exit code and the end of the output, shown in the transcript as an
update. A job is approved like any other command before it starts.

**Background jobs** in the Agent's side panel lists them with their output and **Stop**; from a
terminal:

```sh
bazilion job list <agent>
bazilion job show <job-id>      # the end of its output
bazilion job stop <job-id>
```

Each job is `agents/<id>/jobs/<job-id>/` in the home (`job.json` and `output.log`). Its output
reaches `output.log` through the daemon with the values a turn takes out of command output (the
saved API keys and the Agent's own secrets) replaced by `[REDACTED]`, so the file never holds
them. A job ends when its command does. If a process it started in the background still holds its
output, the end comes 3 seconds later, and what that process prints is still added to the log. A daemon stop stops every job; the next start tells their
Agents. HTTP: `GET /api/agents/:id/jobs`,
`GET /api/jobs/:id`, `POST /api/jobs/:id/stop`.

## Dangerous-command approval

`BAZILION_BASH_APPROVAL` (**Dangerous commands** on the Commands card): `off` runs them, `dangerous`
asks you, and `review` asks a review model first. Commands a classifier flags pause for a decision:
credential paths, recursive deletes or permission changes outside the Team, piping a download into
a shell, uploads to remote hosts, `sudo` and environment dumps. The web chat shows **Allow once** /
**Deny**; a CLI chat in a terminal asks on stdin. A command still waiting after half a minute is
also posted in the Agent's [Telegram](telegram.md) topic, when it has one, with **Allow once** and
**Deny**; only the paired owner can use them, and the message shows the outcome once it is
decided anywhere (a terminal chat whose command was decided elsewhere says so and goes on). An unanswered request is denied after five minutes. Turns with nobody to ask
(Telegram, schedules, inbox wakes, queued follow-ups, piped CLI) deny flagged commands. Paths
inside the Team (or under `/workspace` in Docker) count as local.

**Always for this Agent** (on the card; `a` in a terminal chat; **Always** on Telegram) allows the
command and keeps a rule: from then on, that Agent's commands that start with the same words run
without asking, in every kind of turn. The card offers the program and its subcommand (`git push`)
and lets you change it. A rule applies only to a single simple command: one joined to another with
`;`, `&&` or `|`, or with a redirect or a substitution, still asks. The rules are listed under
**Commands allowed without asking** on the Tools page, with **Remove**, and in the CLI:

```sh
bazilion approval rules [--agent <id>]
bazilion approval rm <rule-id>
```

With `review`, a flagged command first goes to the **Command review** model (Setup → Models, or
`BAZILION_COMMAND_REVIEW_MODEL` as `provider:model`), which allows it, refuses it or passes it to
you; the card shows what it said. What it passes on asks you as with `dangerous`, and is denied
when nobody can answer. A model that cannot be reached, or whose answer cannot be read, passes the
command on. Without a review model chosen, `review` asks you.

The classifier is a tripwire, not a sandbox: a determined command can get around it. Pending
approvals are listed at `GET /api/shell-approvals?agentId=…` and answered with
`POST /api/shell-approvals/:id` and `{"decision": "allow" | "deny"}`, plus
`"remember": {"prefix": "git push"}` for a rule. Rules: `GET /api/command-rules[?agentId=]`,
`DELETE /api/command-rules/:id`.

## Limits

- Bind mounts use `bind-recursive=disabled`, which needs Docker Engine 25 or later.
- A process a command detaches from the worker's process group is not tracked; start it as a
  background job instead.
- A server in a Docker job has no network, so the Agent's browser cannot reach it.
- The Docker sandbox is used on Linux; elsewhere it is untested.
