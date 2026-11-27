---
id: BAZ-088
title: "Questions in one card, quiet messages, recall across conversations, pictures from pictures"
status: draft
created: 2026-11-27
release: v0.63.0
---

# BAZ-088 — Questions in one card, quiet messages, recall across conversations, pictures from pictures

## Outcome

`ask_user` asks one question with two to four options, so an Agent with three things to settle
asks three times. It also has no way to ask for something only you can do. Every message to a
teammate starts a turn, even one it only needs to know about. `recall` reads only what a summary
replaced in the current conversation. `image_generate` works from words alone and holds the turn
until the picture is ready. Taken from OpenClaw's `ask_user`, `sessions_send`, `agents_wait`,
`sessions_search` and `image_generate`.

## Scope

- **Several questions:** `ask_user` takes several questions, shown in one card and answered
  together. A question can allow several choices. Free text and **Skip** stay.
- **Something only you can do:** `ask_user` takes an `action`: a sign-in, a confirmation in your
  bank's app, a cable to plug in. It carries instructions and an optional link and is answered
  with **Done** or **Can't**. It does not hold the turn: the Agent ends its turn, and your answer
  starts the next one in the same conversation. It shows wherever questions do: chat, Telegram,
  Attention.
- **Quiet messages:** `send_message` takes `wake: false`. The message goes to the inbox without
  starting a turn, and the recipient's next turn says unread messages are waiting.
- `wait_for_reply` takes several message ids and returns each reply as it arrives.
- **Recall everywhere:** `recall` takes `everywhere: true` to search the Agent's other
  conversations too, and it reads a message of another conversation by that conversation and the
  message's number. Only the Agent's own conversations, through a daemon host over
  `src/lib/conversation-search.ts`.
- **Pictures from pictures:** `image_generate` takes `references`, pictures from the workspace or
  the uploads to start from (an edit, a variation, a style), with the image models that accept
  them.
- **Pictures in the background:** `image_generate` answers at once and the turn goes on. When the
  picture is ready it is saved as a result and shown in chat, and the Agent is woken by BAZ-086's
  wake.

## Where it goes

- `src/runtime/tools/ask-user.ts`, `src/lib/questions.ts`, `src/routes/questions.ts`, the web
  question card, Telegram questions, `bazilion question`.
- `src/runtime/tools/messaging.ts`, `src/lib/messaging-host.ts`, the inbox wake in
  `src/lib/scheduler.ts`. `src/runtime/tools/recall.ts` and a new RPC host.
- `src/runtime/tools/image-generate.ts`, `src/lib/image-generation.ts`.
- Guides: [questions](../../questions.md), [Team Policy](../../team-policy.md),
  [conversations](../../conversations.md), [image generation](../../image-generation.md).

## Limits and open questions

- A sign-in in a headless managed browser needs `BROWSER_HEADLESS=false` or your running Chrome.
  The action's text says so.
- A quiet message that no later turn reads stays unread. It shows in the Connections tab.
- Which models accept references depends on the provider: OpenAI's image models do; through
  OpenRouter it depends on the model.
