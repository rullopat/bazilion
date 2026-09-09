---
id: BAZ-045
title: Specialist verification of a captured code change
status: draft
size: L
created: 2026-09-07
priority: high
note: Follow the first coding milestone; delegate finite checks to an existing tester without a general workflow engine.
---

# BAZ-045 — Specialist verification of a captured code change

## User stories

- **As an operator with coding and testing Agents**, I want the coder to hand a specific change
  to the selected tester, so the returned results prove which code and checks were exercised.
- **As a testing Agent**, I want the requested checks, environment, and relevant evidence together,
  so I can investigate failures without guessing the branch or reading another Agent's transcript.
- **As an operator receiving test results**, I want actual outcomes and stale evidence distinguished,
  so an old passing result cannot authorize the next step after the code changes.

## Goal

Delegate a bounded verification request to an existing specialist Agent and return executor-owned
evidence for the captured change. Start with coordinated verification inside the same Team's existing
workspace. A testing Profile describes expertise; execution permissions come from the daemon-bound
request and existing runtime controls, never from the Profile's name or a message saying "test this".

## Why and current baseline

Verified against Bazilion `13c3a63` (v0.14.2) on 2026-09-07:

- [Messaging tools](../../../apps/daemon/src/runtime/tools/messaging.ts) already provide delegation,
  inbox reads, reply correlation, and communication-approval status. Profiles and Team Templates
  can already supply distinct coder/tester roles; this story does not add another role or roster model.
- [Inbox dispatch](../../../apps/daemon/src/lib/scheduler.ts) starts ordinary Agent turns through
  current admission. Free-text messages do not bind a runnable snapshot or a restricted check set.
- The [invocation resolver](../../../apps/daemon/src/lib/turn-invocation.ts) makes inbox and other
  background turns protected. Their shell has no network or deployment credentials; a local host
  check is not evidence that the delegated tester has a usable protected environment.
- Revised BAZ-040 includes ordinary same-Team preparation help through existing messaging.
  This story adds formal snapshot-bound specialist verification; it is not required for that help.
- BAZ-040–042 define task-driven environments, command receipts, and immutable change identity.
  BAZ-044 covers static review and excludes reviewer-run commands. Specialist test execution needs
  its own request, dispatch, workspace coordination, and evidence-access contract.

## Scope

### Captured request and selected specialist

- An authenticated operator or authorized coding Agent selects an existing same-Team tester and
  creates one typed request through canonical messaging/Team Policy. Capture requester, recipient,
  Team, source conversation/message, BAZ-042 snapshot and coverage, and an optional acceptance summary.
- Bind the exact BAZ-040 environment revision, named finite checks and their definitions, cwd,
  output/time bounds, and relevant BAZ-041 receipts. Resolve the image and dependency facts at
  admission; changed or unavailable requested inputs produce a blocker, never silent substitution.
- Only operator-reviewed check definitions are executable. A tester may recommend additional
  checks, but changing commands, parameters, environment, or snapshot requires a new request and
  applicable authorization. No arbitrary shell text hidden in a test label or model-generated hook.
- Keep the typed metadata and immutable references in the daemon. Pi JSONL remains the transcript;
  retain only the finite request's ownership, state, and evidence references, with bounded retention.
  Do not add generic runs/events tables, workflow stages, or an alternative Team membership system.

### Admission, coordination, and bounded execution

- Give the request one dispatch owner through inbox delivery, busy-Agent waiting, communication
  approval, and completion. Ordinary inbox wake must not also consume it as a normal writable
  coding turn. Retained/reconstructed invocations preserve request identity and capability limits.
- Revalidate current membership, directed policy, loop limits, requested inputs, and Agent lifecycle
  before execution. Communication approval releases its captured attempt; it does not authorize
  arbitrary shell execution or override dangerous-command approval, isolation, or output policy.
- Use BAZ-040's canonical-workspace coordination alongside existing per-Agent admission. Reserve
  the workspace for the verification interval, preventing another Bazilion Agent/probe from writing
  through another ingress or alias. Waiting for a tester must not keep the coder's turn or workspace
  claim occupied indefinitely; release the requesting turn before the tester can take ownership.
- Validate that the coordinated live workspace matches the captured snapshot before checks start.
  If the coder or an external editor changed it while waiting, return stale/blocked and request a
  fresh capture. Do not reset the checkout, stash someone's edits, or test a different tree silently.
- Enforce a test capability in runtime tools/IPC: inspect authorized inputs and invoke only the
  captured finite check definitions. Do not provide unrestricted Bash, edit/write tools, deployment
  credentials, browser/MCP escape paths, or a host fallback because an Agent has a testing Profile.
- Execute checks through existing protected shell execution, approval, cancellation, and BAZ-041
  receipts. Unattended commands needing unavailable shell approval remain blocked. Preserve fresh,
  network-disabled containers, contained cwd, and the selected prepared environment.
- Test processes may write declared generated output/cache locations in the approved workspace
  and temporary environment. Restrict the Agent's command surface without pretending repository
  test code is read-only: source mutation by a check invalidates applicability, even with exit zero.
- Record before/after source identity and known environment/dependency facts. BAZ-040 coordination
  covers Bazilion writers, not external editors; detected external mutation or incomplete coverage
  yields stale/unknown applicability. Exclusions must remain visible and cannot conceal source edits.
- Missing databases, browser services, dependencies, or network-required checks are explicit
  unsupported/blocked outcomes. No automatic installation, service startup, or relaxed networking.

### Results, access, and operator surfaces

