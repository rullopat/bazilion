---
id: BAZ-036
title: Follow-up queue
status: done
created: 2026-09-07
shipped: 2026-09-08
release: v0.15.0
---

# BAZ-036 — Follow-up queue

## Outcome

You can send the next instruction while an Agent is busy and see it waiting. Waiting follow-ups
can be edited, removed or held back with a pause, and the queue is the same on the web, the CLI
and Telegram.

## Scope

- A message for a busy Agent waits in its queue and runs as its own turn when the Agent is free,
  oldest first, in the conversation it was sent to. Items are `pending`, `running`, `completed`,
  `failed` or `cancelled`; attachments are stored with the item.
- Edit (the text of a waiting item), remove (anything not running), pause, resume.
- Stop cancels the running turn, whatever started it, and pauses the queue when items are
  waiting.
- A daemon restart fails the item that was running (it never runs again) and pauses that Agent's
  queue, which Attention shows as `queue_interrupted`.
- A Telegram message delivered twice is queued once.
- Limits: 20 waiting or running items per Agent, 64 KiB of text and 16 attachments (25 MiB) each,
  256 MiB of attachments in total; finished items are deleted after seven days.

## As built

- CLI: `bazilion queue list|add|edit|remove|pause|resume <agent> …`; `bazilion agent cancel`.
- Web: **Queue follow-up** and the **Follow-ups** panel in the chat.
- Telegram: messages in an Agent topic, `/queue`, `/queue drop`, `/stop`, `/resume`.
- HTTP: `GET|POST /api/agents/:id/queue`, `PATCH|DELETE /api/agents/:id/queue/:itemId`,
  `POST /api/agents/:id/queue/control`.
- Tables: `user_queue_items`, `user_queue_controls`, `user_queue_attachments`.
- Guide: [follow-up queue](../../follow-up-queue.md).

## Known limits

- Follow-ups queued from the web or the CLI run unattended: no `ask_user`, and flagged shell
  commands are denied. Telegram follow-ups ask their questions in their topic.
- Restoring a backup runs again the items still waiting in it.
