---
id: BAZ-012
title: Production harness web experience and migration
status: todo
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Replace the BAZ-009 local prototype state with BAZ-010/011 APIs while preserving the validated Flow/Matrix interaction model and existing-data compatibility.
---

# BAZ-012 - Production harness web experience and migration

**Status:** Todo. Ready to pull after BAZ-010 and BAZ-011.

## User stories

- **As an operator**, I want the validated harness editor backed by daemon state, so edits
  are durable and enforced.
- **As an existing Profile Groups/Groups user**, I want a clear migration path without
  losing templates, groups, or chat access.
- **As an operator handling conflicts**, I want to review fresh state before retrying, so
  one browser does not overwrite another operator's changes.

## Goal

Promote the BAZ-009 Flow/Matrix prototype into the production web experience using typed
APIs, server revisions, enforced posture, and durable block history. Remove policy
localStorage after a compatibility export window.

## Scope

- Replace fixture/localStorage harness data with BAZ-010 template/live APIs.
- Reuse the canonical Flow/Matrix editor, inspectors, creation preview, presets, profile
  defaults, simulator, compare, update-source, save-as-new, and chat drill-in interactions.
- Display effective enforced status and policy revision from BAZ-011.
- Replace local simulated block history with paginated durable events; retain a clearly
  labeled side-effect-free evaluator.
- Handle 409 revision conflicts with a compare/reload workflow that never silently
  overwrites remote changes.
- Migrate existing Profile Groups and Groups navigation into harness template/live views
  while preserving old URLs through redirects or compatibility screens for one release.
- Provide a one-time local prototype export/import prompt when compatible BAZ-009 data is
  present; never upload it silently.
- Keep template slots distinct from live agents and preserve explicit chat return state.
- Keep responsive drawers and both themes at the BAZ-009 viewport matrix.
- Remove claims that policy is local-only once enforcement is active; show degraded/error
  state if policy cannot be loaded.

## Out of scope

- New policy semantics beyond BAZ-009 allow/deny.
- CLI management (BAZ-013), approvals (BAZ-014), or workflow execution.
- Deleting compatibility data before its documented migration window.

## Acceptance criteria

- All template/live edits survive reload, another browser, and daemon restart.
- The web never presents an unsaved local policy as enforced.
- Revision conflicts preserve both versions and require an explicit operator decision.
- Existing profile groups/groups are reachable and retain Open Team behavior after
  migration.
- Flow, Matrix, inspector, and simulator operate on one server-backed directed edge set.
- Live-agent double-click opens chat; Back to harness restores view, viewport, and
  selection.
- Durable blocked attempts appear with source, target, channel, origin, reason, revision,
  and timestamp.
- The editor has no overlap at 1440x900, 1024x768, and 390x844 in light and dark themes;
  long names remain contained.
- Ordinary agent chat outside harness context retains current behavior.

## Tests

- Component/unit tests for API projection, revisions, conflicts, migration import, and
  effective policy display.
- Route tests for old-URL compatibility and failed/degraded API states.
- Playwright coverage for create/edit/reload, Flow/Matrix sync, conflict handling,
  simulator/block history, migration, chat return, themes, and required viewports.
- Accessibility checks for node/edge selection, drawers, dialogs, and matrix controls.
- Full typecheck, build, and repository suite.