- Attach actual BAZ-041 command receipts to this request/snapshot; tester findings are labelled
  interpretation. Keep successful exit, failed check, skipped/not executed, timeout, cancellation,
  missing evidence, and interrupted/unknown outcomes distinct. A final chat sentence proves none.
- Define explicit per-request access for the selected tester to captured inputs and for the
  requester to returned receipts/logs/artifacts. BAZ-034 does not itself grant Agent-to-Agent result
  sharing: add only this bounded reference/byte access, checked by daemon identity and Team Policy.
  Do not make another Agent's private logs, transcript, home, or all Team results generally readable.
- Reuse BAZ-034 captured-byte storage/retention and BAZ-041 log access where applicable. Sending
  request inputs, peer results, and operator-visible output each honors its own source authorization;
  an approval hold cannot be bypassed by shared memory, a result-library entry, or a direct log URL.
- Deliver a concise result with requested snapshot, checks attempted, evidence links, findings,
  limitations, and current applicability. Later code/environment changes leave the historical result
  intact but stale for current work. A reply alone cannot trigger review, publication, or deployment.
- Provide authenticated API/client, CLI, and responsive web create/list/show/cancel operations with
  the same pending, approval-held, blocked, running, completed, failed, cancelled, and uncertain facts.
  Telegram uses concise authorized notices and an authenticated evidence handoff, not full log floods.
- Persist accepted pending requests and bound artifacts before acknowledging them. Resume only
  eligible pending work after restart; an interrupted claimed execution remains uncertain and is
  never automatically replayed. Explicit rerun creates a new attempt linked to the previous result.
- Define request/artifact expiry, cancellation races, Agent/Team deletion, and backup/restore.
  Lost or deleted evidence stays visibly unavailable; restore must revalidate environment/workspace.

## Acceptance criteria

1. A coder can request checks from an existing same-Team tester against a captured dirty change;
   the returned receipts identify exactly the requested code, commands, environment, and outcomes.
2. Busy waiting, delayed approval, inbox wake, and restart preserve the typed request and sole
   dispatch owner. No path executes it again as an unrestricted Agent turn or replays uncertain work.
3. Concurrent Bazilion writes cannot change the shared workspace during verification. A mismatch
   before execution blocks it; source mutation during checks or later edits invalidates applicability.
4. The tester cannot widen its commands or privileges. Missing tools/services/approval stay explicit
   blockers; generated test output is supported without calling modified source successfully verified.
5. Only authorized participants can access captured inputs and evidence. Denied/held peer or user
   delivery remains inaccessible through new endpoints, result libraries, and Telegram references.
6. API/CLI/web agree on request and evidence status after reconnect/restart, cancellation, expiry,
   and backup/restore. Model summaries never replace executor facts or imply deployment acceptance.

## Dependencies and sequencing

- Depends on [BAZ-040](../in_progress/BAZ-040-coding-environment-readiness.md) environment/check definitions and
  workspace coordination, [BAZ-041](BAZ-041-coding-command-verification.md) execution evidence, and
  [BAZ-042](BAZ-042-git-change-review.md) snapshot identity. Deliver after the first coding milestone.
- Reuses [BAZ-034](../done/BAZ-034-durable-agent-deliverables.md) retained bytes; this story owns the narrow
  Agent-to-Agent access extension. [BAZ-035](../done/BAZ-035-conversation-library.md) supplies exact source
  conversation identity without requiring a second chat store.
- Align with [BAZ-036](../done/BAZ-036-visible-follow-up-queue.md) for admission/visibility; its user-input
  queue must not take ownership of specialist or approval dispatch. Its complete UI is not required.
- [BAZ-043](BAZ-043-isolated-coding-workspaces.md) enables parallel checkouts later, not a prerequisite
  for coordinated same-Team checks. [BAZ-044](BAZ-044-coding-review-handoff.md) can consume these
  receipts; it remains a distinct static-review capability. No automatic pipeline is introduced.

## Out of scope

Cross-Team runnable snapshot transfer, managed databases/services/browser test environments,
new testing tools/framework parsers, automatic check selection or retries, changing source to fix
failures, per-conversation cwd, another roster, general workflow orchestration, automatic
commit/push/PR creation, deployment, and treating a tester's conclusion as execution authorization.

## Tests

- Hand a small real-repository bug to a tester; verify one passing and one failing finite check,
  recorded environment/snapshot identity, retained output, and accurate operator/peer results.
- Race coder/tester/probe writes, aliases, stale input before claim, external edits, test-mutated
  source, generated files, busy recipients, and requester waiting without workspace deadlock.
- Race inbox wake, communication approval, cancellation, duplicate delivery, and restart; prove
  one restricted dispatch owner, no privilege expansion, and no replay after uncertain execution.
- Exercise missing toolchains/services, forged check parameters/identities, cross-Agent references,
  held peer/user egress, expiry, missing bytes, and API/CLI/web/Telegram consistency.
- Verify lifecycle/backup contracts and applicable protected-execution security acceptance checks.

## Open Questions

- **Check capability:** choose the exact daemon-bound invocation/tool contract and allowed command
  parameters. Recommend captured named checks only, with a new request for any changed definition.
- **Coordination and writes:** agree reservation scope, wait ordering, output/cache declarations,
  and before/after coverage. Recommend sequential same-Team execution and conservative stale states.
- **Evidence sharing:** define request-scoped grants and revocation/expiry across peer and operator
  delivery. Recommend immutable selected references only; private transcript access stays excluded.
- **Size:** if restricted dispatch and evidence sharing exceed L, split these implementation slices
  before todo while retaining one end-to-end acceptance case; do not defer their access boundaries.
