# Upgrading Bazilion

How Bazilion's schema contract works, what happens when you upgrade, and how to recover
if an upgrade fails. Introduced by BAZ-047, which retired the alpha clean-install
contract (older releases required wiping the home on schema changes).

## The contract

- **Migrations are forward-only and append-only.** On startup the daemon applies any
  pending schema migrations to your `bazilion.db` inside transactions. You upgrade in
  place; your home — conversations, lessons, receipts, deliverables, workspace files —
  is preserved.
- **Every migration is recorded** in a `schema_migrations` ledger inside the database,
  and the database carries a numeric schema version (`PRAGMA user_version`).
- **A database newer than the binary is refused.** If you point an older Bazilion at a
  home written by a newer release, the daemon exits with `DatabaseNewerThanBinaryError`
  and does not touch the database. Downgrades are unsupported.
- **Unknown schemas fail closed.** If the database was written by an unsupported or
  historical release (or is corrupt/tampered), the daemon refuses to start with
  actionable reset guidance rather than guessing.
- **A backup is taken before the first migration.** Before applying a pending migration
  to an existing home, the daemon writes a transactionally consistent snapshot of the
  live database to `bazilion.pre-migration-<timestamp>.db` beside your database and
  verifies it. If the snapshot cannot be produced or verified, the upgrade aborts —
  nothing is migrated. The snapshot is never overwritten by a retry, so the copy from
  the first attempt survives.

## Before you upgrade

The daemon's pre-migration snapshot covers the database, but the belt-and-braces move
is a full home backup, which also covers `auth.json`, workspace files, and skills:

```sh
bazilion backup create   # see `bazilion backup inventory` for existing backups
```

`bazilion.db` and `auth.json` are an inseparable pair (the auth file seeds secret
encryption); back them up together.

## If an upgrade fails

1. **Stop the daemon.** A failed migration rolls back its transaction; the database is
   left at its prior schema version.
2. **Restore the pre-migration snapshot** if the database is somehow unusable: stop the
   daemon, replace `bazilion.db` with the newest `bazilion.pre-migration-*.db` from the
   same directory, and start the daemon again — it will re-attempt the upgrade. Delete
   or rename the used snapshot first so a later retry cannot confuse the two.
3. **Or restore a full home backup** via the backup CLI if non-database state is also
   affected (`bazilion backup restore`).
4. If the daemon *refuses to start* with an incompatible-schema message, the home was
   written by an unsupported release: preserve the entire home directory (keeping
   `bazilion.db` and `auth.json` together) and follow the reset guidance in the error.

## What is tested, per release

CI runs a release upgrade matrix (`scripts/migration-upgrade-matrix.mjs`) that seeds
genuine homes with real prior-release daemons and brings them up under the current
branch:

- **Upgradable sources** must upgrade in place with operator data preserved, take a
  pre-migration snapshot when the schema changed, and survive a second boot.
- **Non-upgradable sources** (documented legacy boundaries, e.g. pre-v0.20 homes) must
  be refused cleanly with the home untouched.

The matrix is part of the release checklist; the release notes state which prior
versions upgrade in place and which do not.
