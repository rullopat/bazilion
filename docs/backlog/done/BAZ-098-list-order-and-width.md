---
id: BAZ-098
title: "The list on the left: your order, your width"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.65.0
---

# BAZ-098 — The list on the left: your order, your width

## Outcome

The list on the left put the Default Team first and the rest by creation, their Agents by when
they were added, and it was always 18rem wide. Now Teams and Agents are in the order you give
them, and the list is as wide as you drag it.

## As built

- Migration `004-list-order.sql` adds `position` to `teams` and `agents` and numbers today's rows
  in today's order: the Default Team first, then by creation; each Team's Agents by creation.
- `teamRepo.list` and `agentRepo.list` follow it (Agents by their Team's place, then their own),
  so the workspace, Manage, Jump to's Teams and the CLI agree. A new Team goes last, a new or
  moved Agent last in its Team. The roster digest includes the order, so other tabs reload.
- `PUT /api/teams/order` and `PUT /api/teams/:id/agents/order` take ids (Agents also by name or
  id prefix): those named first, the rest after them as they were; an unknown one is refused.
  `bazilion team order` and `bazilion agent order` call them.
- The rail drags a Team by its header and an Agent within its Team (HTML drag and drop with a
  type of our own, so a drop on a text field types nothing), with a line where it lands. The
  new order shows at once and goes back with the reason if the daemon refuses
  (`rail/use-rail-order.ts`). **Move up** and **Move down** are in the Agent's menu and a new
  menu on each Team: the way with the keyboard.
- `rail/RailResizer.tsx`: a separator on the list's edge, dragged or moved with the arrow keys
  (Home and End for the ends), double-click for 18rem; the width is a cookie
  (`bz_rail_width`), so the first paint has it.
- Guides: [workspace](../../workspace.md), [manage](../../manage.md).

## Decided while building

- The keyboard way is Move up / Move down in menus, not Space to pick a row up: Space opens and
  closes a Team's fold.
- The width is between 14rem and 32rem and never more than a third of the window; those bounds
  only shape the layout.
- The folded column of avatars keeps the Team in view first, as before.

## Limits

- Dragging an Agent onto another Team does not move it; Manage and `bazilion agent move` do.
- Only the left list is resized; the side panel keeps its width.
