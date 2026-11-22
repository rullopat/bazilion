---
"bazilion": minor
---

Manage is redone on the shared parts: Agents, Teams, Agent templates, Team templates and Skills under one tab bar, each with its list first and creation in a dialog. No daemon, CLI or database change; a 0.52 home opens as it is.

- **One section:** a Manage tab bar replaces the separate pages and the Templates sub-tabs. The Manage menu and Jump to name the five pages.
- **Agents:** grouped by Team; find by name, creature or vibe; Current / Archived / All; each row says its template and the model it answers with (and when that model is not in Chat). Archive, Move to another Team and Delete are in the row's **⋯** menu; an archived Agent has **Restore**, and archiving shows a notice with Restore.
- **Teams:** **Create a Team** asks for a name, makes the ID from it, and asks where the files are: a new folder, or a project folder to link to. Rows show the members; **Remove** is disabled, with the reason, while a Team has Agents.
- **Agent templates:** **New Agent template** creates from the built-in files and opens the template. Its page has a **Settings** card (name, default model, skills) and a **Files** card (SOUL, IDENTITY, BOOTSTRAP, AGENTS, TOOLS, one at a time; one Save for every changed file; a missing optional file can be added). A banner says when the default model is not in Chat. Rows say who uses a template; **Delete** is disabled while an Agent or a Team template uses it, which the daemon refused before.
- **Team templates:** a roster preview per row, **Spawn** from the list and **Spawn this Team** from the page; the spawn dialog asks for a new Team or one that exists. The roster editor uses the shared parts and says Agents and connections, not slots and allow edges.
- **Skills:** **Import skills** opens a dialog (OpenClaw, a folder, a ZIP file); a risky finding or an unreadable SKILL.md is shown under the skill and in a banner; rows say which templates chose the skill.
- **Attention:** a summary line and one row of filters (state, kind, severity); times are relative.
- **Shared parts:** `components/ui/` (moved from `components/setup/`) gains a row menu, empty states, group headers, choice cards and a filter select. The spawn dialogs and the Team form use them, in the workspace too.
- **Telegram pairing** is noticed by itself: while a code waits, the Owner pairing card checks every few seconds, and the allowed users can be added as soon as the owner is paired.
- **Keyboard:** row menus, the template's file tabs (arrow keys, Home, End) and the controls that replace each other keep focus where it belongs; a menu item that cannot be used is still reached, so its reason is read.
- **Fixed:** Skills and Attention threw a hydration error (React #418) because dates were formatted in the server's and then the browser's locale.
