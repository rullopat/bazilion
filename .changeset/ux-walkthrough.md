---
"bazilion": minor
---

The changes picked in the UX walkthrough: one meaning of "needs you", an overview to open on, the workspace's sheets on the shared parts, one dropdown, a palette that acts, and keyboard shortcuts. No schema change; a 0.53 home opens as it is.

- **Attention** lists an Agent's open question and command to approve first, with when each stops waiting, and **Answer** or **Decide** opens the conversation. The page keeps itself current, and so does the top bar's count, on every page. `bazilion attention list` shows them as `agent_question` and `command_approval`. They are never Telegram notifications.
- **Waiting for you**: an Agent blocked on a question or a command reads `Waiting for you` in amber in the list, its step, the line under the conversation, Jump to and the Team; green `working` means it is working. `bazilion activity` says the same.
- **The overview**: with nothing open, the workspace shows who is waiting for you, who is working, the Teams, the latest files and the Agents active last. The side panel stays closed until something is picked.
- **The top bar**: Attention, Manage and Setup are three links; the theme and Log out are in the session menu at the end.
- **Tab titles** name the page (`Mira · Launch — bazilion`) and count what waits for you (`(1) …`).
- **Sheets**: schedules, learning, mailbox, skills, Telegram, browser, About you (USER.md), memory and a Team's settings are built from the Setup cards and fields. Schedules read as words (`Weekdays at 09:00`) and are added in a dialog with presets; learning has one switch, the model menu and one Save; the mailbox names Agents instead of showing ids; memory notes are listed by title and read formatted; skills switch on and off.
- **USER.md**: a new Team's USER.md starts empty, and the Team tab invites you to write it; previews of USER.md and memory notes read as plain text. The About-you editor reads USER.md afresh when it opens, and a save made from text an Agent has since changed is refused (`PUT /api/teams/:id/user-md` takes an optional `expected`; 409 `user_md_changed`) instead of overwriting the Agent's lines. Its limit counts bytes, as the daemon does.
- **One dropdown** everywhere, drawn like the model menu. The Agent tab saves a model or reasoning change at once, with **Undo**. The Files tab and gallery filter by kind and by whom in the same way.
- **Jump to** lists Agents waiting for you first, then those working, then actions (a new conversation, add an Agent, switch the theme, the shortcuts), Agents by last activity, recent conversations, Teams, views and pages.
- **Shortcuts**: `?` lists them; `/` writes to the open Agent; Alt+↑/↓ (⌥ on a Mac) opens the previous or next Agent; ⌘. or Ctrl+. shows or hides the side panel.
- **Polish**: headings use the text face, except page titles and the Agent's name; one type scale; a new or deleted file opens in one column, and a new Markdown file has a Preview; the conversation header stays on one line; the panel's tabs scroll on a phone; **Edit** sits under your last message; a Team opened on its own does not list its members twice.
- **Fixed**: Manage → Skills showed a skill with a scan finding one letter per line (0.53.0).
