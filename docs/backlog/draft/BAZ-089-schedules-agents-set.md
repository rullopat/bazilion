---
id: BAZ-089
title: "Schedules an Agent sets itself"
status: draft
created: 2026-11-27
release: v0.64.0
---

# BAZ-089 — Schedules an Agent sets itself

## Outcome

Only you can create a schedule: "remind me on Friday at nine", "check the deploy again in two
hours" or "summarise the inbox every morning" mean opening Schedules and typing it yourself. For
a personal assistant these are the most natural requests, in chat or on Telegram. After this story
the Agent sets the schedule while you talk, and you still see and control every schedule. Taken
from OpenClaw's `automations` (`cron`).

## Scope

- `schedule_add`: once at a given time, every interval, or a cron expression, together with the
  message the turn starts with. The schedule runs in the conversation it was set in, a Telegram
  topic included.
- `schedule_list`: the Agent's schedules and who set each. `schedule_remove`: only the ones the
  Agent set.
- **One-time schedules:** a new trigger kind that runs once and then shows as done.
- The Schedules sheet and `bazilion trigger list` show who set each schedule, and you can change
  or remove any of them.
- Times are the daemon's local time, as cron uses now. The tool's description gives the Agent the
  current time and time zone, so "Friday at nine" lands where you mean it.
- Agents can set schedules in every kind of turn, including a schedule's own turn, so "remind me
  again in an hour" works.

## Where it goes

- `src/runtime/tools/schedule.ts`, a schedule host with its RPC methods, `src/lib/scheduler.ts`,
  `src/lib/cron.ts`, the triggers repository in `src/core/repos/`.
- `agent_triggers` gains the `once` kind with its time, the conversation to run in, and the Agent
  that set it.
- `src/routes/triggers.ts`, `packages/api-types`, `apps/cli/src/commands/trigger.ts`, the
  Schedules sheet.
- Guide: [agent engine](../../agent-engine.md#9-scheduler).

## Limits and open questions

- There is no cap on how many schedules an Agent sets. The sheet lists them all, so you can see
  an Agent that keeps adding schedules, and remove them.
- A one-time schedule missed while the daemon was stopped follows the scheduler's existing rule
  for missed times.
- The `agent_triggers` change ships early, with 0.63.0's schema, so the home is reset only once
  ([the plan](../README.md#planned)).
- An Agent cannot change a schedule you set. To decide: whether it may pause one.
