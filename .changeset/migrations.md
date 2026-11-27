---
"bazilion": minor
---

**Upgrades keep your home.** A release with a new database schema used to refuse an existing home, and the only way on was a reset. Now the daemon upgrades the database when it starts. It first copies the database to `upgrades/` in the home, then applies the release's migrations in one transaction, which commits only when the result matches the new schema; a failed upgrade changes nothing. Homes from 0.26.0 to 0.62.0 are recognised and upgraded from there. A home that a later release has already upgraded is refused, with the way back (put the kept copy back) instead of reset advice. `bazilion backup restore` now takes backups from earlier releases, which the daemon upgrades when it next starts. Backups leave `upgrades/` out, and `bazilion uninstall` deletes it.
