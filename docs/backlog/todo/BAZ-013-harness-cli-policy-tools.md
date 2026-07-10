---
id: BAZ-013
title: Harness CLI policy show, import/export, and block history
status: todo
size: M (~1 week)
created: 2026-07-10
refined: 2026-07-10
priority: medium
note: Typed CLI management over BAZ-010/011 APIs. Import is validated and revision-aware; it does not bypass runtime enforcement.
---

# BAZ-013 - Harness CLI policy show, import/export, and block history

**Status:** Todo. Ready to pull after BAZ-010 and BAZ-011.

## User stories

- **As an operator**, I want to inspect effective policy and recent denials from a terminal,
  so I can debug unattended or remote installs.
- **As an operator managing repeatable setups**, I want canonical import/export, so harness
  templates can be reviewed and version controlled.
- **As an automation author**, I want dry-run validation and stable exit codes, so scripts
  cannot apply malformed or stale policy silently.

## Goal

Add typed CLI commands for templates, live policy, canonical JSON import/export, evaluation,
and block history using production APIs.

## Scope

- Add harness template list/show/export/import commands.
- Add live harness list/show/policy/diff commands.
- Export a versioned canonical JSON document with stable slots and directed edges but no
  live agent secrets, paths, or local database ids that are not portable.
- Validate imports client-side and server-side; support dry-run and print the resolved diff.
- Require expected revision or an explicit force flag for replacement; force still uses the
  API's audited conflict path.
- Add side-effect-free evaluate and paginated block-history commands with source, target,
  channel, origin, reason, and time filters.
- Support human-readable tables and machine-readable JSON output with documented exit
  codes.
- Add completion/help text and client README examples.

## Out of scope

- Direct database writes, runtime bypass flags, workflow execution, or approval responses.
- A hosted template registry or signing system.
- Importing live agent ids as portable template identities.

## Acceptance criteria

- Export followed by dry-run import is semantically lossless for a template.
- Invalid endpoint kinds, missing slots, self edges, duplicates, and unknown versions fail
  before mutation with non-zero exit status.
- Import prints the policy/roster diff and requires explicit confirmation unless a
  non-interactive apply flag is supplied.
- Stale revisions never overwrite newer server state silently.
- JSON output is stable enough for scripts and contains no auth token, secret, filesystem
  path, or message payload.
- Block-history pagination and filters match the API.
- CLI evaluation never sends a message or creates a runtime block event.

## Tests

- Command parsing and snapshot tests for human/JSON output.
- Round-trip export/import fixtures for all four presets and repeated profiles.
- Validation, dry-run, conflict, non-interactive confirmation, auth, and exit-code tests.
- Block pagination/filter tests and full CLI build/repository suite.
