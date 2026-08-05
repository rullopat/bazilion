---
id: BAZ-009
title: Configurable agent teamPolicy - functional communication-flow prototype
status: done
size: L (1-2 weeks)
created: 2026-07-06
refined: 2026-07-10
shipped: 2026-07-10
priority: high
note: Build a functional in-app, locally persisted prototype that validates the policy model and flow-first teamPolicy UX before production schema, runtime enforcement, and CLI work are split into follow-up BAZs.
---

# BAZ-009 - Configurable agent teamPolicy - functional communication-flow prototype

**Status:** Done. Implemented 2026-07-10; unreleased.

Bazilion profile teams are currently ordered team templates. Spawned members share one
team context and can message any agent id they know; user chat and Telegram reach agents
without per-agent communication gates. There is no controlled communication topology or
teamPolicy-oriented UI.

This BAZ builds a functional prototype inside the real web app. Operators can create and
edit a teamPolicy policy, switch between Flow and Matrix views, inspect effective gates,
simulate allowed and denied communication, and move from a live teamPolicy into an
individual agent's chat. Policy state remains local to the browser and is not enforced by
the daemon in this story.

**Dependency:** Conceptual follow-on to BAZ-002 Profile Teams. No production schema or
runtime dependency is added by this prototype.

## User Stories

- **As an operator designing a team**, I want to control direct user input/output,
  outside-team input/output, and peer-to-peer communication for every member, so the
  team does not behave as an unrestricted flat chat room.
- **As an operator designing a communication flow**, I want to connect specific agents
  visually, so planner -> worker -> reviewer -> reporter patterns are understandable
  without relying on prompt instructions.
- **As an operator creating profiles and teamPolicy templates**, I want portable profile
  defaults and reusable policy presets, so new teams start from an intentional posture.
- **As an operator managing a live team**, I want to change its policy independently of
  the source template and compare any divergence before promoting changes back.
- **As an operator observing a live team**, I want to double-click an agent and enter that
  agent's chat, then return to the same place on the teamPolicy canvas.
- **As an operator debugging communication**, I want a clear explanation and audit entry
  for simulated denied attempts, so an intentional gate is not mistaken for agent failure.

## Goal

Deliver a working, iteratable product prototype that settles both the canonical policy
semantics and the web interaction model before production persistence and enforcement are
implemented. The prototype must use real application routes and components, support real
editing interactions, and preserve its state across reloads.

The prototype is successful when an operator can understand and configure the four
boundary gates and directed peer permissions from either Flow or Matrix view, validate the
result with a simulator, and navigate from a real live-team member to its existing chat.

## Product Decisions

1. **Flow is primary; Matrix is precise.** The canvas is the default editor. Matrix is a
   synchronized secondary view over the same policy, not a separate configuration system.
2. **An edge grants permission only.** `Planner -> Worker` means Planner may message
   Worker. It does not invoke Worker, route a payload, sequence execution, retry work, or
   guarantee a handoff.
3. **User gates are directional and transport-independent.** User input covers direct
   human messages from web, CLI, and Telegram. User output covers direct replies and
   proactive notifications through those transports. The two gates are independent.
4. **Outside team means other local Bazilion teams.** Federation and arbitrary external
   systems are not represented in v1. Telegram is a user transport, not an outside team.
5. **Policy decisions are allow or deny.** Approval-required communication is deferred.
   Denial is explicit and observable; there is no silent-drop behavior.
6. **Existing teams remain open.** Existing teams/profile teams are represented by the
   Open Team preset. New teamPolicyes require an explicit Open Team, Coordinator, Review
   Pipeline, or Blank choice. Blank and newly added members start isolated.
7. **Template and live policies are snapshots.** Neither direction propagates
   automatically. Compare/update/save-as-new operations require explicit review and affect
   future spawns only.
8. **Profile defaults are copied, not inherited.** Profiles provide portable boundary
   defaults and a broad peer posture; member-slot edits become authoritative after the
   creation preview is confirmed.
9. **Operator visibility is not a communication permission.** Gates can disable delivery
   while an operator retains read-only access to history, policy reasons, and block events.

## Current System Constraints

- Agents belong to exactly one team (`agents.team_id`).
- Profile team members are position-based today
  (`profile_group_members.profile_team_id + position`). Production policy edges will need
  stable member-slot ids so they survive reorder.
- Inter-agent messages are inserted by `messageRepo.send`; inbox auto-delivery wakes a
  recipient after insertion. Production enforcement therefore belongs before insertion.
- User input enters through chat routes, Telegram inbound, triggers, and direct
  `runAgentTurn` callers rather than through the `messages` table.
- User output is currently streamed as `ChatFrame` data and mirrored to Telegram.
- The web app has no graph-editor dependency or browser UI test teamPolicy today.

