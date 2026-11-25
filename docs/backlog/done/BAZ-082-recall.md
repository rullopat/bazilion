---
id: BAZ-082
title: "Recall: the Agent rereads what a summary replaced"
status: done
created: 2026-11-25
shipped: 2026-11-25
release: v0.60.0
---

# BAZ-082 — Recall: the Agent rereads what a summary replaced

## Outcome

Since 0.59.0 a long conversation is summarized, and the summary is all the model reads of its
older messages. They stay in the session file, but the Agent could not reach them, so an exact
value, a link or the owner's wording that the summary dropped was lost to it. The owner asked
whether to save memory before each compaction; we chose to let the Agent reread the summarized
messages instead. Nothing is guessed in advance, nothing is written to the Team's shared memory,
and it costs nothing until it is used.

## Scope

- A `recall` tool in every turn: search the summarized messages of the conversation by words,
  and read them in full by number.
- Tool calls and their results are searched and read too, without stored credentials.
- The system prompt's Memory section says older messages can be found with `recall`.
- In the transcript the step reads **Searched older messages for …** or **Reread older
  messages**, counted as a lookup.

## As built

- `runtime/tools/recall.ts`: `recallTool({ branch, secrets })` over `conversationHistory`; the
  summarized part ends where the latest compaction's kept part starts. A search lists the latest
  12 hits with a snippet each; a read returns up to 20 messages within about 20,000 characters.
- `runtime/pi/session.ts`: the tool reads the turn's own `SessionManager` branch, so a compaction
  made during the turn counts at once, and shares the turn's redaction list.
- `apps/web/src/lib/tool-steps.ts`: the step's words.
- No schema change, no new route: the CLI shows the step by its tool name, as it does for others.

## Known limits

- Only the current conversation, and only what was summarized: earlier conversations are not
  searched.
- A message longer than about 20,000 characters is cut even when read alone.
- Words are matched as written (case ignored), not by meaning.
