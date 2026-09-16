---
"bazilion": minor
---

Live coding progress and retained diagnostics (BAZ-041), and read-only Git change review with bounded
source snapshots (BAZ-042).

- Coding commands stream bounded live progress, and their diagnostics are retained for seven days with
  explicit truncation, expiry and disclosure states. Released output can be reopened after navigation
  or a daemon restart.
- Git change review: list changes since a pinned baseline, read one file's bounded diff, and capture
  source snapshots — HEAD, the index and digests of changed files, never file content. Feedback is
  tied to the snapshot it was written against and is marked stale when that source moves.
- Coding receipts record the source state at their execution boundary, and a receipt's applicability is
  shown on the chat card as unchanged, changed or unknown — never as a pass.
- Model resolution fails closed: an unknown model id is refused instead of being sent to a provider
  default carrying another provider's credential.
- CLI: `team review show|capture|snapshots|snapshot`; repeated flags such as `agent chat --image` and
  `team review capture --include` now honour every occurrence instead of only the last.
