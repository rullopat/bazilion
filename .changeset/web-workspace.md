---
"bazilion": minor
---

The web UI is one workspace: the conversation, the Team, who may message whom, the diff of what was written and the delivered files are on one screen, and the list of Agents says what each one is doing. The version jumps from 0.27 to 0.50 to mark the rework; a 0.27 home opens as it is.

- **One workspace on `/`:** Teams and their Agents on the left, the open Agent's conversation in the middle, and a side panel with five tabs: Agent, Team, Connections, Changes and Files. The address holds what is on screen (`?agent=…&panel=changes&file=…`), so links and the back button work. The panel remembers its last tab.
- **What each Agent is doing:** every Agent has a line of its own: `Needs you: 1 question`, `Working: writing theme.js`, `Follow-ups paused`, `2 new files` or `Idle`. Before, the list showed the lifecycle status, which read `IDLE` for an Agent in the middle of a turn. A Team's header sums its Agents up.
- **A transcript that reads:** tool calls are steps in words (`Ran`, `Read`, `Wrote` with the lines added and removed) instead of escaped JSON; a message to a teammate is a hand-off card with what that teammate is doing now; delivered pictures show as pictures; a turn that wrote files links to their diff; a question has one button per choice; a very long message of yours starts folded.
- **Connections:** the Team as a map, with one line per pair of Agents, an arrowhead for each allowed direction and the number of recent messages on it. Select an Agent or a line to switch each direction and to read what they said to each other. The table view stays.
- **Changes:** changed files with the Agent that wrote each, the diff in one column or with the old and the new file side by side, comments on a line or a file, and all comments sent to one Agent as one review.
- **Files:** a gallery of everything a Team's Agents delivered, by Agent and by kind, with details, two files side by side, and one zip of the lot.
- **Conversations:** an earlier conversation can be continued, not only read, and a conversation is named after the first message you send in it.
- **Jump to (Ctrl+K):** opens any Agent, Team, view or page by name.
- **CLI:** `bazilion activity`, `bazilion team messages <team>`, `bazilion conversation select`, `bazilion result archive`, `bazilion result list --conversation` and `bazilion team review feedback --line`; `team review show` names who wrote each file.
- **HTTP:** `GET /api/activity`, `GET /api/teams/:id/messages`, `POST /api/agents/:id/conversations/:conversationId/select`, `GET /api/results/archive`, `sessionId` on `GET /api/results`, and `authors=1` on `GET /api/teams/:id/review`.
- **Removed:** the Agent pages (`/agents/<id>` and its Inbox, Triggers, Learning and Settings tabs) and the Team pages (`/teams/<id>` and its Members, Policy, Memory, Review and Results tabs). Their content is in the side panel and in sheets that open over the workspace; the old addresses are not redirected. Attention items link into the workspace.
- **Changed:** `POST /api/teams/:id/review/feedback` takes `{ agentId, comments: [{ path, line?, note? }], note?, base? }`; the body with a single `path` is refused.
