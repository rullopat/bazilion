---
id: BAZ-075
title: Manage pages on the shared parts
status: done
created: 2026-11-22
shipped: 2026-11-22
release: v0.53.0
---

# BAZ-075 — Manage pages on the shared parts

## Outcome

Agents, Teams, their templates and skills are managed from pages that look and behave like
Setup: what there is comes first, new things are created in a dialog, and each row says what is
worth knowing about it. Every page outside the workspace is built from one set of parts.

## Scope

- One **Manage** tab bar: Agents, Teams, Agent templates, Team templates, Skills.
- **Agents** grouped by Team, found by name, filtered to current, archived or all; archive,
  restore, move to another Team and delete from a row.
- **Teams** created in a new folder or on a project folder; removable once empty.
- **Agent templates**: a Settings card (name, model, skills) and a Files card (one file at a time,
  one Save for all changed files); a warning when the model is not in Chat.
- **Team templates** spawned from the list and from their page.
- **Skills**: findings and unreadable skills stand out; each row says which templates chose it.
- **Attention** says how much is open, and filters in one row.
- Setup's Telegram, System, MCP and Access pages on the same parts as Models and Tools.

## As built

- Web: `components/ui/parts.tsx` and `form.tsx` (moved from `components/setup/`, with row menus,
  empty states, group headers, choice cards and filter selects added); `components/ManagePage.tsx`;
  `components/manage/`; `lib/manage.ts`, `lib/telegram-setup.ts`, `lib/mcp-form.ts`,
  `lib/token-form.ts`.
- Removed: `SkillsPicker`, the in-page `Tabs`, `EmptyState`, `Stat`, and the Templates sub-tabs.
- `/templates/agents?new=1` and `/templates/teams?new=1` open the create dialog.
- Dates on Skills and Attention are counted from the server's clock: the hydration error there is
  gone.
- No daemon, CLI or database change.

## Known limits

- The workspace's side panel and sheets still use the app-wide `SectionCard` and `ItemList`.
- A Team's list row does not say whether its folder is a link to a project.
- The roster editor keeps its own flow and matrix views.