## Scope

### 1. Canonical Policy Model

Implement the prototype around one directed allow-edge model:

```ts
type TeamPolicyEndpoint =
  | { kind: 'user' }
  | { kind: 'outside_team' }
  | { kind: 'member_slot'; slotId: string }
  | { kind: 'agent'; agentId: string }

type TeamPolicyEdge = {
  id: string
  source: TeamPolicyEndpoint
  target: TeamPolicyEndpoint
}

type TeamPolicyPolicy = {
  version: 1
  edges: TeamPolicyEdge[]
}

type TeamPolicyDecision = {
  decision: 'allow' | 'deny'
  reason: string
  edgeId?: string
}

type ProfilePeerDefault = 'inherit_team_policy' | 'allow_all' | 'deny_all'
```

- A matching directed edge means allow; no matching edge means deny.
- Template policies use `member_slot`; live policies use `agent` after slot resolution.
- `user -> member` is user input; `member -> user` is user output.
- `outside_team -> member` is outside-team input; the reverse is outside-team output.
- Member-to-member edges are specific peer permissions.
- Self-edges and duplicate edges are invalid. Node positions and viewport state are UI state,
  not communication policy.
- Presets and broad profile defaults expand into explicit edges at snapshot time. They do
  not create hidden runtime precedence rules.
- Transport origin (`web`, `cli`, `telegram`, `agent_tool`, or `api`) is audit metadata and
  does not alter the policy decision.

### 2. Presets And Profile Defaults

- **Open Team:** all current member pairs are connected in both directions; all members
  have user and outside-team input/output enabled.
- **Coordinator:** the user communicates bidirectionally with one selected coordinator;
  coordinator/worker pairs communicate bidirectionally; workers have no peer, user, or
  outside-team edges unless added explicitly.
- **Review Pipeline:** the operator assigns planner, worker, reviewer, and reporter roles;
  the initial directed path is user -> planner -> worker -> reviewer -> reporter -> user.
- **Blank:** no edges and all members visibly isolated.
- TeamPolicy creation must preview the resolved topology before confirmation.
- Profile create/edit gets prototype controls for user input/output, outside-team
  input/output, and peer posture (`inherit_team_policy`, `allow_all`, or `deny_all`). A profile
  cannot name specific peers.
- The teamPolicy preset is applied first, profile defaults overlay it, and the preview is then
  snapshotted into member-slot policy. Later profile edits do not propagate.
- A profile boundary default adds or removes the corresponding user/outside edge.
  `inherit_team_policy` leaves preset peer edges unchanged, `allow_all` adds inbound and outbound
  edges to every current peer, and `deny_all` removes all peer edges incident to that slot.
- Adding a profile to a live teamPolicy remains isolated until the operator explicitly applies
  its defaults. Direct profile spawn copies the defaults into the local live-policy overlay.

### 3. Prototype Routes And State

- Add a top-level **TeamPolicyes** navigation item marked `Prototype`.
- `/policyes` lists prototype templates, locally bound live teams, and creation actions.
- `/policyes/$id` opens the builder in template or live mode.
- Persist a versioned state document under `bazilion:teamPolicy-prototype:v1` in
  `localStorage`, including policies, fixtures, profile defaults, node positions, viewport,
  selected view, selected node/edge, activity, and template relationship metadata.
- Include a reset-to-fixtures action with confirmation.
- Supply Open Team, Coordinator, Review Pipeline, and Blank examples.
- Read existing teams, agents, and profiles through current daemon APIs. Binding an
  existing team creates a local policy overlay only; no teamPolicy-policy API write occurs.
- Existing Profile Teams, Teams, Profiles, and chat behavior outside prototype context
  remain unchanged.

### 4. TeamPolicy Builder

- Use `@xyflow/react` for the node canvas, viewport controls, edge creation/deletion, and
  custom accessible agent nodes. Do not hand-roll canvas pan/zoom/selection behavior.
- Show compact `User` and `Other teams` boundary nodes alongside agent/member nodes so
  boundary permissions are visible in the graph.
- Single-click selects a node or edge and opens its inspector. Double-clicking a template
  slot opens slot/profile configuration.
- Dragging between valid handles adds an allow edge. Removing an edge changes that pair to
  deny. Reject self/duplicate/invalid boundary edges with visible feedback.
- The agent inspector exposes user input/output, outside-team input/output, inbound peers,
  outbound peers, isolation state, and recent blocked attempts.
- Matrix rows are sources and columns are targets. Toggling a cell changes the same edge
  collection immediately; switching views must preserve selection and edits.
- Adding a member starts it isolated. Removing a member previews and removes all incident
  edges. Isolated or incomplete nodes are visibly marked.
