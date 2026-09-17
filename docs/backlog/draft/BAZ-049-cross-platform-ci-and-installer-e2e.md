---
id: BAZ-049
title: Cross-platform CI matrix and fresh-machine installer E2E
status: draft
size: M (1 week)
created: 2026-09-17
priority: high
note: Beta blocker. CI is ubuntu-only while the product claims cross-platform support.
---

# BAZ-049 - Cross-platform CI matrix and fresh-machine installer E2E

## User stories

- **As a Windows operator installing Bazilion from the website**, I want the same
  first-run experience the Linux demo shows, so platform-specific breakage (paths,
  liveness, process handling) never reaches me.
- **As a maintainer**, I want the test suite and a daemon boot smoke running on
  macOS and Windows in CI, so a win32/darwin regression is caught in the PR that
  causes it, not by a beta user.

## Goal

Bazilion's cross-platform claims are executed, not just code-supported: CI runs the
suite on all three OSes, and a fresh-machine install → bootstrap → first agent →
uninstall E2E passes per OS.

## Why

`ci.yml` runs `ubuntu-latest` only, but the codebase has Windows-specific branches
(`daemon-liveness.ts:262` win32 handling, platform branches in the OpenAI OAuth
prompt) and BAZ-007 shipped one-line installers aimed at non-technical users — the
operator least able to diagnose a platform bug. The v0.20 snapshot work also added
platform-sensitive SQLite paths (`VACUUM INTO` targets, WAL files) that have never
run on Windows or macOS.

## Scope

- Add `strategy.matrix.os: [ubuntu-latest, macos-latest, windows-latest]` to the
  existing `ci.yml` `ci` job: typecheck, test, build, daemon boot smoke. The
  `upgrade-matrix` job stays ubuntu-only (heavy, and platform-neutral by design).
- A fresh-machine E2E script (or CI job): clean environment → installer → bootstrap →
  create team/agent → send one turn → `uninstall --yes` → home gone. Runs on the CI
  matrix; local runner equivalent for development.
- Fix whatever the Windows/macOS runs surface (expected: path separators in migration
  snapshot naming, spawn/signal semantics, tsx loader differences).

## Out of scope

- Per-OS release packaging changes (release.yml matrix) — follow-up if the E2E finds gaps.
- The mobile app — removed by BAZ-053.

## Tests

1. CI green on all three OSes for the current `main` (first run is the real test).
2. Fresh-machine E2E passes on all three OSes.
3. A deliberately Windows-broken change (e.g. hardcoded `/` in a new path join) is
   caught by CI, not shipped.
