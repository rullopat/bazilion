---
'bazilion': minor
---

Make online backups use a verified SQLite snapshot instead of archiving live WAL state, and harden
restore with archive/link validation, auth-to-database checks, offline-daemon detection, staged
atomic installation, exact-schema verification, destination path rebasing, exclusive
daemon/restore ownership, crash-phase recovery markers, rollback, and failed-download cleanup.
Contained relative symlinks in work product are preserved while escaping targets remain rejected.
