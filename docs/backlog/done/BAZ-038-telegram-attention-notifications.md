---
id: BAZ-038
title: Attention notifications on Telegram
status: done
created: 2026-09-07
shipped: 2026-09-08
release: v0.15.0
---

# BAZ-038 — Attention notifications on Telegram

## Outcome

When something needs you (a failed trigger, a lesson to decide, a paused queue), you hear about
it in the Telegram service topic, once per item and never during your quiet hours. Attention stays
the place where items are resolved.

## Scope

- Off by default. When on, each Attention item of a selected kind that opens or changes after you
  switched notifications on is posted once, with its title, Agent and Team, and a link when the
  web UI is published at `BAZILION_PUBLIC_ORIGIN`.
- Quiet hours: a start and end time in an IANA timezone (start inclusive, end exclusive;
  overnight windows work); notices wait until the window ends.
- The daemon checks every 30 seconds and sends at most 10 notices per check, only while the bot
  runs. A failed send is tried again on the next check; an item that closes and opens again is
  sent again.

## As built

- CLI: `bazilion notification settings`, `notification configure [--enable|--disable]
  [--kinds k1,k2] [--quiet-start HH:MM --quiet-end HH:MM --timezone Zone] [--clear-quiet-hours]`.
- Web: **Attention notifications** on `/config/integrations/telegram`.
- HTTP: `GET|PUT /api/notifications`.
- Tables: `notification_settings`, `attention_notified`; code:
  `apps/daemon/src/lib/notifications.ts`.
- Guide: [attention notifications](../../attention-notifications.md).

## Known limits

- A notice cut off by a restart can arrive twice; restoring a backup can repeat notices.
- No delivery receipts, previews or manual retries; a notice resolves nothing.
