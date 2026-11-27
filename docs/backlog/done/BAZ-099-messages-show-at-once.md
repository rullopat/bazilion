---
id: BAZ-099
title: "What happens elsewhere shows in the conversation at once"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.65.0
---

# BAZ-099 — What happens elsewhere shows in the conversation at once

## Outcome

When a teammate's message, a schedule, Telegram, a follow-up or the terminal added to the open
conversation, the chat said "There is new activity from elsewhere" and waited for **Show it**,
and a teammate's message was then folded under "Update from Mira". Now what arrives shows at
once, flashes for a moment, and a teammate's message reads as a message.

## As built

- `useSessionSync` loads the conversation again when its file moved without this tab, instead of
  raising the banner. One look at the head runs at a time; a change meanwhile has it look again.
- The live activity's `lastActivityAt` (the file's time) now asks for a look while a turn from
  elsewhere still runs, so its messages show as they are saved, not only when it ends.
- What a load brought is marked: the messages past those on screen flash twice and fade within
  4 s (`markArrived`, `.arrived-message`; a still ring under reduced motion). A reader who had
  scrolled up stays where they are, with **New messages ↓**.
- An open Edit holds the load until it is sent or cancelled; sending it after something arrived
  replaces nothing (the turn to replace is no longer the last), shows what arrived and keeps the
  text. A pending command approval of a turn from elsewhere keeps its card across a load, and a
  recovered turn stops counting as busy once the queue says no turn runs.
- A teammate's message shows open (`parseInboxWake`): sender with avatar and a link to their
  conversation, "wrote" or "replied", its text as Markdown; Bazilion's instructions to the Agent
  are folded under **What the Agent was told**. A wake not in that form shows as before.
- Guides: [workspace](../../workspace.md#live).

## Decided while building

- It covers every source, not only teammates: the banner was the same for all of them.
- The mark lasts 4 s; that only shapes what you see.

## Limits

- Another conversation of the same Agent, not the one on screen, is not loaded here.
- A long conversation is read whole on each load while a turn from elsewhere runs.
