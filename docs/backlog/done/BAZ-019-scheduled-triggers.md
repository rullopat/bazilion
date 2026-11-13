---
id: BAZ-019
title: Scheduled triggers
status: done
created: 2026-07-19
shipped: 2026-08-01
release: v0.10.0
---

# BAZ-019 — Scheduled triggers

## Outcome

An Agent can be woken on a schedule with a stored instruction, configured in one place: the
trigger carries both the schedule and what to do. Every run is listed with its outcome.

## Scope

- A trigger is an interval in seconds or a 5-field cron expression (daemon local time), plus the
  message the Agent receives. `HEARTBEAT.md` files are gone.
- The in-process scheduler (5 s tick) records each due occurrence in `trigger_dispatches` and runs
  it once, as an ordinary Agent turn in the Agent's selected conversation.
- A busy Agent leaves the occurrence pending until it is free; while one is open, later interval
  occurrences coalesce.
- An occurrence ends `succeeded`, `failed` or `cancelled` (the turn was cancelled, or the trigger
  was disabled or its Agent archived first). Nothing is retried; a failure shows in Attention as
  `trigger_failure`.
- A run cut short by a daemon stop is marked failed at the next start; a cron minute missed while
  the daemon was down is not caught up.

## As built

- CLI: `bazilion trigger add <agent> --every <seconds> | --cron "<expr>" --message "…"
  [--disabled]`, `trigger list <agent>`, `trigger enable|disable|rm <id>`,
  `trigger history <id> [--limit N]`.
- Web: the Agent's **Triggers** tab, with the run history.
- HTTP: `GET|POST /api/agents/:id/triggers`, `PATCH|DELETE /api/triggers/:id`,
  `GET /api/triggers/:id/dispatches`.
- Tables: `agent_triggers` (`last_fired_at` is the scheduling watermark, not proof of success) and
  `trigger_dispatches`.
- Settings: `BAZILION_SCHEDULER_TICK_MS`; `BAZILION_SCHEDULER=off` stops triggers and inbox wakes.

## Known limits

- No catch-up, retry or per-trigger conversation choice.
- A trigger turn has nobody to answer: no `ask_user`, and flagged shell commands are denied.
