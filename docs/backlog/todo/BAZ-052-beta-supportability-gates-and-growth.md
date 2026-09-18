---
id: BAZ-052
title: Beta supportability — security gate in CI, growth documentation
status: todo
size: S (1 day; the M estimate assumed log rotation, which is a stale premise)
created: 2026-09-17
refined: 2026-09-18
priority: medium
note: Beta blocker (cheap half). Security gap verified present on 2026-09-17; growth docs verified missing on 2026-09-18.
---

# BAZ-052 - Beta supportability — security gate in CI, growth documentation

## User stories

- **As a maintainer**, I want the BAZ-032 adversarial security gate (153-case
  deterministic suite, ~1m50s) running on every PR, so a security regression cannot
  merge because someone forgot to run a script.
- **As an operator running Bazilion for months**, I want documented growth
  expectations per home artifact, so "is 800 MB normal?" has an answer and I know
  what is safe to prune.

## Goal

Close two supportability gaps: the security acceptance gate is manual-only, and home
growth expectations are undocumented. **The third draft gap (log rotation) is
dropped** — a stale premise: the daemon writes no log files.

## Why

Verified: `scripts/security-acceptance.mjs` (the BAZ-032 release gate) appears in no
workflow, so nothing enforces it between releases. And no operator document states
which home artifacts grow, how fast, or what is safe to delete. Each is individually
small; together they define whether a months-old beta home is supportable.

## Refinement decisions (2026-09-18)

1. **Log rotation is dropped as a work item — the premise was wrong.** The daemon
   writes no log files: `logs/` is created at bootstrap and wiped at uninstall but
   never written to; daemon diagnostics go to stdout (journald/launchd own the
   service log and its rotation). The growth doc states this explicitly so the
   question ("why is there a logs/ directory?") has a durable answer. A structural
   guarantee (nothing in the daemon ever writes to `logsDir`) is documentation, not
   a test — a lint-style assertion would be testing a convention.
2. **Security gate: one CI job, no split.** The suite is deterministic, docker-free
   and ~1m50s — fast enough for every PR. ubuntu-only (the manifest's test files
   already run in the 3-OS matrix where platform-relevant). Proving "CI fails on a
   violating PR" is done by construction in the as-built notes (the gate asserts 153
   required cases; removing one fails it) rather than by landing a deliberately
   broken PR.
3. **Growth documentation is a new operator doc** (`docs/growth-and-retention.md`),
   mirrored to the website like other docs pages. Content: per-artifact growth
   model — what makes it grow, how to inspect, what is safe to prune. Measured
   numbers from a real soak home are not available pre-1.0; the doc gives
   structural facts (bytes-per-row bounds, retention windows, budgets) instead of
   inventing soak data.

## Scope

- **Security gate in CI:** new `ci.yml` job (`security-acceptance`, ubuntu-latest)
  running `pnpm security:acceptance` on every PR, alongside the test matrix.
- **Growth documentation** — `docs/growth-and-retention.md` covering:
  - `bazilion.db` — the bounded part is genuinely bounded: `coding_command_logs`
    expire by TTL and are evicted under a 256 MB home-wide budget
    (`CODING_LOG_HOME_BYTES`, pruned on coding-command completion);
    `source_snapshots` are content-addressed (identical trees collapse to one row
    per Team), TTL'd and pruned on save; manifests hold paths and digests only,
    never file content. The unbounded part: `messages` and session metadata grow
    with usage — that is the product's history.
  - Sessions JSONL — `agents/<agentId>/sessions/<conversationId>.jsonl`, the
    canonical transcript, grows with turns. Not daemon-pruned; archiving after an
    agent is removed is safe, deleting under a live agent is not.
  - Uploads — `agents/<agentId>/uploads/`, one file per user attachment.
  - Pre-migration snapshots — `bazilion.pre-migration-*.db` beside the database,
    one per upgrade by design (kept for recovery); safe to delete once an upgrade
    is confirmed good.
  - `logs/` — created but never written; service diagnostics live in the service
    manager's journal, whose rotation it owns.
  - Pointers: structural retention/cold-archiving is deliberately deferred to
    BAZ-048 (post-1.0); no log shipping/telemetry exists by product stance.
- **Website mirror:** the new doc page plus index/redirects wiring, gated by
  `pnpm check:docs`.

## Out of scope

- Structural DB retention / cold archives (BAZ-048, post-1.0).
- External log shipping / telemetry (none, by product stance).
- Log rotation for `logs/` (nothing writes there; see refinement decision 1).

## Tests

1. The `security-acceptance` CI job runs the 153-case gate on every PR (as-built:
   job definition + one full local run; failure behavior is by construction — the
   script fails on any missing required case).
2. `pnpm check:docs` passes with the new growth doc wired into the website
   (pages, links, anchors).

## Open Questions

- None.
