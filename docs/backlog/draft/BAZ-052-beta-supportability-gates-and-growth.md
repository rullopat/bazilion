---
id: BAZ-052
title: Beta supportability — security gate in CI, log rotation, growth documentation
status: draft
size: M (1 week)
created: 2026-09-17
priority: medium
note: Beta blocker (cheap half). Three supportability gaps verified present on 2026-09-17.
---

# BAZ-052 - Beta supportability — security gate in CI, log rotation, growth documentation

## User stories

- **As a maintainer**, I want the BAZ-032 adversarial security gate (60-case
  deterministic suite) running on every PR, so a security regression cannot merge
  because someone forgot to run a script.
- **As an operator running Bazilion for months**, I want daemon logs capped and
  rotated, so the home doesn't grow without bound while I'm not looking.
- **As an operator watching disk usage**, I want documented growth expectations for
  the database (coding command logs, source snapshots), so "is 800 MB normal?" has an
  answer.

## Goal

Close three verified supportability gaps: the security acceptance gate is manual, the
daemon's `logs/` directory has no rotation or cap, and DB growth expectations are
undocumented.

## Why

All three were verified on 2026-09-17: `scripts/security-acceptance.mjs` (the BAZ-032
release gate) appears in no workflow; `logsDir` is created in `ctx.ts` and written
without any rotation/cap logic anywhere in the daemon; and BAZ-041/042's
`coding_command_logs` and `source_snapshots` accumulate by design with no retention
story. Each is individually small; together they define whether a months-old beta home
is supportable.

## Scope

- **Security gate in CI:** new `ci.yml` job running `pnpm security:acceptance` on
  every PR. If the suite is too slow for every PR, split: fast cross-boundary cases
  per PR, full gate on release PRs — but never manual-only.
- **Log rotation:** size-capped, age-rotated daemon logs (per-day files with a
  retention cap, or rotating writer — implementation detail). Applies to `logs/` and
  any daemon-owned diagnostics output. Operator-configurable ceiling with sane default.
- **Growth documentation:** a section in the operator docs stating expected growth per
  artifact (sessions JSONL, `coding_command_logs`, `source_snapshots`,
  pre-migration snapshots), how to inspect sizes, and what's safe to prune. Note that
  structural retention/cold-archiving is deliberately deferred (BAZ-048).
- **Pre-migration snapshot hygiene:** `bazilion.pre-migration-*.db` files accumulate
  one per upgrade by design (kept for recovery); document their location and that
  they are safe to delete once an upgrade is confirmed good.

## Out of scope

- Structural DB retention / cold archives (BAZ-048, post-1.0).
- External log shipping / telemetry (none, by product stance).

## Tests

1. CI fails on a PR that violates a BAZ-032 security case (proven once, deliberately).
2. A log directory exercised past the cap stays under it; rotation preserves recent
   entries and drops the oldest.
3. Docs state per-artifact growth expectations with measured numbers from a soak home.
