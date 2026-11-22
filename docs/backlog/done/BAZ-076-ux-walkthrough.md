---
id: BAZ-076
title: The walkthrough's changes to the web app
status: done
created: 2026-11-22
shipped: 2026-11-22
release: v0.54.0
---

# BAZ-076 — The walkthrough's changes to the web app

## Outcome

The web app agrees with itself about what needs the operator, opens on something useful, and
every screen, the workspace's sheets included, is built from the same parts and speaks plainly.
The items and choices come from the UX walkthrough of 2026-11-22; the owner picked them all.

## Scope

- **Attention** lists an Agent's open question and command to approve first, with when it stops
  waiting; the top bar's count stays current; the tab title counts what waits.
- **"Waiting for you"** is the one phrase, in amber, for an Agent blocked on the operator.
- **The overview** fills `/` while nothing is open.
- **Top bar**: Attention · Manage · Setup, and a session menu with the theme and Log out.
- **Sheets** (schedules, learning, mailbox, skills, Telegram, browser, About you, memory,
  settings) on `ui/parts` and `ui/form`; schedules in words, with presets.
- **A new Team's USER.md starts empty**; previews read as plain text.
- **One dropdown** (Radix Select) everywhere; the Agent tab saves model and reasoning on change,
  with Undo; Files has one set of filters in the tab and in the gallery.
- **Jump to** with actions and recent conversations; `?`, `/`, Alt+↑/↓ and ⌘. / Ctrl+. shortcuts.
- Polish: headings in the text face except page titles and the Agent's name; one type scale; new
  files in one column, with a Markdown preview; a one-line conversation header; scrolling panel
  tabs; **Edit** under the message; a Team on its own does not list its members twice.
- Fixed: Manage → Skills squeezed a skill with a finding to one letter per line (0.53.0).

## As built

- Daemon: `lib/attention-waiting.ts` makes items of the question and approval registries;
  `core/attention.ts` puts them first and keeps `RECORDED_ATTENTION_KINDS` for Telegram
  notifications; `CommandApproval.createdAt`; `teams.insert` stores an empty USER.md and
  `DEFAULT_USER_MD` is gone (the prompt's section for an empty USER.md says how to fill it);
  `PUT /api/teams/:id/user-md` takes `expected` and refuses a stale save with 409.
- Web: `lib/attention-count.tsx`, `lib/page-title.tsx`, `lib/theme.ts`, `lib/schedules.ts`,
  `lib/markdown-text.ts`, `lib/shortcuts.ts`; `workspace/Overview.tsx`, `files/FileFilters.tsx`,
  `ShortcutsDialog.tsx`; `SelectMenu` in `ui/form.tsx`; `ListRow` keeps a notice on its own line.
- CLI: `bazilion activity` says `waiting for you`; `bazilion attention list` shows the new kinds.
- No schema change.

## Known limits

- Teams made before keep their starter USER.md text; clear it in About you.
- Questions and approvals live in the daemon's memory: a restart ends them.
- The palette's recent conversations come from the three Agents that were active last.
