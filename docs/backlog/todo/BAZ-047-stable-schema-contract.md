---
id: BAZ-047
title: Stable schema contract and in-place upgrades for beta
status: todo
size: L (1-2 weeks)
created: 2026-09-17
refined: 2026-09-17
priority: high
note: Retires the alpha clean-install contract. Grounded in the OpenClaw/Hermes storage comparison — see design/storage-comparison-openclaw-hermes.md.
---

# BAZ-047 - Stable schema contract and in-place upgrades for beta

## User stories

- **As an operator running Bazilion at home**, I want to upgrade in place without wiping my
  home — conversations, lessons, receipts, deliverables, and workspace files intact — so a
  release no longer costs me my agent's memory and my acceptance evidence.
- **As an operator with a failed upgrade**, I want the daemon to refuse a database it cannot
  read (or one that fails integrity checks) instead of opening or mutating it, so a bad binary
  can never corrupt the only copy of my data.
- **As a maintainer**, I want every applied migration recorded as a receipt inside the
  database, and CI to fail when the declared schema version and the migration chain disagree,
  so schema drift is caught before release, not during an operator's upgrade.
- **As a maintainer preparing a release**, I want a preflight check that tells me whether a
  given home can cross to the new schema, so upgrade failures surface in CI and in the
  updater, not in a wiped home.

## Goal

Replace the alpha clean-install contract with a versioned, forward-only, in-place schema
contract shaped like OpenClaw's, so homes upgrade across releases without data loss.

## Why

Every schema change since v0.15 (BAZ-040, 042, 044, 046) required a wipe: "0.19.x homes
cannot be upgraded in place." BAZ-002 even edited a migration in place because "the project
is alpha and we wipe DBs on shape changes." That contract cannot survive beta — real
operators accumulate irreplaceable agent memory. OpenClaw solved exactly this with a
forward-only versioned contract: migrations run on open, older builds refuse newer-schema
databases, downgrades are unsupported with a documented recovery path, `doctor --fix` records
per-migration receipts in `migration_runs`/`migration_sources`, and CI enforces the version
declaration. Hermes reached the same destination with a single versioned `state.db`. The
pattern is proven in this exact product class; the engineering is in the discipline, not the
novelty.

## Scope

- **Freeze a baseline.** Pick the current clean-install schema (`0001_init.sql` … current) as
  the immutable baseline for the migration chain. No migration is ever edited in place again.
- **Append-only migration chain.** New migrations are added, never rewritten. Each records a
  receipt (version, applied-at, checksum of the applied script) in a `migration_runs` table.
- **Schema version in the database.** The DB records its schema version; the binary records
  the versions it supports. Refuse-to-open when the database is newer than the binary; refuse
  when it is older than the binary's supported minimum, with an actionable message.
- **Backup before upgrade.** The upgrade path takes a BAZ-024-style verified online snapshot
  before applying migrations; a failed migration rolls the schema back from it.
- **Tested upgrade matrix.** CI boots a seeded home at N-1 (and ideally N-2, N-3), runs the
  upgrade, and asserts data survives: counts, spot-check rows, workspace files untouched.
- **Release gate step.** Extend the BAZ-032 pattern with a deterministic
  install → bootstrap → operate → upgrade → backup → restore gate that runs on release PRs.
- **Operator documentation.** An upgrade guide (supported versions, what happens on failure,
  how to restore the pre-upgrade snapshot) and a "which file does what" one-pager for the
  workspace/DB ownership map, modeled on Hermes' page and OpenClaw's tier table.
- **Downgrades are unsupported**, stated explicitly, with the documented recovery path being
  restore-from-backup.

## Out of scope

- Per-agent database split (OpenClaw's two-database model) — see BAZ-048.
- FTS over conversations, cold transcript archives — see BAZ-048.
- Restoring data from pre-alpha wiped homes.
- Rewriting historical migrations to undo the in-place edits already made.

## Tests

1. Home at N-1 upgrades in place to N with zero data loss; workspace files byte-identical.
2. A database at schema N+1 is refused by an N binary with a clear, actionable error; the DB
   file is untouched (mtime/hash unchanged).
3. A migration that fails mid-run leaves the schema at its prior version, and the home boots
   on the pre-upgrade snapshot.
4. `migration_runs` contains one receipt per applied migration, matching the chain on disk.
5. CI fails when the declared schema version, the migration files, and the DB version pragma
   disagree.
6. The release gate runs green from a fresh install and from each supported prior release.
7. Re-running the upgrade (interrupted then resumed) is idempotent and applies each
   migration at most once.

## Progress

**Slice 1 (this branch, `feat/beta-schema-contract`) — implemented:**

- `apps/daemon/src/core/db/migrate.ts` reworked from exact-match to a prefix contract:
  - An existing home upgrades forward on open: its ledger may be an unbroken **prefix** of
    the chain; pending migrations apply transactionally and are then integrity-checked
    against the canonical replay of the full chain.
  - **Tamper detection kept:** a home whose applied schema diverges from the canonical
    replay of its applied prefix (edited-in-place migration, corruption) still fails closed
    with `IncompatibleDatabaseError` and the existing reset guidance.
  - **Unknown ledger names** (newer *or* historical — indistinguishable by name) fail closed
    as incompatible, preserving the established contract in `legacy-schema-startup.test.ts`.
  - **Numeric refuse-newer** landed via `PRAGMA user_version` (= number of migrations in the
    chain), stamped by `runMigrations` on every fully migrated home. From the first future
    schema change onward, a database with `user_version` above the binary's supported
    version is refused with `DatabaseNewerThanBinaryError` (upgrade guidance; downgrades
    unsupported). OpenClaw-style versioning.
  - **Backup before upgrade:** `runMigrations(db, { preMigrationSnapshotPath })` snapshots
    the live home via synchronous `VACUUM INTO` before the first forward migration,
    integrity-checks the copy, and refuses to migrate if the snapshot is unusable. The
    daemon bootstrap (`ctx.ts`) always supplies a timestamped snapshot path beside the DB.
    `VACUUM INTO` never overwrites, so a retried upgrade keeps the first snapshot.
- Tests: `apps/daemon/test/core/db/migrations.test.ts` (8 cases: fresh install + idempotence,
  no snapshot on fresh DB, in-place upgrade with data preservation + verified snapshot,
  refuse-newer via `user_version` untouched, unknown-name refusal untouched,
  tampered-schema refusal, ledger-less refusal without mutation, version stamping).
  Full suite green (1814 passed).

**Still open in this BAZ:**

- First real `0002_*.sql` migration to exercise the forward path in production (the chain
  is still single-file, so the upgrade test self-skips its data-preservation assertion
  until then).
- Upgrade-matrix CI: boot a seeded home from the previous release tag and upgrade it
  (release-gate step extending the BAZ-032 pattern).
- Operator upgrade guide + "which file does what" ownership one-pager.
- Exported `listMigrations`/`schemaMigrationsSql`/`currentSchemaVersion` are groundwork for
  a future `bazilion doctor` / preflight CLI.

## As-built

_TBD._
