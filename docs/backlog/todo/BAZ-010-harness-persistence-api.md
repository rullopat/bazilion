---
id: BAZ-010
title: Harness persistence, stable slots, and production APIs
status: todo
size: M (~1 week)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: First production follow-up to BAZ-009. Persist the validated allow-edge model without adding runtime enforcement or replacing the current web screens yet.
---

# BAZ-010 - Harness persistence, stable slots, and production APIs

**Status:** Todo. Ready to pull after BAZ-009.

## User stories

- **As an operator**, I want harness templates and live policies stored by the daemon, so
  they survive browser changes and can be shared by web and CLI clients.
- **As a template editor**, I want stable member-slot ids, so communication edges survive
  reorder and repeated use of the same profile.
- **As an existing user**, I want current groups and profile groups to retain open
  communication during migration.

## Goal

Add production schema, API types, repositories, and authenticated routes for the canonical
BAZ-009 directed allow-edge model. Persist profile communication defaults and independent
template/live snapshots. Do not enforce the policy in this story.

## Decisions

1. Stable slot ids are generated once and never derived from array position.
2. Template edges reference member slots; live edges reference resolved agent ids.
3. Presets and profile defaults are expanded into explicit edges at snapshot creation.
4. Existing data backfills to Open Team behavior.
5. Every mutable harness/template has a monotonically increasing revision. Writes require
   expectedRevision and reject stale updates with 409.
6. Template promotion and save-as-new are server transactions; neither updates other live
   snapshots automatically.

## Scope

- Add API types for endpoints, edges, policies, decisions, profile defaults, templates,
  live harnesses, diffs, and revision conflicts.
- Add migrations and repositories for templates, stable members, directed edges, live
  snapshots, slot-to-agent mappings, and profile defaults.
- Add stable slot ids to existing profile-group members and backfill them transactionally.
- Represent existing profile groups and groups with an explicit Open Team compatibility
  posture.
- Add authenticated CRUD routes for harness templates and live harnesses.
- Add transactional bind/snapshot, compare, update-source, and save-as-new operations.
- Validate endpoint kinds, membership, self edges, duplicate edges, boundary-only edges,
  and mixed slot/agent policies at the daemon boundary.
- Return fully resolved snapshots and revision metadata after every mutation.
- Document the API in packages/client and export typed client helpers.

## Out of scope

- Runtime allow/deny enforcement or durable block events (BAZ-011).
- Replacing the BAZ-009 local prototype UI (BAZ-012).
- CLI policy commands (BAZ-013).
- Approval-required decisions or workflow execution.

## Acceptance criteria

- Restarting the daemon preserves templates, live policies, defaults, relationships, and
  stable slot ids.
- Reordering a template member does not change its slot id or invalidate its edges.
- Repeated profiles in one template receive distinct stable slot ids.
- Existing groups/profile groups resolve to the same open communication they have before
  migration.
- Binding creates an independent live snapshot with a durable slot-to-agent mapping.
- Template edits never mutate existing live snapshots; update-source and save-as-new are
  explicit and atomic.
- Invalid or duplicate edges return structured 400 errors.
- A stale expectedRevision returns 409 and leaves stored state unchanged.
- No route or repository in this story blocks runtime communication.

## Tests

- Migration tests for empty, existing profile-group, repeated-profile, and rollback cases.
- Repository tests for stable slots, edge uniqueness, snapshots, promotion, and revisions.
- Route tests for CRUD, validation, auth, conflicts, compare, update-source, and clone.
- API type/client compile tests and the full repository suite.
