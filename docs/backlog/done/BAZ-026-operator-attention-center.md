---
id: BAZ-026
title: Attention
status: done
created: 2026-08-04
shipped: 2026-08-05
release: v0.12.0
---

# BAZ-026 — Attention

## Outcome

One page, and a badge in the top navigation, shows what needs you, so you do not have to look
through every Agent's learning tab, trigger history and inbox. Each item says what happened and
links to where you resolve it.

## Scope

- A read model over existing records, not a second log or workflow:
  - `lesson_proposal`: lessons waiting for a decision (action required);
  - `review_failure`: failed or cancelled learning reviews;
  - `trigger_failure`: trigger runs that failed;
  - `agent_loop_break`: message chains stopped by the hop limit;
  - `queue_interrupted`: an Agent's follow-up queue paused by a daemon restart (action required).
- Failures and loop breaks can be acknowledged and unacknowledged; action-required items leave
  the list when you act on their source (decide the lesson, resume the queue).

## As built

- CLI: `bazilion attention list [--state open|acknowledged|all] [--kind …] [--json]`,
  `attention summary`, `attention acknowledge|unacknowledge <key> --yes`,
  `attention acknowledge-all --yes`.
- Web: **Attention** (`/attention`) and the badge in the navigation bar.
- HTTP: `GET /api/attention`, `GET /api/attention/summary`,
  `POST /api/attention/:key/acknowledge`, `DELETE /api/attention/:key/acknowledgement`,
  `POST /api/attention/acknowledge-all`.
- Table: `attention_acknowledgements`; code: `apps/daemon/src/core/attention.ts`.
- New items can also go to Telegram: [BAZ-038](BAZ-038-telegram-attention-notifications.md).

## Known limits

- Items are computed from their sources on each request; there is no history of resolved items.
