---
id: BAZ-079
title: Polish and fixes: teammates, live lists, kept places, a bug hunt
status: done
created: 2026-11-23
shipped: 2026-11-23
release: v0.57.0
---

# BAZ-079 — Polish and fixes: teammates, live lists, kept places, a bug hunt

## Outcome

The owner asked for a release of polish and bug fixes, starting from three bugs they met: the
conversation lost its scroll position when they went to another Agent and back; a Team and
Agent that General Lee created through `bazilion` needed a reload to show; the Sales Director
could not create its teammates and needed their ids pasted into the chat to message them. A
walk of the built app on a demo home found sixteen more, most fixed here.

## Scope

- Teammates by name and id in every turn's system prompt; `send_message` takes a name;
  `agent_create` in turns the operator started. The first-run ritual waits for the operator.
- The live feed's roster digest reloads a page's lists after a change from anywhere.
- The conversation keeps its place and its unsent text per Agent; Edit gives the draft back.
- A Team folder that is not a Git repository is a 200 with `unavailable`, not a 409.
- From the bug hunt: question cards follow the live feed; a finished turn reloads views without
  clearing them; the conversation header with long names; the panel toggle and the overlay panel
  below 1,280 px; the open tab in view on a phone; a stopped reply says so; memory note names;
  one Agent name limit; Team id hints; "Add an Agent" everywhere; Jump to keeps what is typed at
  once and gives the focus back; the demo's scratch folders removed.

## As built

- Daemon: `lib/team-host.ts` (`agentContacts`, `createDbTeamHost`), `runtime/tools/team.ts`,
  the `createAgent` RPC and `teamHost`; `recipientOf` in `lib/messaging-host.ts` (the
  `agentExists` RPC is gone); `rosterRevision` in `lib/activity.ts`; `withOperator` on the
  worker spec; `ReviewUnavailableResponse`; `ProviderMessage.stopped`; `AGENT_NAME_MAX`.
- Web: `lib/transcript-scroll.ts`, `lib/roster.tsx`, `lib/memory-key.ts`, `useResource`'s
  `refreshOn`, `revealInStrip`.
- No schema change.

## Known limits

- The kept places and drafts last while the page is open; a reload starts at the end.
- An Agent creates teammates only in its own Team and only when a turn you started asks; in a
  restricted Team it is connected to its creator, and other connections stay yours.
- Not done from the bug hunt: naming the broken skill on Setup → System, and saying that Stop
  paused the follow-up queue.
