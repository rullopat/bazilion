---
id: BAZ-012
title: Production Templates and Groups web information architecture
status: todo
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Converge Profiles/Profile Groups into Agent/Team templates, establish Group-owned policy navigation and server projections, preserve old URLs, and provide degraded/conflict recovery shell. Editors and local migration continue in BAZ-017.
---

# BAZ-012 - Production Templates and Groups web information architecture

**Status:** Refined and ready after BAZ-015 and BAZ-011. ADR 0001 is normative. This is the
first half of the former XL web story; BAZ-017 owns production editors, local import,
activity detail, and the full interaction/visual matrix.

## User stories

- **As an operator**, I want Agent templates, Team templates, Groups, policies, and Agents
  placed according to their canonical ownership, so I never edit or navigate a second
  roster.
- **As an existing user**, I want Profile/Profile Group links and data to reach their
  canonical successors for a full release.
- **As an operator in degraded/conflicting state**, I want an honest recovery shell, so a
  local fallback is never presented as effective policy.

## Goal

Build the production navigation, routes, server read projections, compatibility redirects,
and recovery framing from [ADR 0001](../../adr/0001-production-harness-domain.md).

> There is one canonical Team/Harness Template roster, one effective live policy per
> Group, and `agents.group_id` is live-membership truth.

There is no top-level Harnesses area or detached live-harness identity.

## Target information architecture

Top navigation is **Templates · Agents · Groups · Skills · Config**.

### Templates

| Route | Responsibility |
|---|---|
| `/templates` | Canonical convenience redirect to `/templates/agents` |
| `/templates/agents` | Profiles labeled **Agent templates**; top-nav target and Agent/Team tab shell |
| `/templates/agents/:id` | Profile files, skills, model, and optional communication defaults |
| `/templates/teams` | The sole reusable **Team template** roster list |
| `/templates/teams/:id` | Server-backed Team summary, stable slots, revision/source state, and editor/spawn slots for BAZ-017 |

### Agents

Existing `/agents` and `/agents/:id` remain live-Agent list/detail/chat routes. Single-Agent
spawn stays here or under Group Members; its action shell previews and submits BAZ-015
placement/revision rather than creating a harness.

### Groups

| Route | Responsibility |
|---|---|
| `/groups` | Workspaces with member count, baseline/divergence, policy status/revision, and recent blocked signal |
| `/groups/:id` | Overview |
| `/groups/:id/members` | `agents.group_id` roster and lifecycle action shells |
| `/groups/:id/policy` | The sole Group policy projection, source/cohorts, revision, and BAZ-017 editor mount |
| `/groups/:id/memory` | Existing Group-shared memory |
| `/groups/:id/context` | Path/link, live USER.md, Telegram naming, and integrations |
| `/groups/:id/activity` | Durable blocked-communication history summary and current policy revision; no policy-change history claim |

Team spawn begins from Team templates. Existing-Group adoption is a reviewed action on
Group Policy, never a separate binding identity.

## One-release URL compatibility

Redirects preserve relevant id, query string, and return state.

| Existing URL | Behavior |
|---|---|
| `/profiles` | Redirect to `/templates/agents` |
| `/profiles/:id` | Redirect to `/templates/agents/:id` |
| `/profile-groups` | Redirect to `/templates/teams` |
| `/profile-groups/:id` | Redirect to `/templates/teams/:id` |
| `/groups` and `/groups/:id` | Remain canonical; content moves into the tab structure |
| `/groups/:id/memory` | Remains canonical |
| `/harnesses` | BAZ-009 compatibility landing explaining local-only state, then route to `/groups` |
| `/harnesses/:localId` | Preserve local state and show whether BAZ-017 will import as Team template or compare with Group policy; do not upload/delete |

Old Profile Group route loaders read BAZ-010's canonical compatibility projection. They do
not retain separate API state.

## Scope

- Replace top navigation and add the Templates Agent/Team tab shell.
- Add canonical route files/loaders and typed server read projections for template
  revisions, current Group membership, sole policy, baseline/cohorts, divergence, mode, and
  degraded state.
- Add Group Overview/Members/Policy/Memory/Context/Activity tab structure without moving
  existing Group filesystem or memory ownership.
- Implement every compatibility redirect/landing above for one release, including old-link
  context and successor messaging.
- Update existing spawn/move/archive/delete UI entry points to explain lifecycle effects,
  collect required expected revisions/placements, and show the server-resolved preview/
  confirmation response. BAZ-017 supplies the advanced policy canvas/editors.
- Add explicit loading, empty, missing/invalid policy, migration-required, tombstoned source,
  stale revision, and daemon-unavailable states. Never substitute fixture/local policy.
- Add an enforcement-readiness projection/banner from the daemon health capability. The
  compiled `HARNESS_MANAGEMENT_CONTRACT_VERSION` remains 0 in this story; BAZ-017 moves it
  to 1 only in a release that passes the full management/recovery contract.

## Out of scope

- Flow/Matrix mutation editor, simulator, compare/update-source/save-as-template,
  durable-activity detail, BAZ-009 reviewed import, chat return state, and final visual QA
  (BAZ-017).
- Persistence/lifecycle (BAZ-010/015), enforcement/audit implementation (BAZ-011/016), CLI
  policy tools (BAZ-013), approvals (BAZ-014), or workflows.

## Acceptance criteria

- Top navigation and every canonical route match the target IA; `/templates` has a defined
  target and there is no top-level Harnesses product area.
- Agent template, Team template, Group membership, Group policy, and Agent labels/links
  consistently reflect one roster, one policy, and `agents.group_id` ownership.
- Every old URL reaches the correct canonical record/route for one full release and
  preserves relevant query/return state; no second loader/store remains.
- Server projections expose effective revision/mode/source/membership and never present
  fixture, localStorage, stale, or missing policy as enforced.
- Lifecycle action shells submit the exact BAZ-015 revisions/placements and render resolved
  results/conflicts without silent overwrite.
- Empty, degraded, migration-required, source-deleted, stale, and unavailable states have a
  visible fail-closed explanation and a viable reload/navigation recovery.
- `/groups/:id/activity` claims only BAZ-011 block history/current revision, not an unowned
  policy-change audit.
- BAZ-009 local state remains untouched and clearly local-only; no upload/delete occurs.
- The release readiness signal remains false until BAZ-017's editor, conflict, migration,
  degraded-recovery, accessibility, and viewport checks complete.

## Tests and verification

- Route/loader tests for canonical projections, every redirect, id/query preservation,
  compatibility messaging, and missing/degraded states.
- Component tests for labels/ownership, one baseline/cohorts, current membership, placement
  previews, revision conflicts, and readiness state.
- Playwright shell coverage for navigation, old URLs, Group tabs, degraded recovery, and
  lifecycle confirmations at desktop/tablet/mobile in both themes.
- Full web/root typechecks, build, lint, and repository suite.
