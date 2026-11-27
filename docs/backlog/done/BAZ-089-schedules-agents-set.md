---
id: BAZ-089
title: "Schedules an Agent sets itself"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.64.0
---

# BAZ-089 — Schedules an Agent sets itself

## Outcome

Only you could create a schedule, though "remind me on Friday at nine" or "check the deploy
again in two hours" are natural requests in chat or on Telegram. Now the Agent sets it while you
talk, and you still see and control every schedule. Taken from OpenClaw's `automations`.

## Scope

- `schedule_add`: once at a given time, every interval, or a cron expression, together with the
  message the turn starts with. The schedule runs in the conversation it was set in, a Telegram
  topic included.
- `schedule_list`: the Agent's schedules and who set each. `schedule_remove`: only the ones the
  Agent set.
- **One-time schedules:** a new trigger kind that runs once and then shows as done.
- The Schedules sheet and `bazilion trigger list` show who set each schedule, and you can change
  or remove any of them.
- Times are the daemon's local time; the tool's description gives the current time and zone.
- Agents can set schedules in every kind of turn, including a schedule's own turn, so "remind me
  again in an hour" works.

## As built

- Migration `003-agent-schedules.sql` rebuilds `agent_triggers` with the `once` kind (`run_at`),
  `conversation_id` (null: the selected conversation) and `set_by` (`owner` or `agent`), keeping
  every schedule and its runs.
- `lib/schedule-host.ts` and `runtime/tools/schedule.ts`: `schedule_add` takes `at`
  ("YYYY-MM-DD HH:MM" on the daemon's clock, or ISO with an offset), `in_minutes`,
  `every_minutes` or `cron`. The tool description carries the time and zone when the turn starts.
- `lib/trigger-timing.ts` checks a timing the same way for the sheet, the CLI and the tool, and
  says when a schedule runs next. A one-time schedule is done when it has run at or after its
  time, so moving it to a later time makes it due again.
- An Agent-set schedule runs in its conversation while that exists, with a message saying the
  Agent set it. Every turn is mirrored to the Agent's Telegram topic, so a reminder arrives there.
- `PATCH /api/triggers/:id` takes `message` and a timing (sheet **Change…**,
  `bazilion trigger edit`); `bazilion trigger add --at` makes a one-time schedule.
  Guide: [agent engine](../../agent-engine.md#9-scheduler).

## Decided while building

- An Agent cannot pause or change a schedule you set; it only lists it.
- A one-time schedule whose time passed while the daemon was stopped runs at the next start, as
  an interval does.
- Changing a timing drops a run still waiting for the Agent; an interval keeps counting from its
  last run.

## Limits

- No cap on how many schedules an Agent sets; the sheet lists them all, so you can remove them.
- Times are the daemon's clock. A local time the clock skips (a daylight-saving change) is
  refused rather than moved.
