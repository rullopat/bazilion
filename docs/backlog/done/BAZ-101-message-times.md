---
id: BAZ-101
title: "When each message was sent, and a line for each day"
status: done
created: 2026-11-28
shipped: 2026-11-28
release: v0.66.0
---

# BAZ-101 — When each message was sent, and a line for each day

## Outcome

The conversation showed what was said but not when: a reply from this morning and one from last
week looked the same. Now every message shows its time, small, as in a messaging app, and a line
between days says which day the messages below it are from.

## As built

- `ProviderMessage.at`: Pi's own `timestamp` of each user, Agent and tool message, sent with the
  history (`runtime/pi/events.ts:piMessagesToProviderView`). The live turn stamps the message
  being sent and the reply as it starts; the saved history replaces them when the turn ends.
- `lib/message-time.ts`: the time (`toLocaleTimeString`, hours and minutes), the whole date for
  pointing at it, and the day's label: Today, Yesterday, the weekday within the last week,
  otherwise the date, with the year only when it is not this year's. Days change at local
  midnight; a daylight-saving day still counts as one.
- `Transcript.tsx`: a `<time>` under your messages (beside **Edit**), under the Agent's (beside
  Read aloud), and in the line of teammates' messages and updates; a line before the first
  message of each day. Both appear once the page runs in the browser, whose time zone they use, so
  the server's HTML and the first paint agree.
- Tests: `test/message-time.test.ts` (labels, midnight, a daylight-saving day), the entries keep
  `at`; the browser test checks the day line and the times, after a reload too.

## Decided while building

- Steps (commands, searches) have no time of their own: they belong to the message they lead to.
- No day label that stays at the top while scrolling.

## Limits

- A conversation left open past midnight keeps its labels until it next changes or is reloaded.
- Messages written before 0.66.0 have their times too: Pi always kept them.
