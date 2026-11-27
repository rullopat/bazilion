---
id: BAZ-086
title: "Commands that keep running, approvals that remember, file tools in Docker"
status: draft
created: 2026-11-27
release: v0.63.0
---

# BAZ-086 — Commands that keep running, approvals that remember, file tools in Docker

## Outcome

A command has to finish within its tool call, so an Agent cannot start a dev server, a watcher or
a long build and come back to it. A dangerous command asks every time, even one you allowed
yesterday. In Docker mode the Agent has no file tools and edits with heredocs and `sed`. After
this story commands can run in the background, an approval can be kept, a review model can answer
in your place, and the file tools work in Docker as they do on the host. Taken from OpenClaw's
`exec`, `process`, exec approvals and `apply_patch`.

## Scope

- **Background commands.** `bash` takes `background: true` and answers with a job id and the
  first output. `job_list`, `job_output` (what is new since the last read), `job_input` (text for
  stdin, or an interrupt as Ctrl-C does) and `job_stop` act on the Agent's jobs.
- A job runs until it ends, the Agent stops it or you stop it: no clock ends it. When it ends
  after its turn, it wakes the Agent in the conversation that started it, with the exit code and
  the last output. BAZ-088's pictures use the same wake.
- Jobs show in the side panel with their output and **Stop**, and in `bazilion job list|show|stop`.
- In Docker a job is a detached container with the turn's image and mounts, network still off.
  On the host it is a detached process group. A daemon restart stops jobs and tells the Agent.
- **Always allow.** Approving a dangerous command offers **Always for this Agent**, for the
  command's program and subcommand (`git push`), which you can edit first. The rules are listed
  under Setup → Tools → Commands and in the CLI, and last until you remove them.
- **Review model.** `BAZILION_BASH_APPROVAL` gains `review`: a dangerous command goes first to a
  **Command review** model chosen under Setup → Models, which allows it, refuses it or passes it
  to you. When nobody is there to answer (a schedule, an inbox wake), a pass is a refusal, as now.
- **File tools in Docker.** `read`, `write`, `edit`, `grep`, `find` and `ls` take the container's
  paths: `/workspace` (`memory/` read-only), and `/inputs` and `/skills` (read-only). Each maps to
  the host folder behind it, and any other path is refused.
- **`apply_patch`**: one patch that adds, changes, moves and deletes several files, in both
  modes, under the same path rules.

## Where it goes

- `src/runtime/shell/`: `tooling.ts` (file tools in Docker, `apply_patch`), `docker.ts` (detached
  containers), `approval.ts` (rules, review). `src/lib/jobs.ts` with its RPC methods and the wake.
- `src/lib/bash-approval.ts`, a `command_rules` table and its migration, `src/core/services.ts`
  (the new choice and model function), routes, `packages/api-types`, `apps/cli/src/commands/`,
  the panel.
- Guides: [coding environments](../../coding-environments.md),
  [agent engine](../../agent-engine.md#5-tools), [tools](../../tools.md).

## Limits and open questions

- The container network stays off, so a server running in a Docker job cannot be reached from
  the browser. Opening it is a separate decision.
- A rule matches the start of a command, so `git push` also covers `git push --force`. To decide:
  whether the classifier's worst risks still ask under a rule.
- `command_rules` comes with its migration ([BAZ-094](../in_progress/BAZ-094-migrations.md)).
