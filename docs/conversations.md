# Conversations

Each Agent writes to one active conversation at a time and keeps the earlier ones. Starting a new
conversation gives the Agent an empty history; old conversations and their saved files stay
available to read, rename and continue.

A conversation starts as `Conversation N` and takes its name from the first message you send in
it (the first line, 60 characters at most), unless you named it yourself.

- **Web:** the menu at the top right of the chat lists the Agent's conversations. Pick an earlier
  one to read it; **Continue this conversation** makes it the active one. The menu also starts a
  **New conversation** and renames the one on screen. `/new` in the composer opens the same menu.
  A saved file in **Files** links to the conversation it came from.
- **CLI:**

  ```sh
  bazilion conversation list <agent> [--json]
  bazilion conversation show <agent> <conversation-id> [--json]
  bazilion conversation new <agent> [--title "Next task"]
  bazilion conversation rename <agent> <conversation-id> "Weekly report"
  bazilion conversation select <agent> <conversation-id>      # continue an earlier one
  ```

Starting or switching a conversation is refused while the Agent is running a turn; try again
when it finishes. Follow-ups that are already queued keep the conversation they were sent to. A
conversation whose history file is missing or unreadable cannot be continued.

If the active conversation's history file is missing or unreadable, the chat says so; start a new
conversation to continue. Nothing recreates or replaces a missing history.

Editing the last message in the web chat is refused when the Agent has switched to another
conversation since the page loaded; reload and try again.

## Search

Search finds the messages, yours and the Agents' replies, that hold every word you give, in
every Agent's conversations, newest first. It looks at what a conversation shows: tool output
and anything a summary replaced are not searched. A stored credential is never found, and is
taken out of what a result shows.

- **Web:** type three characters or more in **Jump to** (⌘K or Ctrl+K). **In conversations**
  lists the messages found; opening one shows its conversation at that message, marked for a
  moment.
- **CLI:** `bazilion conversation search "launch email" [--agent <id or name>] [--limit 20]
  [--json]` prints each message's Agent, conversation and time, the text around the words, and
  the command that shows the whole conversation.

## API

| Route | |
| --- | --- |
| `GET /api/conversations/search?q=launch%20email[&agent=<id>][&limit=20]` | Messages holding every word, newest first (at most 50); `truncated` when more matched |
| `GET /api/agents/:id/conversations?limit=20&offset=0` | Newest first, with `selectedId` (the active one) and each one's `usage` ([usage](usage.md)) |
| `POST /api/agents/:id/conversations` | `{title?}`: start a conversation and make it active |
| `GET /api/agents/:id/conversations/:conversationId` | Its messages (409 when its history is unreadable) |
| `PATCH /api/agents/:id/conversations/:conversationId` | `{title}`: 1–200 characters |
| `POST /api/agents/:id/conversations/:conversationId/select` | Make it the active one (409 while a turn runs or when its history is unreadable) |

The transcript of each conversation is Pi's session file `agents/<id>/sessions/<conversation-id>.jsonl`;
the database keeps titles and which conversation is active. Backups include both.
