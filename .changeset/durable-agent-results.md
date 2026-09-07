---
"bazilion": minor
"@bazilion/client": minor
"@bazilion/api-types": minor
---

Save explicitly delivered Agent files as immutable Team-owned results. Chat cards survive completion,
reload and restart; the Team Results view and `bazilion result` commands provide authenticated lookup,
safe previews, downloads and explicit deletion. Native chat preserves the browser handoff, and Telegram
sends the captured bytes through existing communication authorization and approvals.

Results retain source provenance and verified hashes in backup/restore. Released bytes remain until
explicit deletion, within a 25 MiB per-file and 1 GiB retained-byte limit. This changes the canonical alpha
database schema and requires the existing clean-install/reset workflow for older homes.
