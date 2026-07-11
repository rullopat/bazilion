---
id: BAZ-017
title: Production policy editors, local migration, activity, and web QA
status: done
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Complete BAZ-012 with server-backed Flow/Matrix editors, adoption/source workflows, BAZ-009 reviewed import, durable block detail, conflict recovery, chat return state, accessibility, and the required responsive theme matrix.
---

# BAZ-017 - Production policy editors, local migration, activity, and web QA

**Status:** Done. Completed the management/recovery prerequisite and activated the
release-coupled BAZ-016 enforcement capability. ADR 0001 is normative.

## User stories

- **As an operator**, I want the validated Flow/Matrix model backed by canonical APIs, so
  edits are durable, conflict-safe, and accurately described as enforced.
- **As an existing BAZ-009 user**, I want a reviewed local export/import path without silent
  upload, id reuse, or fake audit evidence.
- **As an operator investigating denial**, I want durable block detail and a side-effect-free
  simulator in the Group where policy is owned.

## Goal

Finish the BAZ-012 production web migration with the full server-backed interaction model,
recovery workflows, local-prototype migration, and release-quality visual/accessibility
verification.

## Scope

- Reuse BAZ-009 Flow/Matrix, inspectors, presets, Profile-default overlays, creation preview,
  and simulator against BAZ-015/011 typed APIs.
- Keep Team-template stable slot ids and Group Agent ids distinct in labels, selection,
  endpoint payloads, adoption mapping, chat navigation, and diffs.
- Add reviewed new/empty Team initialize, non-empty/retained-baseline append, and full
  existing-Group rebaseline workflows with exact resulting-edge preview.
- Add baseline/current-source/live compare, `source_diverged` handling, update-source,
  save-as-template, tombstoned-source display, and explicit rebaseline recovery.
- On 409, preserve operator draft and current server state and offer reload/compare/reapply;
  never force-overwrite or silently merge source divergence.
- Replace simulated local blocks with paginated BAZ-011 events. Show both Group policy
  components for cross-Group denial. Keep diagnostic evaluation clearly side-effect free.
- Add reviewed BAZ-009 export/import: server creates new template/slot ids; a local live
  draft compares against its Group with expected revision; nothing uploads/deletes
  silently; simulated blocks never import.
- Preserve Agent chat drill-in and restore Group policy route, Flow/Matrix mode, viewport,
  pan/zoom, and selected actor/edge on return.
- Complete release readiness integration consumed by BAZ-016 activation.
- After every acceptance check passes, change the shared compiled
  `HARNESS_MANAGEMENT_CONTRACT_VERSION` from 0 to 1 in the same monorepo release. This is a
  release-manifest capability consumed by daemon startup, not a browser-to-daemon runtime
  handshake.

## Interaction rules

- Flow and Matrix are projections of one server edge set. Successful mutation reconciles
  from the returned aggregate/revision.
- Browser drafts are visibly unsaved and never effective. Leave/reload prompts explicitly.
- Profile preset expansion occurs first; boundary false removes preset edge, deny_all
  removes peer edges, allow_all adds, and inherit leaves preset unchanged. Direct
  profile-default placement starts isolated.
- Adoption mapping is total/injective for active slots. Remaining live Agents receive
  placement; the resolved preview uses BAZ-015's deterministic peer rule and must match the
  daemon recomputation.
- Group Policy shows one baseline pointer, cohort provenance, live-only Agents, divergence,
  revision, and source tombstone state without implying auto-propagation.
- Cross-Group simulation shows both current Group revisions; editing one Group cannot grant
  consent for the other.
- Archived Agents retain topology visually but are marked unavailable. Move/delete previews
  show incident-edge loss, lineage result, and all affected revisions.

## Out of scope

- New policy semantics, persistence/lifecycle, authorizer/runtime implementation, CLI
  management, approvals, workflows, routing/retries, or compatibility removal.

## Acceptance criteria

