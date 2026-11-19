---
id: BAZ-072
title: One web workspace
status: done
created: 2026-11-19
shipped: 2026-11-20
release: v0.50.0
---

# BAZ-072 — One web workspace

## Outcome

Talking to an Agent, seeing what its Team is doing, checking who may message whom, reading the
diff of what was written and collecting what was delivered happen on one screen. Nothing about
the work is more than one click from the conversation, and the list of Agents says what each is
doing right now.

## Scope

- One workspace on `/`: Teams and Agents with a live state each, the conversation, and a side
  panel with Agent, Team, Connections, Changes and Files tabs. The address holds what is on
  screen.
- Three full-width views of a Team: the Connections map, Changes side by side with line comments
  sent as one review, and the Files gallery with a zip download.
- A transcript that reads as steps in words, hand-off cards, and delivered pictures as pictures.
- Earlier conversations can be continued, and a conversation is named after its first message.
- The Agent and Team pages are gone; their deeper parts open as sheets over the workspace.

## As built

- Web: the workspace, **Jump to** (Ctrl+K), and the remaining list pages under **Manage**.
- CLI: `bazilion activity`, `bazilion team messages`, `bazilion conversation select`,
  `bazilion result archive`, `bazilion result list --conversation`, and
  `bazilion team review feedback --line`; `team review show` names who wrote each file.
- HTTP: `GET /api/activity`, `GET /api/teams/:id/messages`,
  `POST /api/agents/:id/conversations/:id/select`, `GET /api/results/archive`,
  `GET /api/teams/:id/review?authors=1`, and review feedback as a list of comments.
- No database change: a home from 0.27 opens as it is.

## Known limits

- The live state comes from polling every three seconds, not from a push channel.
- "New" markers and the map's layout are kept in the browser, per browser.
- A file's author is the Agent whose `write` or `edit` last touched it in its five newest
  conversations; changes made by shell commands have no author.
- The old `/agents/<id>` and `/teams/<id>` addresses are not redirected.
- `POST /api/teams/:id/review/feedback` takes `comments` now; the 0.27 body `{ path, note }` is
  refused.