- Narrow viewports collapse roster and inspector into drawers/sheets while preserving gate
  editing and chat navigation. Canvas controls keep stable dimensions and never overlap
  application navigation.

### 5. Live Agent Chat

- A live prototype teamPolicy can bind to a real existing team so its nodes carry real agent
  ids.
- Double-clicking a live agent navigates to the existing `/agents/:id` chat with teamPolicy
  return context. An explicit **Back to teamPolicy** action restores the prior view, pan, zoom,
  and selection.
- A template slot never pretends to have a chat. Fixture-only agents without a real agent id
  show chat as unavailable.
- In teamPolicy return context, the chat shows the effective prototype user-input/output
  posture. Denied input disables the composer; denied output is represented by a clearly
  labeled prototype blocked-delivery state while history remains inspectable.
- The UI must state that policy is a local prototype and is not daemon-enforced. It must not
  present the gates as a production security boundary.

### 6. Template And Live Divergence

- Spawn/bind snapshots the source template and resolves `slotId -> agentId` where a mapping
  exists.
- A live teamPolicy shows `Based on <template>` and `Modified` when policy or roster diverges.
- `Compare with template` shows a policy/roster diff.
- `Update source template` applies only reviewed changes to the local prototype template and
  affects future local snapshots; it never mutates other live teamPolicyes.
- `Save as new template` creates an independent local prototype template.
- Existing members map by stable prototype `slotId`. Live-only members require explicit
  inclusion as new template slots.

### 7. Policy Simulator And Handoff

- Provide a simulator that selects source, target, and transport origin, evaluates the
  current edge set, and visualizes the attempted path without sending a real message.
- Allowed attempts identify the matching edge. Denied attempts show a structured policy
  reason and append a blocked-attempt record containing source, target, derived channel,
  origin, reason, and timestamp.
- Produce a short implementation handoff that keeps the model above and identifies the
  production enforcement points: messaging host, external send route, user chat ingress,
  Telegram ingress/egress, and pre-insertion scheduler assumptions.
- Sketch the production API surface for teamPolicy templates, live policy, and block history;
  do not implement those endpoints in this BAZ.

## Out Of Scope

- Database migrations, API persistence, or daemon-side runtime enforcement.
- Claiming that local prototype gates provide a production security boundary.
- Human approval gates, pending queues, expiry, assignment, or retry semantics.
- Automatic workflow execution, stages, conditions, payload routing, retries, or state
  machines. Edges authorize communication only.
- Federated/cross-install actors (deferred by [ADR 0002](../../adr/0002-defer-a2a-federation.md)) or multi-team agent membership.
- Replacing or deleting current Profile Teams and Teams screens.
- Production CLI import/export commands.
- Security sandboxing or command approval from BAZ-006.

## Acceptance Criteria

- TeamPolicyes is reachable from top navigation and is unmistakably labeled as a prototype.
- Reloading preserves prototype state; reset restores all supplied fixtures and schema-version
  mismatch fails safely back to fixtures.
- Flow and Matrix edit one canonical directed edge set and remain synchronized across view
  switches and reloads.
- User and Other teams are visible boundary actors; all four boundary gates can be changed
  from the graph/matrix and agent inspector.
- The four presets create the documented topology. Blank and newly added members are
  isolated and visibly identified.
- Profile defaults resolve in the documented order, are previewed before snapshot, cannot
  name specific peers, and do not propagate after snapshot.
- Self/duplicate/invalid edges are rejected; member removal previews and removes incident
  edges.
- The simulator returns deterministic allow/deny reasons and every denial creates a complete
  local blocked-attempt record without sending a real message.
- A locally bound real team displays its live agents. Double-click opens the selected
  agent's existing chat, and Back to teamPolicy restores view, pan, zoom, and selection.
- Template slots and fixture-only nodes do not expose a fake live-chat action.
- Template/live edits never propagate automatically. Compare, reviewed update-source, and
  save-as-new produce the documented local snapshot behavior.
- The prototype performs no teamPolicy-policy write to the daemon and never claims local gates
  are enforced outside the prototype.
- The builder is usable without overlap at 1440x900, 1024x768, and 390x844 in light and dark
  themes; long agent/profile names remain contained.
- Existing Profile Teams, Teams, Profiles, and ordinary agent-chat routes continue to
  build and behave as before outside prototype context.

## Verification

- Add Vitest coverage under `apps/web/test/` for endpoint equality, edge validation,
  allow/deny evaluation, channel derivation, preset expansion, profile-default resolution,
  snapshot divergence/diff, localStorage version fallback, and blocked-attempt creation.
- Run `pnpm --filter @bazilion/web typecheck`, `pnpm --filter @bazilion/web build`, and the
  focused/root Vitest suite.