- Every edit survives reload, another browser, and daemon restart; no unsaved/local/stale
  policy is shown as effective.
- Flow, Matrix, inspector, preset/default preview, simulator, adoption, compare,
  update-source, and save-as-template use canonical stable ids/revisions and stay in sync.
- New/empty initialize, retained-baseline append, rebaseline, and single-Agent placement
  show the exact resulting policy before commit.
- Conflict/source-divergence workflows preserve both versions and require explicit operator
  action; missing/invalid policy and tombstoned source remain recoverable.
- Local prototype data is never automatically uploaded or deleted. Imports allocate server
  ids and local simulated blocks never appear as production evidence.
- Block detail shows source/target/channel/origin/reason/time plus every policy reference,
  revision, and cross-Group component. Simulator creates no block.
- Chat drill-in/back restores route, mode, viewport, and selection.
- No overlap/clipping at 1440x900, 1024x768, and 390x844 in light and dark; long names,
  banners, drawers, tables, and dialogs remain contained.
- Keyboard/screen-reader users can select nodes/edges, switch projections, inspect policy,
  map adoption, resolve conflicts/dialogs, and distinguish draft/effective state.
- BAZ-016 readiness becomes true only after all editor, conflict, migration, degraded-state,
  accessibility, and viewport/theme end-to-end checks pass.
- The compiled management contract remains 0 on any failing acceptance run and becomes 1
  only in a release containing both completed BAZ-016 and BAZ-017 artifacts.

## Tests and verification

- Component/integration tests for stable slot versus Agent ids, revision/draft separation,
  deterministic previews, source divergence, conflicts, local import, activity projection,
  and readiness.
- Playwright end-to-end coverage for create/edit/reload, Flow/Matrix sync, Team
  initialize/append, Group rebaseline, multi-browser conflict, simulator/activity, local
  migration, lifecycle preview, chat return, redirects, and degraded recovery.
- Playwright at 1440x900, 1024x768, and 390x844 in both light/dark without sending real
  Agent messages.
- Accessibility checks for nodes/edges, matrix, drawers, dialogs, tables, banners, focus
  restoration, and reduced motion.
- Full web/root typechecks, build, lint, repository suite, and focused BAZ-010/011/015/016
  contract tests.

## As-built (2026-07-11)

- Replaced the BAZ-009 local prototype projection with canonical server-backed Flow and
  Matrix editors for Team templates and Group live policy. Both projections share one edge
  draft, reconcile from revisioned API responses, distinguish stable slot ids from live
  Agent ids, expose draft/effective state, and preserve both sides of a 409 conflict for
  explicit reload or reapply.
- Added exact daemon previews for Team initialize/append, template adoption/rebaseline,
  direct placement, and Agent moves. Group policy exposes baseline/current-source/live
  comparison, divergence and tombstone recovery, update-source, save-as-template, total
  injective adoption mapping, profile-default overlays, presets, and side-effect-free
  evaluation.
- Added reviewed local export/import. Imported Team slots always receive server UUIDs,
  invalid documents fail atomically, local Group drafts compare before expected-revision
  application, and local simulated blocks never enter durable production activity.
- Expanded Group activity into paginated durable denial detail with source, target,
  channel, origin, reason, time, attempt, policy references, revisions, both cross-Group
  components, and matched/required edges. Agent drill-in restores Group route, projection,
  selection, and viewport without sending a message.
- Browser acceptance passed at 1440x900, 1024x768, and 390x844 in light and dark, including
  long content, dialogs, conflict recovery, degraded/retry recovery, migration, previews,
  activity, keyboard semantics, focus behavior, and reduced motion. No real Agent message
  was sent.
- Focused verification passed 26 activation/editor/API tests. Full repository tests, root
  and web typechecks, Biome lint (existing warnings only), root and web production builds,
  enforcement-on startup, and `git diff --check` passed. The compiled management contract
  is now version 1; enforcement remains operator-configured and no workflow execution or
  approvals were added.
