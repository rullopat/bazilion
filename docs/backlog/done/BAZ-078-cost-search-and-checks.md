---
id: BAZ-078
title: Usage and cost, failed turns in Attention, conversation search, checks on CI
status: done
created: 2026-11-23
shipped: 2026-11-23
release: v0.56.0
---

# BAZ-078 — Usage and cost, failed turns in Attention, conversation search, checks on CI

## Outcome

Nothing goes wrong unnoticed: what Agents cost is on one page, a background turn that fails is
in Attention, and earlier conversations can be searched. On CI, pictures of the web UI and an
accessibility scan catch what the other tests cannot. Picked by the owner from the suggestions
after 0.55.0 (product 1, 2, 4, 5; technical 1, 3, 4).

## Scope

- **Manage → Usage** and `bazilion usage`: tokens and dollars per day, Team, Agent and model,
  read from the conversations' history; each conversation's use in its menu and in
  `conversation list`. Subscriptions and local servers count in tokens only.
- Attention kind `turn_failure`: failed follow-ups, Telegram messages and turns for new mail, one
  item per Agent and cause, opened again by a later failure.
- Search in Jump to and `bazilion conversation search`; a result opens on its message.
- When each schedule runs next; text previews for every kind of text file, and a text file's
  first lines on its tile; no blank template names.
- `e2e/pictures.e2e.test.ts` on Linux CI, with `pnpm pictures:accept`; axe-core on every page,
  light and dark, and a keyboard walk; what they found fixed.
- `TelegramCards`, `Rail` and `useChatSession` split into smaller modules.

## As built

- Daemon: `lib/usage.ts` (incremental reads of the session files, kept in memory),
  `routes/usage.ts`; `lib/conversation-search.ts`; `core/turn-failures.ts` and the
  `turn_failure` source in `core/attention.ts`; `nextRunAt` in `lib/scheduler.ts`. `plan` on the
  subscription providers. An acknowledgement made again updates its time.
- Web: `routes/usage/`, `components/usage/DayChart.tsx`, Jump to's **In conversations**,
  `lib/find-in-transcript.ts`, the Files text tile.
- Found by the new checks: muted text and code below 4.5:1, a link marked pressed, names that
  left out their visible text, controls inside fold headers, Team messages of one millisecond in
  no fixed order, the Agent's name shrinking to a letter in the conversation header.
- No schema change. No daily spending cap: the owner picked the totals.

## Known limits

- Calls outside conversations (learning reviews, provider tests, images) are not counted.
- Turns for new mail that failed are forgotten at a daemon restart.
- The picture references are Linux CI's; they are taken again when the runner's fonts change.
