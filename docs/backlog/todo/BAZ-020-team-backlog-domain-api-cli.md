---
id: BAZ-020
title: Team backlog domain, API, and CLI
status: todo
size: M (~1 week)
created: 2026-08-02
refined: 2026-08-02
priority: high
note: Foundation for the visual board and agent integrations; Markdown files remain canonical.
---

# BAZ-020 - Team backlog domain, API, and CLI

**Status:** Todo. Refined and ready to implement.

## User stories

- **As an operator**, I want Bazilion to discover a Team project's existing
  `docs/backlog/{draft,todo,in_progress,done}` stories, so I can manage the same backlog from
  Bazilion without importing it into a second source of truth.
- **As a maintainer**, I want story changes to preserve the repository's Markdown format and use
  file moves for state transitions, so ordinary Git history remains a complete audit trail.
- **As a CLI user**, I want to list, inspect, create, edit, and move stories, so backlog work is
  scriptable and usable without the web UI.

## Goal

Add a Team-scoped backlog service over the established Bazilion story convention. The service
reads and writes files below `<team.path>/docs/backlog`, exposes the capability through authenticated
HTTP and CLI surfaces, and never creates a database mirror of story content.

## Decisions

- The Team filesystem is canonical. SQLite stores no story body, status, or cached projection.
- The supported states are `draft`, `todo`, `in_progress`, and `done`; directory and frontmatter
  status must agree.
- Story identity is the `BAZ-NNN` frontmatter id. Creation allocates the next unused numeric id
  while holding an in-process per-Team mutation lock and fails on a conflicting file.
- The first version supports the Bazilion convention exactly. Custom workflows, arbitrary columns,
  and non-Markdown trackers are follow-up work.
- Mutations are atomic filesystem operations. Bazilion does not commit or push Git changes.

## Scope

- Add hermetic backlog wire types for summaries, full stories, validation diagnostics, create/update
  requests, and state transitions.
- Implement a daemon-only parser and repository rooted at the selected Team path. Parse constrained
  YAML frontmatter without executing tags and retain the Markdown body verbatim.
- Validate ids, filenames, states, required frontmatter, path containment, duplicate ids, and the
  expected body sections. Return diagnostics for malformed files without hiding the rest of a board.
- Add authenticated Team routes to list the board, inspect a story, create a story, edit metadata/body,
  validate the backlog, and move a story between states.
- Add `bazilion backlog list|show|create|edit|move|validate <team>` with stable human-readable output
  and `--json` for automation.
- Create missing state directories and a minimal `docs/backlog/README.md` only on explicit backlog
  initialization; never overwrite an existing README.

## Acceptance criteria

- A Team linked to this repository produces the same ids, titles, statuses, sizes, and notes shown in
  `docs/backlog/README.md`, including a diagnostic rather than a crash for any malformed story.
- Creating a story produces `BAZ-NNN-short-slug.md` with required frontmatter and the standard User
  stories, Goal, Why, Scope, Out of scope, and Tests sections.
- Moving a story changes both its directory and `status:` frontmatter atomically; collisions and stale
  ids fail without modifying either file.
- Every resolved read/write path remains beneath the Team root even when the backlog contains symlinks
  or hostile filenames.
- HTTP and CLI provide parity for list, show, create, update, move, and validate operations.
- Two concurrent create requests cannot allocate the same id within one daemon process.

## Out of scope

- A web board; delivered by BAZ-021.
- Agent-native tools, MCP exposure, or installable workflow skills; delivered by BAZ-022.
- Assigning a story to an Agent or automatically starting implementation work.
- Git commits, branches, pull requests, remote issue synchronization, comments, estimates, or sprints.
- General-purpose YAML or configurable workflow schemas.

## Tests

- Unit tests cover parsing, body preservation, id allocation, slugging, directory/frontmatter mismatch,
  malformed frontmatter, duplicate ids, symlink/path traversal, collision rollback, and concurrent create.
- Route tests cover auth, Team not found, missing backlog, degraded list results, CRUD, moves, and conflict
  responses.
- CLI tests cover every command, JSON output, validation failures, and daemon error rendering.
- Root tests, root/web typechecks, lint, build, and `git diff --check` pass.
