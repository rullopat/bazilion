---
id: BAZ-086
title: "Commands that keep running, approvals that remember, file tools in Docker"
status: in_progress
created: 2026-11-27
release: v0.63.0
---

# BAZ-086 — Commands that keep running, approvals that remember, file tools in Docker

## Outcome

A command used to have to finish within its tool call, so an Agent could not start a dev server,
a watcher or a long build and come back to it. A dangerous command asked every time. In Docker
mode the Agent had no file tools. Now commands run in the background, an approval can be kept, a
review model can answer first, and the file tools work in Docker as on the host. Taken from
OpenClaw's `exec`, `process`, exec approvals and `apply_patch`.

## Scope

- **Background commands:** `bash` with `background: true`; `job_list`, `job_output` (unread
  output, waiting as long as the Agent asks), `job_input` (stdin, or an interrupt) and `job_stop`.
  A job runs until it ends or is stopped. One that ends unseen wakes the Agent in its conversation.
- Jobs in the Agent's side panel with output and **Stop**; `bazilion job list|show|stop`.
- **Always for this Agent** on the approval card, in a terminal chat (`a`) and on Telegram: a rule
  for the command's beginning, listed on the Tools page and by `bazilion approval rules|rm`.
- **Review:** `BAZILION_BASH_APPROVAL=review` and a **Command review** model on the Models page.
- **File tools in Docker** on container paths, and **`apply_patch`** in both modes.

## As built

- `lib/jobs.ts`: jobs owned by the daemon; on the host a process group, in Docker a container of
  the turn's image and mounts named apart from the turn's (`jobContainerPrefix`). Each job is
  `agents/<id>/jobs/<job>/job.json` and `output.log`: a stop stops them, the next start tells the
  Agents (`recoverJobs`). The job count is in the activity feed, so the sheet follows it.
- `lib/wakes.ts` and the scheduler: a **wake** is a turn of its own (`origin: 'wake'`) when the
  Agent is free. Jobs use it now; BAZ-088's pictures and answers will too.
- `core/command-rules.ts`, a `command_rules` table (migration `002-command-rules.sql`),
  `lib/bash-approval.ts:createTurnApprovalHost` (rule, then review, then the registry),
  `lib/command-review.ts` (one call through `completeOnce`; anything unreadable is passed on).
- `runtime/shell/container-paths.ts` and `file-tools.ts`, with `writeContainedFile` in
  `safe-files.ts`; `runtime/tools/apply-patch.ts`.

## Decided while building

- A rule covers only a single simple command: none of `; & | < > ( ) $` or a backtick, a
  backslash or a line break. `git push` therefore allows `git push --force` but never
  `git push && rm -rf ~`. The card says so and the prefix can be changed before it is saved.
- `bash` with `background: true` answers at once with what the job printed so far, rather than
  waiting for "first output". `job_output` waits for as long as the Agent asks.
- Wakes live in memory: a job's record queues its wake again after a restart.

## Limits

- The container network stays off, so a server in a Docker job cannot be reached from the browser.
- A host job's process is recognised after a crash by its start time; a process group that the
  job's command detached from is not tracked.
