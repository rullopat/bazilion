---
id: BAZ-081
title: Full conversations: automatic compaction, the whole history, a window meter
status: done
created: 2026-11-25
shipped: 2026-11-25
release: v0.59.0
---

# BAZ-081 — Full conversations: automatic compaction, the whole history, a window meter

## Outcome

A long conversation filled GPT-6.2 Astra's 272K window. Compaction ran only on `/compact`, so each
reply got the room left (16 tokens) and was cut after a few words; two hand-offs cut the same way
showed as sent. The owner chose automatic compaction, and asked how the history is kept and for a
token count. A browser-attach bug found the same day joined the release.

## Scope

- Pi's compaction on for every turn, with Pi's margins; a reply the full window cut is redone.
- One conversation: summarized messages stay in its file, on the page above a divider with
  **Show the summary**, in an earlier conversation's view and in search.
- A meter in the conversation bar (`41K / 272K`, amber past 80%); the same figure in
  `bazilion agent chat-context`.
- The hand-off card counts only hand-offs that went out, says `not sent` for a refused one, and
  finds a teammate addressed by name.
- Browser attach leaves the operator's downloads and settings alone (see the 0.59.0 release).

## As built

- Daemon: `runtime/pi/history.ts` (`branchOf`, `conversationHistory`, `contextUse`),
  `loadConversation`, `turnContextWindow` beside `ENDPOINT_CONTEXT_WINDOW`; the messages route,
  the `done` frame, earlier conversations and search use the whole branch; the `compaction`
  session event; truncate keeps what lies between the last message kept and the first dropped.
- Shared: `CompactionMark`, `ContextUse`, `ProviderMessage.isError`.
- Web: the `compacted` and `compacting` transcript entries, `WindowMeter` in
  `ConversationHeader.tsx`, `recipientOf` in `Steps.tsx`.
- Browser attach: `noDefaults`, focus emulation per Agent tab, downloads cancelled by frame.
- No schema change.

## Known limits

- The conversation's size is the model's own report for its last reply: unknown after a
  compaction until the next reply, and messages since that reply are not counted.
- A local server's model is taken to have a 32,768-token window, whatever it was loaded with.
- Each compaction is one model call over the conversation, billed like a turn.
