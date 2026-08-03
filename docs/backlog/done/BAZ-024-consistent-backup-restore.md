---
id: BAZ-024
title: SQLite-consistent backup and validated restore
status: done
size: M (~1 week)
created: 2026-08-02
refined: 2026-08-02
shipped: 2026-08-02
priority: high
note: Replace live WAL-file archiving and destructive-first restore with a staged, verified workflow.
---

# BAZ-024 - SQLite-consistent backup and validated restore

**Status:** Done (unreleased).

## User stories

- **As an operator**, I want an online backup to contain a consistent SQLite snapshot even while
  Bazilion is active, so a successful download is actually restorable.
- **As an operator restoring data**, I want the complete archive validated before my current home
  is replaced, so a corrupt or hostile archive cannot destroy the working installation.
- **As a maintainer**, I want rebuildable and transient database files excluded, so backups contain
  canonical state rather than inconsistent WAL/SHM or qmd index artifacts.

## Goal

Make `bazilion backup create` produce an archive with a transactionally consistent SQLite
snapshot, and make `backup restore` stage, validate, and safely swap the restored home only after
archive and SQLite checks pass. Ordinary files are captured during the archive walk rather than as
a cross-filesystem point-in-time snapshot.

## Decisions

- Use SQLite's online-backup mechanism for `bazilion.db`; never copy the live DB/WAL/SHM tuple as
  unrelated tar members.
- Exclude WAL/SHM files and rebuildable qmd index files from the archive.
- Validate archive member paths and link behavior before trusting extracted content.
- Extract into a fresh staging directory, require the canonical DB, and run SQLite integrity and
  foreign-key checks before changing the requested home.
- A forced replacement retains a rollback path until the staged home is installed successfully.
- Restore remains offline for the target daemon; `--force` authorizes replacement, not use of an
  unvalidated archive.
- Daemon startup and offline restore acquire one realpath-keyed sibling ownership record before
  SQLite/open or restore validation and hold it until DB close or completed install/rollback.
- Persist restore swap phases so a process death between renames remains fail-closed with an exact
  recovery path; only `restoring` and `installed` records from dead PIDs are automatically reclaimed.

## Scope

- Create a temporary online SQLite snapshot and archive it alongside canonical home files.
- Ensure temporary snapshot and download files and archive streams are cleaned up on success,
  error, and client cancellation.
- Reject absolute paths, `..` traversal, unsafe extraction shapes, corrupt gzip/tar data, missing
  DB state, and failed SQLite validation.
- Stage restore outside the destination, then replace the destination with rollback on failure.
- Preserve the existing CLI create/restore commands and clear operator-facing diagnostics.
- Add concurrent-write backup, corrupt archive, traversal, failed validation, rollback, and normal
  round-trip coverage.

## Acceptance criteria

- A backup taken while SQLite writes continue restores to a database that passes
  `PRAGMA integrity_check` and contains a transactionally valid point-in-time state.
- The archive does not contain `bazilion.db-wal`, `bazilion.db-shm`, or rebuildable qmd index files.
- Corrupt, truncated, traversal-bearing, or DB-invalid archives fail before the destination is
  deleted or overwritten.
- A failed forced restore leaves the original home recoverable and reports what happened.
- Successful restore retains canonical profiles, Agents, Teams, skills, sessions, auth, config,
  and secrets represented by the source home.
- Temporary files are removed after success, failure, or cancelled download.

## Out of scope

- Cloud upload, scheduling, retention policies, or remote backup catalogs.
- Backup encryption beyond the existing encrypted secret envelopes.
- Stable cross-version migrations; the alpha clean-install schema contract remains unchanged.
- Snapshotting files outside `~/.bazilion`, including external targets of symlinked Teams.

## As built

- `BazilionDb.backupTo` uses Node's SQLite online-backup API. The daemon serializes the short
  snapshot step, verifies SQLite integrity and foreign keys, then streams a portable npm-tar
  archive with backpressure while excluding the live DB journals and rebuildable qmd indexes.
- `backup create` downloads into an owner-only OS-temporary file, validates the completed archive,
  and atomically installs it without replacing a prior output on failure. Destinations inside
  `BAZILION_HOME` are rejected to prevent nested backups.
- Restore validates a private archive copy before extraction: portable contained paths, supported
  entry types, duplicates, non-directory traversal, and linked-Team leaf shape/target rules. It
  then checks `auth.json`, SQLite integrity and foreign keys, the exact current canonical schema,
  the active bootstrap-token pairing, canonical entity IDs, and their archived directory slots.
- Before installation, restore transactionally rebases the operational `profiles.dir`
  and `agents.dir` values to the requested home. The controlled staging-DB mutation uses a durable
  rollback journal, leaves no WAL/SHM/journal tuple, and is fully revalidated before the swap.
- Extraction preserves prevalidated absolute linked-Team targets and contained relative symlinks
  in ordinary work product. Escaping relative targets and entries beneath any link are rejected;
  validation and cache cleanup operate on linked-Team slots without following external targets.
- The validated payload is staged beside the target and swapped only after every check passes. A
  forced replacement retains the previous home until install succeeds and rolls it back on an
  install failure. A stable sibling ownership record closes startup and custom-port races across
  separate CLI invocations; realpath aliases share one identity. The phase record is fsynced as
  `swapping` before the first rename and `installed` afterward, while interrupted or double-failed
  swaps retain recovery instructions. Relative targets are canonicalized and filesystem root is
  refused; `--force` never bypasses the offline gate.
- Round-trip coverage proves profiles, Agents, Teams, skills, sessions, config, auth, and encrypted
  secrets survive after the source tree is unavailable. Concurrent-WAL, archive inventory,
  interrupted download, corrupt/truncated DB, incomplete or extended schema, invalid DB-derived
  paths, contained and escaping relative links, linked-Team targets, traversal, credential mismatch,
  custom-port/live-daemon, concurrent ownership reclaim, crash-phase recovery, root-target, and
  rollback regressions are also covered.

## Tests

- Online backup under concurrent committed writes, followed by SQLite integrity verification.
- Archive inventory coverage for DB snapshot inclusion and transient-index exclusion.
- Restore tests for round-trip, corrupt/truncated archives, traversal and unsafe links, missing or
  invalid DB, cross-home Profile/Agent rebasing, non-empty destination, forced replacement, and
  rollback preservation.
- Focused CLI/daemon tests, root typecheck, lint, build, and `git diff --check` pass.
