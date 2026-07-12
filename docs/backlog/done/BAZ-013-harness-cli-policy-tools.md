---
id: BAZ-013
title: TeamPolicy CLI policy show, import/export, and block history
status: done
size: M (~1 week)
created: 2026-07-10
refined: 2026-07-10
priority: medium
note: Typed CLI management over BAZ-010/011 Team-template and Team-policy APIs. Import is validated and revision-aware; it does not bypass runtime enforcement or create a detached live-teamPolicy identity.
---

# BAZ-013 - TeamPolicy CLI policy show, import/export, and block history

**Status:** Done.

## User stories

- **As an operator**, I want to inspect effective policy and recent denials from a terminal,
  so I can debug unattended or remote installs.
- **As an operator managing repeatable setups**, I want canonical import/export, so teamPolicy
  templates can be reviewed and version controlled.
- **As an automation author**, I want dry-run validation and stable exit codes, so scripts
  cannot apply malformed or stale policy silently.

## Goal

Add typed CLI commands for Team templates, Team-owned live policy, canonical JSON
import/export, evaluation, and block history using BAZ-015/011 production APIs. ADR 0001
ownership is normative: there is one Team-template roster and one effective live policy per
Team.

## Scope

- Add Team-template list/show/export/import commands over `/api/team-templates`.
- Add Team policy show/policy/diff commands addressed by Team id; do not add a separate
  live-teamPolicy list or identity.
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

## As-built (2026-07-11)

- Added `bazilion team list|show|export|import` over canonical Team-template APIs. Export
  emits version-1 portable JSON with normalized stable slot references and directed edges;
  it excludes server slot UUIDs, credentials, paths, message bodies, and database-only ids.
- Added `bazilion team policy show|export|import|diff|evaluate|blocks`, always addressed by
  Team id. There is no detached live-teamPolicy list or identity.
- Team and Team imports validate before mutation, print resolved roster/policy diffs, offer
  dry-run, require explicit `--apply`, and use optimistic revisions. Existing Team
  replacement requires `--expected-revision`; Team documents carry their revision.
  `--force` refetches, prints the fresh diff, requires
  `--confirm-current-revision <n>`, and submits that same revision, so a later race still
  returns 409.
- Added client-side validation for document kind/version, endpoint kinds, missing and
  duplicate slots, self edges, duplicate edges, reasoning/layout/display shapes, and Team
  ownership. Canonical daemon validation remains the second gate.
- Extended durable block history with source, target, channel, origin, reason, from/to,
  cursor, and limit filters. CLI evaluation calls the side-effect-free evaluator and sends
  no message or durable block.
- Added human tables, stable JSON output, generated shell completion/help, README examples,
  and documented exit codes: success 0, operational failure 1, validation/confirmation 2,
  revision conflict 3, and authentication/authorization 4.
- Focused verification passed 21 tests covering all four preset-shaped round trips,
  repeated Profiles, validation, dry-run, confirmation, force, stale revisions, auth,
  output, filters, pagination, completion, and side-effect-free evaluation. Full
  verification passed 94 files / 734 tests, root and web typechecks, Biome lint (existing
  warnings only), root and web production builds, and `git diff --check`.
