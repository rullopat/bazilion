---
id: BAZ-085
title: "Exchanges between Agents: no length limit, stopped by repetition or by you"
status: done
created: 2026-11-26
shipped: 2026-11-26
release: v0.62.0
---

# BAZ-085 — Exchanges between Agents: no length limit, stopped by repetition or by you

## Outcome

Since BAZ-025 a chain of messages between Agents stopped after eight replies. The owner's real
work came close: a sales pipeline through three specialists and three rounds of revisions on a
demo each used five of the eight steps, and neither was a loop. A higher number only moves the
wall, and asking the owner to let it continue interrupts them. So the number goes, and a loop
is stopped by what it looks like instead.

## Scope

- No limit on an exchange's length; the **Messages between Agents** setting is removed.
- A message its sender already sent the same Agent in the exchange (same words, case and
  punctuation aside) is not delivered; the sender is told to report to the user.
- A woken Agent reads the exchange so far and is told to end it when it no longer moves the first
  request forward, telling the user where it stands.
- The Connections tab shows the exchanges going on, with messages, time and use, and **Stop**.

## As built

- `lib/agent-loop-guard.ts`: `guardExchange` (repetition, stopped exchanges), `sameWords`,
  `recordExchangeStop`; stops stay in `agent_loop_break_events` (no schema change), with
  `reason` `repeated_message` or `stopped`, and `step_limit` for older rows.
- `lib/exchanges.ts`: the running turn of each exchange, `activeExchanges` (unread messages or a
  running turn, with use counted from the transcripts after each inbox wake),
  `stopExchange`, and `exchangeSoFar` (the first message and the latest eight, 160 characters
  each) added to the inbox wake.
- `GET /api/teams/:id/exchanges`, `POST /api/exchanges/:id/stop`; CLI `inbox exchanges`,
  `inbox stop`, `inbox stopped` (was `inbox loop-breaks`).
- Attention says **Agents went round in circles**; a stop by the user is not an item.

## Known limits

- Two Agents that keep asking each other new, different things are not stopped: the Agents judge
  it, and you can stop it.
- Repetition is the same words: a reworded repeat is not caught.
- Use counts the turns an exchange woke, not the turn that opened it.
