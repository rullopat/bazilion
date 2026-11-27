---
id: BAZ-088
title: "Questions in one card, quiet messages, recall across conversations, pictures from pictures"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.63.0
---

# BAZ-088 — Questions in one card, quiet messages, recall across conversations, pictures from pictures

## Outcome

`ask_user` asked one question at a time and could not ask for something only you can do. Every
message to a teammate started a turn. `recall` read only the current conversation's summarized
part. `image_generate` worked from words alone and held the turn. Taken from OpenClaw's
`ask_user`, `sessions_send`, `agents_wait`, `sessions_search` and `image_generate`.

## Scope

- **Several questions** in one card, answered together; a question can allow several choices.
  Free text and **Skip** stay.
- **Something only you can do:** an `action` with instructions and an optional link, answered
  **Done** or **Can't**. It does not hold the turn; your answer starts the next one in the same
  conversation. Chat, Telegram, Attention and the CLI show it.
- **Quiet messages:** `send_message` with `wake: false` waits in the inbox; the recipient's next
  turn says unread messages wait. `wait_for_reply` takes several message ids.
- **Recall everywhere:** `recall` searches and reads the Agent's other conversations.
- **Pictures from pictures** (`references`) and **in the background**, with a wake when ready.

## As built

- `lib/questions.ts`: `{questions[]}` or `{action}`; answers `answers[]` (choice, choices, text,
  skip per question), `skip`, `done`, `cannot`. An action has no `expiresAt` and its answer queues
  a wake (`action:<id>`). Telegram posts one message per question (`bq:<card>:<i>:<c|s>`); a
  several-choice question is answered by reply. The web card answers a one-question card with one
  click, as before. `bazilion question answer` takes `--answer` per question, `--done`,
  `--cannot`, `--note`.
- `core/repos/messages.ts`: a quiet message has `wake: false` in its payload; inbox wakes skip it
  and `unreadCount` feeds the system prompt's line.
- `lib/recall-host.ts`: the turn's Agent's other conversations, read from their session files,
  credentials redacted; `deliver_file` with `result` shows a saved result again.
- `lib/image-generation.ts`: references go to OpenAI's `images/edits` as files, to ChatGPT as
  `input_image`, to OpenRouter as image input. The daemon reads them as the Agent's file tools do
  (`ContainerPaths` in Docker; the workspace and uploads on the host). In the background the
  picture is saved, then a wake asks the Agent to show it.

## Decided while building

- An action has no time limit, and lives in memory like a question: a restart forgets it.
- The unread count goes in the system prompt, not in a message of its own.
- A background picture is not stopped by the end of its turn; its wake is the BAZ-086 one.

## Limits

- A sign-in in a headless managed browser needs `BROWSER_HEADLESS=false` or your running Chrome.
- A quiet message that no later turn reads stays unread; the Connections tab shows it.
- Through OpenRouter, whether a model uses references depends on the model.
