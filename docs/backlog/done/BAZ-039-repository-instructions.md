---
id: BAZ-039
title: Repository instructions
status: done
created: 2026-09-07
shipped: 2026-09-14
release: v0.16.0
---

# BAZ-039 — Repository instructions

## Outcome

You can hand a Team a coding task in an existing repository ("fix the login bug") without
configuring anything first. The Agent works from the repository's own `AGENTS.md` instructions and
investigates the rest with its normal tools.

## Scope

- At the start of every turn the daemon reads `AGENTS.md` in the Team workspace root and, in
  Docker mode, in each directory down to the Team's working directory. Pi receives them as project
  instructions at the paths the model sees.
- The system prompt says an `AGENTS.md` governs its directory and everything below it, so the
  Agent reads deeper ones before editing there.
- A file counts only when it is a regular file of at most 128 KiB whose real path stays inside
  the workspace; anything else is skipped with a log line and never fails the turn.
- The Agent's own documents stay separate and are labelled Agent instructions; Pi's discovery of
  extensions, skills and context files stays off.

## As built

- Loader: `apps/daemon/src/lib/repository-instructions.ts`; passed to the worker as
  `repositoryInstructions`.
- There is no UI or API surface: the instructions reach the Agent, not you. Register a Team on a
  repository with `bazilion team add <slug> --link <path>` or the Teams page.
- Guide: [coding](../../coding-environments.md#repository-instructions).

## Not built

- Repository context previews, command suggestions, saved checks and a `repository_context`
  tool (removed): the Agent explores with `bash` and the file tools.
- Learning reviews receive no repository instructions.
