---
id: BAZ-024
title: Consistent backup and checked restore
status: done
created: 2026-08-02
shipped: 2026-08-02
release: v0.11.0
---

# BAZ-024 — Consistent backup and checked restore

## Outcome

A backup taken while Bazilion runs restores cleanly, and a restore checks the whole archive
before it replaces anything, so a damaged or hostile archive cannot destroy a working home.

## Scope

- Create: an online SQLite snapshot (`backupTo`), checked with `PRAGMA integrity_check`, archived
  as `bazilion.db` with the rest of the home. Left out: the live database and its journals, the
  pidfile, the qmd indexes (rebuilt from the notes) and browser profiles.
- Restore: with the daemon stopped, the archive is listed and refused if it holds paths leaving
  the home, special files, entries below a symlink or links leaving the home (a linked Team slot
  is allowed). The database must pass the integrity check, match this release's schema and pair
  with the archived `auth.json`. Only then is the restored home swapped in.
- A non-empty target needs `--force`; its current data is deleted.

## As built

- CLI: `bazilion backup create [file]`, `bazilion backup restore <file> [--home <dir>]
  [--force]`.
- Web: **Download backup** on `/config` (`GET /api/backup`).
- Code: `apps/daemon/src/lib/backup.ts` (snapshot and archive), `apps/cli/src/commands/backup.ts`
  (download and restore).
- Guide: [backup, restore and reset](../../backup.md). Encryption: [BAZ-030](BAZ-030-encrypted-backups.md).

## Known limits

- Ordinary files are read during the archive walk, not as a point-in-time snapshot of the
  filesystem.
- Only the release that wrote a backup can restore it (the schema must match).
- A restore brings back tokens and sessions revoked after the backup was taken.
