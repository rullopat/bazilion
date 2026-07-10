---
id: BAZ-013
title: Harness CLI policy show, import/export, and block history
status: todo
size: M (~1 week)
created: 2026-07-10
refined: 2026-07-10
priority: medium
note: Typed CLI management over BAZ-010/011 Team-template and Group-policy APIs. Import is validated and revision-aware; it does not bypass runtime enforcement or create a detached live-harness identity.
---

# BAZ-013 - Harness CLI policy show, import/export, and block history

**Status:** Todo. Ready to pull after BAZ-015 and BAZ-011.

## User stories

- **As an operator**, I want to inspect effective policy and recent denials from a terminal,
  so I can debug unattended or remote installs.
- **As an operator managing repeatable setups**, I want canonical import/export, so harness
  templates can be reviewed and version controlled.
- **As an automation author**, I want dry-run validation and stable exit codes, so scripts
  cannot apply malformed or stale policy silently.

## Goal

Add typed CLI commands for Team templates, Group-owned live policy, canonical JSON
import/export, evaluation, and block history using BAZ-015/011 production APIs. ADR 0001
ownership is normative: there is one Team-template roster and one effective live policy per
Group.

## Scope

- Add Team-template list/show/export/import commands over `/api/harness-templates`.
- Add Group policy show/policy/diff commands addressed by Group id; do not add a separate
  live-harness list or identity.
- Export a versioned canonical JSON document with stable slots and directed edges but no
  live agent secrets, paths, or local database ids that are not portable.
- Validate imports client-side and server-side; support dry-run and print the resolved diff.
- Require expected revision for every replacement. `--force` is client-side shorthand to
  refetch current state, print a fresh diff, require a second confirmation, and submit that
  current expected revision; it never bypasses 409 and does not claim a policy-mutation
  audit that BAZ-011 does not provide.
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
- `--force` still submits the freshly read expected revision and cannot overwrite a change
  that races after its refetch.
- JSON output is stable enough for scripts and contains no auth token, secret, filesystem
  path, or message payload.
- Block-history pagination and filters match the API.
- CLI evaluation never sends a message or creates a runtime block event.

## Tests

- Command parsing and snapshot tests for human/JSON output.
- Round-trip export/import fixtures for all four presets and repeated profiles.
- Validation, dry-run, conflict, non-interactive confirmation, auth, and exit-code tests.
- Block pagination/filter tests and full CLI build/repository suite.
