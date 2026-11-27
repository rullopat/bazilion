---
id: BAZ-098
title: "The list on the left: your order, your width"
status: draft
created: 2026-11-27
release: v0.65.0
---

# BAZ-098 — The list on the left: your order, your width

## Outcome

The list on the left puts the Default Team first and the other Teams in the order they were
created, with their Agents in the order they were added. It is always 18rem wide, so long names
are cut short and a wide screen cannot give it more room. After this story you put Teams and
Agents in the order you want, and drag the list wider or narrower.

## Scope

- **Order:**
  - Drag a Team by its header to another place in the list, or an Agent to another place in its
    Team.
  - The keyboard does the same: Space picks a row up, the arrows move it, and Space puts it
    down. **Move up** and **Move down** are also in the Agent's menu.
  - A new Team goes at the end, and a new Agent at the end of its Team. An Agent moved to
    another Team goes at the end of that Team.
- The order is saved in Bazilion, not in the browser. These all show the same order: every
  browser, the folded column of avatars, the overview, Manage, `bazilion team list` and
  `bazilion agent list`. Jump to keeps its own order: waiting, then working, then by activity.
- From a terminal, `bazilion team order <team>…` and `bazilion agent order <team> <agent>…` set
  the order. Names left out keep their order, after the ones named.
- **Width:**
  - A handle on the list's right edge drags it wider or narrower; double-click puts it back.
  - With the focus on the handle, the arrow keys move it (screen readers hear a separator).
  - The width is kept per browser in a cookie, so the page renders at that width without a
    jump.
  - The handle stops at fixed bounds, about 14rem and 32rem. They only shape the layout: names
    and states still fit, and the conversation keeps room.

## Where it goes

- A `position` column on `teams` and `agents`, with migration `004-list-order.sql`. It numbers
  today's rows in today's order: the Default Team first, then by creation.
- `src/core/repos/teams.ts` and `agents.ts` list by `position`.
- Routes that set the order of the Teams and of one Team's Agents, their types in
  `packages/api-types`, and the CLI commands in `apps/cli/src/commands/team.ts` and `agent.ts`.
- On the web: `components/workspace/rail/` (drag, menus, the handle), `routes/index.tsx` (the
  column's width) and `order.ts`, which drops the Default-first rule.
- Guides: [workspace](../../workspace.md), [manage](../../manage.md).

## Limits and open questions

- Dragging an Agent onto another Team does not move it. **Move to Team** in Manage and
  `bazilion agent move` still do that.
- Only the list on the left is resized. The side panel on the right keeps its width.
- The width is per browser and the order is shared. On a narrow screen the list takes the whole
  width, as today, and there is no handle.
