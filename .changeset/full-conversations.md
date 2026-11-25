---
"bazilion": minor
---

**Long conversations keep working.** When a conversation nears the model's window, a turn summarizes older messages and keeps the recent ones as they are. Before, compaction ran only on `/compact`, so a full conversation cut every reply to a few words. A reply the full window would have cut is redone after the summary.

**The whole conversation stays on the page.** Summarized messages stay above a divider: **Show the summary** shows what the Agent reads in their place. They also stay in an earlier conversation's view and in search. Editing the last message after a summary keeps the summary.

**How full the window is.** The conversation bar shows `41K / 272K`, amber past 80%. `bazilion agent chat-context` prints the same figure.

**Hand-offs that did not go out say so.** The hand-off card counts only messages that were sent, and marks a refused one `not sent`. It also finds a teammate addressed by name.
