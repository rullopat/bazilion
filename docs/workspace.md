# The web workspace

The web UI opens on one screen, the workspace (`/`): your Teams and their Agents on the left, the
open Agent's conversation in the middle, and everything about the work on the right. Agents and
Teams have no pages of their own: what used to be the Agent and Team pages is here.

## What is where

- **The list on the left** shows every Team with its Agents. Each Agent has one line that says
  what it is doing: `Needs you: 1 question`, `Needs you: 1 command to approve`,
  `Working: writing theme.js`, `Follow-ups paused`, `2 new files`, `New activity` or `Idle`. A
  Team's header sums its Agents up (`1 waiting · 2 working`). **New** spawns an Agent or a Team
  template, or registers a Team; the menu beside an Agent renames or archives it.
- **The conversation** is the chat with the open Agent. Tool calls read as steps (`Ran`, `Read`,
  `Wrote` with the lines added and removed); click one for its input and output. A message to a
  teammate is a hand-off card with what that teammate is doing now. Files an Agent delivers show
  where they were delivered, pictures as pictures. When a turn wrote files, **Review changes**
  opens their diff. A question from the Agent has one button per choice.
- **The bar above it** names the Agent, its Team and its model, and holds the conversation menu:
  read an earlier conversation, continue it, start a new one, rename one.
- **The side panel** has five tabs. **Agent**: model and reasoning, the Team it belongs to, and
  the ways into its schedules, learning, mailbox, skills, Telegram topic and browser. **Team**:
  members, USER.md, shared memory, settings. **Connections**: who may message whom and what they
  said lately. **Changes**: what the Team's workspace changed since a commit. **Files**: what its
  Agents delivered. The panel remembers its last tab; the button at the right of the bar hides it.
- **Three full-width views** take the place of the conversation, with the list folded to avatars:
  the Connections map ([Team Policy](team-policy.md)), Changes side by side
  ([change review](change-review.md)) and the Files gallery ([results](results.md)).
- **Sheets** open over the workspace for the deeper pages: an Agent's schedules, learning,
  mailbox, skills, Telegram and browser; a Team's USER.md, memory and settings.
- **Jump to** in the top bar (Ctrl+K, or ⌘K on a Mac) opens any Agent, Team, view or page by
  name. **Manage** holds the housekeeping pages: Agents, Teams, Agent templates, Team
  templates and Skills ([manage](manage.md)), and Setup.

On a narrow screen the list, the conversation and the panel take turns: pick an Agent to see its
conversation, and open the panel from the bar.

## The address

Everything on screen is in the query string of `/`, so a link lands on the same screen:

| Parameter | |
| --- | --- |
| `agent` | The Agent whose conversation is open |
| `team` | The Team in view when no Agent is open |
| `panel` | `agent`, `team`, `connections`, `changes`, `files`, or `none` to hide the panel |
| `view` | `connections`, `changes` or `files`: a full-width view of the Team |
| `conversation` | An earlier conversation to read |
| `file`, `result`, `note` | The changed path, saved file or memory note that is selected |
| `section` | The open sheet: `schedules`, `learning`, `mailbox`, `skills`, `telegram`, `browser`, `user-md`, `memory`, `settings` |

[Attention](attention-notifications.md) items link here, for example
`/?agent=<id>&section=learning`.

## What "new" means

`2 new files` and `New activity` compare an Agent with what this browser last saw of it: opening
an Agent's conversation marks it seen. The markers live in the browser, not in the daemon, so
another browser has its own.

## Outside the browser

```sh
bazilion activity [--team <team>] [--json]     # every Agent's state, as the list shows it
bazilion team messages <team> [--limit 50]     # what a Team's Agents said to each other
```

`GET /api/activity` returns one entry per Agent that is not archived: whether a turn runs and its
latest tool call, how many questions and shell approvals wait, whether its follow-up queue is
paused, when its conversation last changed and how many files it has saved. The web UI reads it
every three seconds while the tab is visible. `GET /api/teams/:id/messages?limit=100` lists the
messages a Team's Agents sent and received, newest first, and marks nothing read.
