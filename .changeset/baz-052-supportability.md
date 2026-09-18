---
'bazilion': patch
---

BAZ-052: beta supportability. The BAZ-032 adversarial security gate (153 required cases) now runs as a CI job on every PR — the script fails closed on a missing, duplicate or renamed required case, so a security regression or a quietly deleted case cannot merge. New operator doc `docs/growth-and-retention.md` states the per-artifact growth model: coding evidence is bounded by design (7-day TTLs, 256 MB home-wide budget, content-addressed snapshots), messages and sessions grow with use (that is the record), pre-migration snapshots are safe to delete once an upgrade is confirmed good, and `logs/` is intentionally empty — the daemon writes no log files.
