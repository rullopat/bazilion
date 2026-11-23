# The web workspace

The web UI opens on one screen, the workspace (`/`): your Teams and their Agents on the left, the
open Agent's conversation in the middle, and everything about the work on the right. Agents and
Teams have no pages of their own: what used to be the Agent and Team pages is here.

## What is where

- **The top bar** has **Jump to** (⌘K on a Mac, Ctrl+K elsewhere), then three places:
  **Attention** with the number of open items ([attention](attention-notifications.md)),
  **Manage** for Agents, Teams, templates and skills ([manage](manage.md)), and **Setup** for
  models, tools and connections. The person icon at the end holds the theme (light, dark or the
  same as the computer), desktop notifications (see below) and **Log out**.
- **The overview** fills the middle while nothing is open: who is waiting for you, who is
  working, every Team with its members, the latest files from every Team, and the Agents that were
  active last. A Team opened on its own shows its members with what each is doing, its views,
  **Today** (its day at a glance: hand-offs and replies between its Agents, files delivered,
  conversations worked in, questions and approvals waiting, newest first; `bazilion team today
  <team>` prints the same), its latest files and what its Agents said to each other lately.
- **The list on the left** shows every Team with its Agents. Each Agent has one line that says
  what it is doing: `Waiting for you: a question`, `Waiting for you: a command to approve`,
  `Working: writing theme.js`, `Follow-ups paused`, `2 new files`, `New activity` or `Idle`. A
  Team's header sums its Agents up (`1 waiting · 2 working`). **New** spawns an Agent or a Team
  template, or registers a Team; the menu beside an Agent renames or archives it.
- **The conversation** is the chat with the open Agent. Tool calls read as steps (`Ran`, `Read`,
  `Wrote` with the lines added and removed); click one for its input and output. A message to a
  teammate is a hand-off card with what that teammate is doing now. Files an Agent delivers show
  where they were delivered, pictures as pictures. When a turn wrote files, **Review changes**
  opens their diff. A question from the Agent has one button per choice. While an Agent waits on
  you, its step and the line under the conversation say `waiting for you` in amber, as the list
  does; green and `working` mean it is working. **Edit**, under your last message, appears on
  hover and replaces that turn. Going to another Agent and back opens the conversation where you
  left it (at the end if you were at the end), for as long as the page is open.
- **The bar above it** names the Agent, its Team and its model, and holds the conversation menu:
  read an earlier conversation, continue it, start a new one, rename one. An Agent that gave
  itself another name in its IDENTITY.md shows it too (`Sally · Sales Director`);
  the Agent tab offers to make it its name. Within a Team every Agent has its own name.
- **The side panel** has five tabs. **Agent**: model and reasoning, saved as soon as you pick
  them with an **Undo**; the Team it belongs to; the ways into its schedules, learning, mailbox,
  skills, Telegram topic and browser. **Team**: members (left out beside a Team's own overview),
  About you (USER.md), shared memory, settings, and the Team folder behind **Show the folder**.
  **Connections**: who may message whom and what they said lately. **Changes**: what the Team's
  workspace changed since a commit, shown only when the Team folder is a Git repository. **Files**:
  what its Agents delivered, by kind and by whom, with the same filters as the gallery. The panel
  remembers its last tab; the button at the right of the bar hides it.
- **Three full-width views** take the place of the conversation, with the list folded to avatars:
  the Connections map ([Team Policy](team-policy.md)), Changes ([change review](change-review.md))
  and the Files gallery ([results](results.md)).
- **Sheets** open over the workspace for the deeper pages: an Agent's schedules, learning,
  mailbox, skills, Telegram topic and browser; a Team's About you (USER.md), memory and settings.
  They are built from the same cards and fields as Setup and Manage.

On a narrow screen the list, the conversation and the panel take turns: pick an Agent to see its
conversation, and open the panel from the bar. Below 1,280 pixels the panel covers the page like
a dialog: Escape closes it and the page behind it cannot be reached until then. Its tabs scroll
sideways, keeping the open one in view. Above the list,
**Waiting for you** names the Agents waiting on a question or a command, up to three, with a link
to Attention for the rest.

## Live

The workspace, the top bar's count, the tab title and Attention update as things happen: the
daemon pushes what every Agent is doing and what is open in Attention over one event stream
(`GET /api/events`), so a question shows the moment it is asked. One tab per browser holds the
stream and shares it with the others. While it cannot connect (an older proxy, a daemon
restarting) the pages ask every few seconds instead, and the stream is tried again.

The stream also carries a digest of the Teams, Agents and templates. When it changes, because a
Team or an Agent was added, renamed, moved or archived from the CLI, by an Agent or in another
tab, the page loads its lists again: nothing needs a reload.

**Notify me on this computer**, in the person menu, turns on desktop notifications for this
browser, after the browser asks you. When an Agent starts waiting for you and no Bazilion tab has
the focus, a notification names the Agent and the question or command; clicking it opens the
conversation. Browsers offer notifications on `https://` addresses and on this computer
(`127.0.0.1`, `localhost`) only, and a browser that blocks them for the site is said so in the
menu. They come with the live updates: while the stream is down, none are shown.

Where the browser has no Web Locks (an `http://` address other than this computer), each tab has
its own stream while it is visible and lets go of it when hidden, so hidden tabs do not take up
the browser's few connections to the server. A stream ends within 20 seconds of its session being
signed out or expiring.

## Jump to, and the keyboard

**Jump to** lists the Agents waiting for you first, then those working, then actions (a new
conversation with the open Agent, adding an Agent, switching the theme, the keyboard shortcuts),
the other Agents by when they were last active, recent conversations, Teams, the open Team's
views and the Manage and Setup pages. Type to narrow it down; Enter opens the one highlighted,
also when you press it before the lists have arrived. Three characters or more also search the
conversations: **In conversations**, last, lists the messages holding every word typed, and
opening one shows its conversation at that message, marked for a moment
([conversations](conversations.md#search)).

| Keys | |
| --- | --- |
| ⌘K or Ctrl+K | Jump to |
| `?` | The list of shortcuts |
| `/` | Write to the open Agent |
| ⌥↓ ⌥↑, or Alt+↓ Alt+↑ | The next or previous Agent in the list |
| ⌘. or Ctrl+. | Show or hide the side panel |

The keys without ⌘ or Ctrl wait while you type in a field or a list or menu is open.

## The browser tab

The tab names the page, most specific first (`Mira · Launch — bazilion`, `Models · Setup —
bazilion`), and puts the number of things waiting for you in front (`(1) Quill · Launch —
bazilion`), so another tab tells you an Agent needs you.

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
latest tool call, how many questions and shell approvals wait, how many follow-ups wait and
whether its queue is paused, when its conversation last changed and how many files it has saved.
The web UI gets the same entries pushed over `GET /api/events` (see [Live](#live)) and reads
this route every three seconds only while that stream is down. `GET /api/teams/:id/messages?limit=100` lists the
messages a Team's Agents sent and received, newest first, and marks nothing read.
