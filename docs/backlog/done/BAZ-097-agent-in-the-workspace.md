---
id: BAZ-097
title: "The Agent in the workspace: views, theme, progress, a canvas"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.65.0
---

# BAZ-097 — The Agent in the workspace: views, theme, progress, a canvas

## Outcome

An Agent could only write into the conversation: it could not open the Changes view after a
commit, it reported a long task's progress in prose, and a chart it made was a file to download.
Now it opens places in the workspace, follows a task with a card that updates, and shows a small
HTML or SVG page in the chat. Item 5 of BAZ-093, from OpenClaw's `screen`, `theme` and `canvas`.

## As built

- `runtime/tools/workspace.ts`: `screen` (a panel tab, a full-width view, a sheet, or back to the
  conversation), `theme`, `progress` and `canvas`.
- `screen` and `theme` go through a workspace host to a `workspace` live event
  (`packages/api-types/src/live.ts`), sent once to the connected browsers and never replayed to a
  tab that comes later. A tab acts only while it shows that Agent's current conversation
  (`components/workspace/agent-screen.ts`). The Agent is told when no browser was connected.
- `progress` takes a task and its steps (to do, doing, done, failed, with a line). The first
  call's tool-call id is the card's id; the transcript shows one card per id where it was first
  put, in the state of its latest call (`components/chat/Progress.tsx`). On Telegram the card is
  one message, edited (`progressText` in `lib/telegram/mirror.ts`).
- `canvas` saves an HTML page or an SVG drawing as a result. Results of those types, delivered
  ones too, show in a sealed frame (`components/files/CanvasFrame.tsx`): `srcdoc`, a sandbox with
  scripts but not same-origin, and a policy of its own put before what the Agent wrote, with no
  network. `GET /api/results/:id/canvas` hands it the text as inert text. A button shows it full
  size.
- Guides: [workspace](../../workspace.md#the-agent-in-the-workspace),
  [results](../../results.md), [agent engine](../../agent-engine.md#5-tools).

## Decided while building

- `progress` is offered in every turn; `screen` and `theme` in every turn too, and say when
  nobody saw them, rather than being kept from turns nobody watches.
- The frame grows with its page up to 640 px (a size that only shapes the layout); full size
  shows the rest.
- `theme` stays, as the story listed it: it changes the browser's own choice, as the menu does.

## Limits

- A canvas cannot load libraries from a CDN; the Agent is told to inline them.
- `screen` and `theme` reach only tabs open at that moment.
