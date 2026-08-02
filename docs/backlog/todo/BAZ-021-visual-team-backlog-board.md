---
id: BAZ-021
title: Visual Team backlog board
status: todo
size: M (~1 week)
created: 2026-08-02
refined: 2026-08-02
priority: high
note: Depends on BAZ-020; full web workflow over the canonical Markdown backlog.
---

# BAZ-021 - Visual Team backlog board

**Status:** Todo. Refined; blocked on BAZ-020.

## User stories

- **As an operator**, I want a full web board with Draft, Todo, In Progress, and Done columns, so I can
  understand and manage the Team backlog at a glance.
- **As a product owner**, I want to create and edit a complete user story in the browser, so I do not
  need to hand-edit frontmatter while refining work.
- **As an operator supervising Agents**, I want malformed or externally changed files called out
  clearly, so the GUI never makes the underlying Git-backed backlog look healthier than it is.

## Goal

Add a responsive `/teams/:id/backlog` workspace backed entirely by the BAZ-020 Team backlog API. It is
the canonical visual backlog surface and includes board, detail, create, edit, move, and validation
workflows rather than a read-only dashboard.

## Scope

- Add Backlog to Team navigation and expose a four-column board ordered by numeric story id by default.
- Show id, title, size, priority, note, and validation state on accessible story cards.
- Support pointer drag-and-drop and keyboard/button-based state moves with optimistic feedback, server
  conflict handling, focus restoration, and screen-reader announcements.
- Add create and edit dialogs for frontmatter plus structured Markdown sections, with a raw Markdown
  mode for advanced edits and a rendered preview.
- Add a story detail drawer/page with the full rendered body, source path, validation diagnostics, and
  explicit state actions.
- Add text search and size/priority filters that operate consistently across all columns.
- Treat external filesystem changes as normal: loader refresh returns the current files, and stale
  writes produce a conflict prompt rather than overwriting newer content.
- Provide useful empty states for missing/uninitialized backlogs and per-column empty states.

## Acceptance criteria

- The board renders all valid and invalid stories returned by BAZ-020 in the correct column without
  requiring horizontal page scrolling at desktop widths.
- An operator can create, fully edit, preview, move, and inspect a story without leaving the GUI.
- Every drag action has an equivalent focused button/keyboard action; card order, labels, dialogs, and
  errors meet the existing accessibility conventions.
- A failed or conflicting move restores the card to its original column and explains what happened.
- Mobile uses a deliberate stacked/tabbed column view; 320 px, 768 px, 1280 px, and wide desktop layouts
  remain usable.
- The UI never silently repairs malformed files or overwrites changes made outside Bazilion.

## Out of scope

- Freeform/custom columns, swimlanes, sprint planning, story comments, and analytics.
- Agent assignment or autonomous implementation controls; delivered separately after BAZ-022.
- Git staging, commits, branches, diffs, and pull-request UI.
- Real-time multi-user collaboration; explicit refresh/conflict recovery is sufficient for v1.

## Tests

- Route/component tests cover all columns, filtering, detail rendering, creation, editing, pointer and
  keyboard moves, optimistic rollback, conflicts, invalid stories, and empty states.
- Accessibility tests cover landmarks, column/card names, focus restoration, live announcements, and
  non-pointer state transitions.
- Browser QA covers 320 px, 768 px, 1280 px, and wide desktop in light/dark themes.
- Root tests, root/web typechecks, lint, production build, and `git diff --check` pass.
