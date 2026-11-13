---
id: BAZ-035
title: Conversation library
status: done
created: 2026-09-07
shipped: 2026-09-08
release: v0.15.0
---

# BAZ-035 — Conversation library

## Outcome

An Agent can start a fresh conversation without losing earlier ones: old conversations stay
readable and can be renamed, and their saved results stay available.

## Scope

- Each Agent has one active conversation and keeps the others. **New conversation** writes an
  empty session file and makes it active; it is refused while the Agent runs a turn.
- Old conversations can be listed, read and renamed (1–200 characters), not made active again.
- Queued follow-ups keep the conversation they were sent to.
- Editing the last message in the web chat sends the conversation the page shows and is refused
  when the active one changed meanwhile.
- A missing or unreadable history file is reported; nothing recreates it.

## As built

- CLI: `bazilion conversation list|show|new|rename <agent> …`.
- Web: the **Conversations** panel in the chat (`/new` opens it).
- HTTP: `GET|POST /api/agents/:id/conversations`,
  `GET|PATCH /api/agents/:id/conversations/:conversationId`.
- Storage: transcripts are Pi's `agents/<id>/sessions/<conversation-id>.jsonl`; tables
  `agent_conversations` (titles) and `agent_conversation_selection` (the active one).
- Guide: [conversations](../../conversations.md).

## Not built

- Search across conversations, resuming an old conversation, branching.
