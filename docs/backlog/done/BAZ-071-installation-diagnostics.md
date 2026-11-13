---
id: BAZ-071
title: Installation diagnostics
status: done
created: 2026-10-22
shipped: 2026-10-23
release: v0.24.0
---

# BAZ-071 — Installation diagnostics

## Outcome

A healthy installation is not reported as broken because an optional runtime piece (such as
Docker) is missing. `bazilion doctor` and the web configuration page show installation health
and the Agent runtime separately.

## Scope

- Installation health: the home, the database and `auth.json`, the directories, the skill
  library. `bazilion doctor` exits non-zero only when this is unhealthy.
- Agent runtime: the sandbox mode, dangerous-command approval and, in Docker mode, whether Docker
  and the image are ready, with remediation. Shown, but it does not change the exit status.
- Doctor also lists configured providers, web search backends, the scheduler and counts of
  triggers and tokens.

## As built

- CLI: `bazilion doctor`.
- Web: the installation health and Agent runtime cards on `/config`.
- HTTP: `GET /api/health/details` (authenticated); `GET /api/health` stays a minimal public probe.

## Known limits

- Doctor checks configuration, not that a model call or a Docker command succeeds; use
  `bazilion provider test <provider:model>` for a live provider check.
