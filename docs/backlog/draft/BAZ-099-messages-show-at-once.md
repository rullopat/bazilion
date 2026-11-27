---
id: BAZ-099
title: "What happens elsewhere shows in the conversation at once"
status: draft
created: 2026-11-27
release: v0.65.0
---

# BAZ-099 — What happens elsewhere shows in the conversation at once

## Outcome

Something else can add to the open conversation: a teammate's message that wakes the Agent, a
schedule, Telegram, a follow-up or the terminal. When that happens, the chat says "There is new
activity from elsewhere" and waits for **Show it**. Even then, a teammate's message is folded
under "Update from Mira", one more click away. After this story new messages appear as they
come, marked for a moment so you see what arrived, and a teammate's message reads as a message.

## Scope

- **No banner:** when the conversation moves without this tab, the chat loads it again at once.
  If you were at the end, it follows the new messages. If you had scrolled up, it stays where
  you are, and **New messages ↓** at the bottom takes you down.
- What arrived is marked for a few seconds, as a message opened from a search is, then the mark
  fades.
- **A teammate's message shows open:**
  - who wrote it: name and avatar, with a link to their conversation;
  - whether it is a new request or a reply;
  - its text, rendered like an Agent's message.

  Bazilion's instructions to the Agent (reply with `send_message`, …) stay folded under **What
  the Agent was told**. Several messages in one wake show one after the other.
- A turn from elsewhere that is still running shows its messages as they are saved, not only
  when it ends. **Stop** works on it as it does now.
- Nothing you are writing is lost: the draft, its attachments and an open Edit stay as they
  were. A turn this tab is streaming is never reloaded under it, as now.

## Where it goes

- `components/chat/useSessionSync.ts` and `session-sync.ts`: reload instead of `stale`.
- `ChatPane.tsx`: the banner goes and the jump button comes.
- `Transcript.tsx` and `lib/inbox-presentation.ts`: the open teammate message and the mark.
- The daemon already pushes the activity that says the conversation moved. Nothing changes there
  unless a running turn needs its saved messages pushed sooner.
- Guides: [workspace](../../workspace.md), [conversations](../../conversations.md).

## Limits and open questions

- The mark lasts a few seconds; that only shapes what you see.
- Another conversation of the same Agent, not the one on screen, still shows in the conversation
  menu and not here.
- "Elsewhere" covers every source, not only teammates, because the banner was the same for all
  of them.
