---
id: BAZ-094
title: "Upgrades keep your home: database migrations"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.63.0
---

# BAZ-094 — Upgrades keep your home: database migrations

## Outcome

The owner runs their company and personal work on Bazilion, on 0.62.0. Until now a release with a
new schema refused an existing home, and the only way forward was a reset that kept nothing. After
this story an upgrade migrates the home in place: the 0.62.0 home they have now included. It is
the first story of 0.63.0, because BAZ-086 and BAZ-089 change the schema.

## Scope

- **Versions.** A home carries its schema version in `PRAGMA user_version`. A fresh home gets
  `schema.sql` and the latest version.
- **Baseline.** Homes from 0.26.0 to 0.62.0 have no version. Such a home is version 1 when it
  matches `migrations/001-baseline.sql` exactly. That file is frozen, and it is the same as the
  schema in the `bazilion@0.62.0` tag.
- **Migrations.** `migrations/NNN-name.sql` turns version NNN - 1 into NNN. At startup the daemon:
  1. copies the database to `upgrades/bazilion-schema-<version>-<time>.db`, readable by the owner
     only;
  2. runs every pending migration in one transaction, with foreign keys checked at the end;
  3. commits only when the result matches `schema.sql`;
  4. logs what it did.
- **Refusals.** A failed upgrade, a newer home and an unknown schema are each refused, with the
  home left untouched. A newer home is never told to reset.
- `bazilion backup restore` takes backups from older releases too, and the daemon upgrades them
  when it starts. Backups leave `upgrades/` out, and `uninstall` deletes it.

## As built

- `apps/daemon/src/core/db/schema.ts`: `loadMigrations` (numbering; no transaction statements or
  owned pragmas), `readHomeSchema`, `initSchema`. Errors: `NewerDatabaseError`,
  `DatabaseUpgradeError`.
- The copy is written under a temporary name, synced to disk, then renamed, and dropped when the
  upgrade rolls back, so retries by the Mac service do not pile up copies. A migration that ends
  the transaction itself is reported as possibly kept, with the copy to put back.
- `auth.json` is checked against the database before an upgrade writes anything.
- Schemas are compared ignoring spacing around brackets and commas and double quotes around
  names: `ALTER TABLE ADD COLUMN` and `RENAME` write both.
- `test/core/migrations.test.ts`: the migrations give `schema.sql`; a table rebuild with rows that
  point at it; failed, auto-rolled-back and half-kept upgrades; newer homes; file rules; shipped
  migrations pinned by hash.
- Checked by hand against a home made by the published 0.62.0 (an Agent, a schedule, a stored
  key): stamped as version 1, refused cleanly by a failing migration 002, upgraded by a good one,
  and run again by 0.62.0 once the kept copy was put back. An independent review found six
  problems; all are fixed.

## Known limits

- Releases up to 0.62.0 call an upgraded home incompatible and suggest a reset. The upgrade guide
  says to put the kept copy back instead.
- Files in the home (documents, sessions, workspaces) have no migrations; none has needed one.
- There are no migrations from schemas before 0.26.0.
