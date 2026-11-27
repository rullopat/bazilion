---
id: BAZ-097
title: "The Agent in the workspace: views, theme, progress, a canvas"
status: draft
created: 2026-11-27
release: v0.65.0
---

# BAZ-097 — The Agent in the workspace: views, theme, progress, a canvas

## Outcome

An Agent can only write into the conversation. It cannot open the Changes view after a commit,
and it reports how far a long task has got only in prose. A chart it makes is a file to
download. After this story it can open a place in the workspace and follow a long task with a
card that updates. It can also put a small HTML or SVG page in the chat. Item 5 of BAZ-093,
taken from OpenClaw's `screen`, `theme` and `canvas`.

## Scope

- `screen` opens one of these in the tabs that show this Agent's conversation:
  - a panel tab (Agent, Team, Connections, Changes, Files);
  - a full-width view;
  - one of its own sheets (schedules, jobs, helpers, …).

  Nothing moves in a tab where you are looking at something else.
- `theme` switches to light, dark or the computer's setting, in those same tabs, for when you
  ask for it in chat.
- `progress` takes a list of steps, each to do, doing, done or failed, with an optional line.
  - The first call puts a card in the chat, and each later call updates that card. The
    conversation shows one card per task, not one per update.
  - The card stays in the conversation as it was last.
  - On Telegram the card is one message that is edited.
- `canvas` shows an HTML or SVG document (a chart, a table, a small page to look at) in the chat,
  in a sandboxed frame.
  - The frame has its own origin and runs scripts, with no network and no access to the page or
    to Bazilion.
  - It is saved as a Result, so **Files** keeps it and **Open** shows it full size.
  - An HTML or SVG file delivered with `deliver_file` gets the same view instead of only a
    download.

## Where it goes

- `src/runtime/tools/workspace.ts` for the four tools.
- A live event for `screen` and `theme` (`packages/api-types/src/live.ts`) that names the
  conversation; only tabs showing it act on it.
- On the web: the chat's steps (the progress card, the canvas frame), `lib/theme.ts` and the
  workspace route. `src/lib/telegram/` for the progress message.
- Guides: [workspace](../../workspace.md), [agent engine](../../agent-engine.md#5-tools).

## Limits and open questions

- The frame has no network, so a canvas that loads a library from a CDN will not run. The Agent
  is told to inline what it needs.
- `screen` and `theme` reach only the tabs open on that conversation at that moment, and the
  Agent is told so. A turn from Telegram or a schedule may have no one watching; nothing is
  kept for later.
- To decide: whether `theme` should exist at all. It is in OpenClaw's list, but a button you
  press yourself is quicker.