- Run a Playwright browser smoke pass with desktop/tablet/mobile screenshots in light and
  dark themes. Exercise node connection, matrix editing, inspector gates, simulator denial,
  reset and reload persistence, template diff, live-agent chat navigation, and return-state
  restoration.

## Follow-Up Split

When the prototype is accepted, create separately sized Todo BAZs for:

1. Schema, API types/routes, migrations, stable profile-team member `slotId`s, and profile
   communication defaults.
2. Runtime enforcement for agent messaging, external sends, user ingress/egress, Telegram,
   and blocked-attempt audit persistence.
3. Production web migration from Profile Teams/Teams to teamPolicy templates and live
   teamPolicyes using persisted APIs.
4. CLI policy show/import/export and block-history visibility.
5. Optional human approval communication gates, only after allow/deny behavior is validated.

## As-built (2026-07-10, unreleased)

Shipped as the planned functional, browser-local prototype:

- Added a versioned canonical policy model in
  `apps/web/src/lib/policy-prototype.ts`, persisted under
  `bazilion:teamPolicy-prototype:v1`. Invalid or version-mismatched payloads fail safely back
  to the supplied fixtures, and Reset restores those fixtures.
- Added unmistakably local-prototype TeamPolicyes navigation plus list and builder routes.
  The builder presents one directed edge set through synchronized Flow and Matrix views,
  boundary actors, member inspection, all four boundary gates, preset selection, profile
  default preview, isolation state, and complete/incomplete definitions.
- Added exact Open Team, Coordinator, Review Pipeline, and Blank preset expansion. Missing
  profile defaults remain neutral unless a creation flow deliberately supplies a fallback;
  defaults cannot name peers and are copied into snapshots rather than inherited.
- Added live-team binding from read-only daemon data, stable prototype slot-to-agent
  mapping, source attribution and divergence state, reviewed compare/update-source,
  save-as-new, and incident-edge review before removing a member. Canonical Open Team
  fixtures expand existing live rosters for compatibility, while edited Open Team policies
  retain their actual restrictions.
- Added deterministic simulation for user, peer, and other-team channels. Denials render
  the attempted path and append a complete local block record without sending a message.
  Prototype-context agent chat shows the applicable local input/output gates, keeps history
  readable, disables blocked composition, and labels blocked delivery as local-only.
- Double-clicking a mapped live member opens its existing agent chat. Returning restores
  builder view, viewport transform, and selection. Fixture-only slots never expose a fake
  chat action.
- Added responsive desktop, tablet, and mobile layouts, including the mobile inspector
  drawer, keyboard dismissal/focus behavior, contained long names, and light/dark styling.
- Added `docs/policy-policy-handoff.md` and Todo stories BAZ-010 through BAZ-014 for the
  production persistence/API, enforcement/audit, web migration, CLI, and optional approval
  work.

Verification completed:

- `pnpm vitest run apps/web/test/policy-prototype.test.ts`: 21/21 tests passed, covering
  canonical endpoint equality, validation, channel derivation, exact preset topology,
  profile-default precedence, snapshot divergence/diff, version fallback, and complete
  denial records.
- `PATH=/opt/homebrew/bin:$PATH pnpm test` on Node 26.4.0: 81 files and 658/658 tests passed.
- Web and root typechecks passed; web and root production builds passed.
- `pnpm lint` passed with zero errors (47 existing warnings and 2 existing configuration
  infos); `git diff --check` passed.
- The in-app Browser/Playwright interaction matrix passed at every requested viewport and
  theme:

  | Viewport | Light | Dark |
  |----------|-------|------|
  | 1440x900 | Pass | Pass |
  | 1024x768 | Pass | Pass |
  | 390x844 | Pass | Pass |

  Each matrix cell exercised fixture reset, Flow selection and edge creation, synchronized
  Matrix/inspector gate edits, deterministic denial and block persistence across reload,
  live-team binding, member-removal review, compare/update-source, save-as-new, live-agent
  chat navigation, blocked composition, and exact return-state restoration. Long names and
  overlap were also inspected. The pass used a scrubbed isolated `BAZILION_HOME`; no real
  agent message was sent.

Deliberately not built here:

- Production database persistence, migrations, teamPolicy API writes, daemon enforcement,
  workflow execution, or approval queues.
- Any claim that browser-local policy is a security boundary. Those concerns remain in the
  explicit follow-up BAZs.

## Post-cleanup status (BAZ-018, 2026-07-12)

The local-only prototype and `/harnesses` URLs were removed after their Flow/Matrix interaction
model graduated into the server-backed Team Template and Team Policy editors. No prototype state
or migration UI remains in the product.
