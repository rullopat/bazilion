---
id: BAZ-037
title: Agent questions
status: done
created: 2026-09-07
shipped: 2026-09-08
release: v0.15.0
---

# BAZ-037 — Agent questions

## Outcome

When a preference is missing, an Agent can stop and ask you one clear question with choices,
wait for your answer from whichever surface you have at hand, and continue the same turn.

## Scope

- The `ask_user` tool: a prompt, two to four choices and an optional recommended choice. You pick
  a choice, write your own answer or skip; the first answer from any surface wins.
- Offered only when someone is there to answer: a foreground web chat, `bazilion agent chat` in a
  terminal, or a Telegram message. Scheduled, inbox, queued web/CLI and review turns do not get it.
- One waiting question per Agent; it waits up to five minutes, then the Agent continues knowing
  it got no answer.
- An answer is information only; it grants no permission. The question and its outcome are the
  tool call and result in the transcript.

## As built

- Web: the question appears under the chat with **Send answer** and **Skip**.
- CLI: the terminal chat prompts; from another terminal `bazilion question list <agent>` and
  `question answer <agent> <id> --choice N | --text "…" | --skip`.
- Telegram: the question is posted in the Agent's topic with a button per choice; a reply to it
  answers with text.
- HTTP: `GET /api/agents/:id/questions`, `POST /api/agents/:id/questions/:questionId/answer`.
- Waiting questions live in daemon memory (`apps/daemon/src/lib/questions.ts`); there is no table.
- Guide: [questions](../../questions.md).

## Known limits

- A daemon restart or a cancelled turn ends a waiting question without an answer.
