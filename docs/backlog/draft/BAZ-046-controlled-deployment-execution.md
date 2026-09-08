---
id: BAZ-046
title: Controlled deployment execution and verified outcomes
status: draft
size: L
created: 2026-09-07
priority: medium
note: After specialist verification; one configured deployment backend, exact release authorization, and observed outcomes.
---

# BAZ-046 — Controlled deployment execution and verified outcomes

## User stories

- **As an operator using a deployment Agent**, I want to authorize a specific release and target
  environment, so delegation cannot deploy a different revision or an unintended destination.
- **As a deployment Agent**, I want to request a configured deployment and inspect its actual
  outcome, so I can complete a handoff without receiving production credentials or a host shell.
- **As an operator returning after a disconnect**, I want to distinguish a submitted job, a deployed
  release, and verified health, so an interrupted request cannot cause a duplicate deployment.

## Goal

Add a narrow, daemon-owned deployment capability for one configured external backend. Start with
an existing CI/CD deployment job consuming an already published immutable revision or artifact.
An Agent can prepare a request; only an explicit authenticated operator action authorizes execution
of the captured release/environment tuple. Retain provider evidence and bounded health observations.

## Why and current baseline

Verified against Bazilion `13c3a63` (v0.14.2) on 2026-09-07:

- Profiles, Team Templates, and [messaging](../../../apps/daemon/src/runtime/tools/messaging.ts)
  can already assign a deployment specialist. They do not grant a deployment execution capability.
- [Invocation selection](../../../apps/daemon/src/lib/turn-invocation.ts) makes inbox, Telegram,
  scheduled, approval-delivery, and private-gateway turns protected. Protected
  [Docker commands](../../../apps/daemon/src/runtime/shell/docker.ts) have no network, while the
  [turn runner](../../../apps/daemon/src/lib/agent-turn.ts) withholds browser/MCP capabilities.
  A locally initiated configured host turn is not evidence that delegated deployment works.
- [Communication approvals](../../../apps/daemon/src/lib/approval-delivery-plan.ts) hold specific
  messages, turns, and transport effects. Their authorization is not a deployment permission.
- [BAZ-044](BAZ-044-coding-review-handoff.md) prepares a review packet and handoff exports; it
  explicitly excludes automatic publication and deployment. BAZ-041 receipts describe executed
  checks, not remote release state. There is currently no deployment-specific daemon/client API.
- [Secret merging](../../../apps/daemon/src/core/secrets.ts) exports stored secret values into
  the configured operator environment. Adding a connector token to that export set would also
  expose it to unrelated configured workers and stdio MCP processes.

## Scope

### Configured target and captured request

- Select one real deployment backend and qualify its dispatch, identity, status, and authentication
  contract before moving to todo. Prefer an existing deployment job; provisioning CI infrastructure,
  a provider marketplace, and arbitrary shell/webhook executors are outside this slice.
- An operator configures an allowed Team/Agent scope, repository/project, named environment,
  trusted job or recipe revision, bounded input schema, credential reference, required check policy,
  and optional fixed health checks. Targets and recipes are revisioned; changes invalidate pending
  authorization. An Agent cannot create targets, replace recipes, or choose a different credential.
- Capture the requesting Agent/Team/session, source handoff, immutable published commit or artifact
  digest, target revision, recipe revision, check evidence, and expiry in a daemon-owned request.
  Resolve external identity through the connector; a branch, mutable tag, prose, or supplied URL is
  insufficient. An unavailable artifact or unresolvable published revision is an explicit blocker.
- Bind required BAZ-041/BAZ-045 evidence to the published source using BAZ-042's content identity.
  Dirty-tree results cannot be relabelled as checks for a later commit without verifying equivalent
  relevant content and coverage. Changed check definitions, environment requirements, incomplete
  evidence, or a failed required check block execution; no model-authored override or silent skip.
- If the job builds an artifact, require observed provenance linking its digest to the authorized
  source and trusted build/deploy recipe. The backend must deploy the captured input, never resolve
  a moving branch or rebuild from an unrecorded recipe at execution time.

### Explicit execution authorization and credential ownership

- Present the exact release, environment, recipe, checks, and known limitations before the
  operator chooses **Deploy this release** through authenticated web/CLI. Capture one expiring
  authorization for that immutable request; repeating the action returns the same dispatch state.
  Editing inputs requires a new request. Checking status or opening a detail page has no side effect.
- Agent request/inspection tools use turn-bound daemon IPC with caller identity derived by the
  daemon. They cannot execute, authorize, widen target scope, or supply raw commands/URLs/tokens.
  Preserve canonical Team Policy at communication boundaries and authorized output delivery.
- Deployment authorization belongs to this narrow deployment resource. Neither approving a peer
  message, a passing test, a completed review, a Telegram reply, nor BAZ-006 shell approval grants it.
  Do not add a stage to communication approvals or use the learning-review workflow for deployment.
- Keep credentials in encrypted daemon-owned storage with an explicit daemon-only classification.
  Exclude them from legacy merged environments, every worker input/env, stdio MCP environments,
  prompts, Team files/memory, diagnostics, and exports. Connector code alone resolves the selected
  credential; reuse existing secret ownership without creating a client-owned vault.
- Bound connector endpoints and inputs to the configured backend. Reject executable input,
  untrusted redirects, arbitrary fetch destinations, and ambient host credentials. Keep ordinary
  protected shell/network/browser/MCP rules intact; the new capability is a fixed operation.
- At dispatch, revalidate operator authorization, membership, target scope/revision, required
  evidence, published input, and credential availability. Revocation, expiry, or a changed recipe
  prevents any new dispatch. A later revocation cannot undo an already accepted external deployment.

### Dispatch, recovery, and observed results

- Persist the captured intent and dispatch identity before making the external request. A daemon
  claim owns submission; duplicate clicks, worker messages, delayed communication approvals,
  reconnects, and ordinary inbox wakes cannot submit the deployment again.
- Serialize Bazilion submissions to the same external project/environment even when configured
  under different aliases or requested by different Agents. Keep that canonical target busy through
  submitting, accepted/running, and unknown outcomes, not just during the API call. Release it only
  after a confirmed terminal outcome or explicit reconciliation; this slice cannot supersede an
  in-flight deployment. External operators/CI may still deploy; detect changed target state and
  never claim an exclusive lock on the remote platform.
- Record external job/deployment identity, input identity, timestamps, and observed state. Separate
  requested/awaiting authorization, blocked/expired, submitting/unknown, accepted/running, failed,
  cancelled, and deployed; keep health verification as distinct evidence rather than inferred success.
- After a timeout or daemon crash, reconcile through the external identity or a provider-supported
  idempotency/correlation key. If submission cannot be established, report an unknown outcome and
  require operator reconciliation. Do not automatically resubmit or claim universal exactly-once
  delivery. Polling known work may resume with bounded backoff without repeating the side effect.
- Cancelling before dispatch prevents submission. After acceptance, stopping a Bazilion Agent or
  closing the UI does not cancel the external job. Report cancellation only when the selected
  backend confirms it; otherwise preserve running/unknown state and an external job link.
- A successful job is not sufficient evidence of what is live. Verify the deployed revision/artifact
  using the selected backend's authoritative identity. Preserve an old deployment's success as
  historical if a newer external deployment supersedes it.
- Run only configured, bounded health observations against the authorized target; no model-selected
  endpoints, arbitrary smoke-test commands, or credentials in URLs. Record timing and observed
  release identity where available. An HTTP 200 alone cannot prove the requested release is live.
  Report unavailable/mismatched identity or failing health explicitly. Production acceptance remains
  a separately recorded operator decision, never inferred from deployment or health success.
- The first slice has no automatic retry of a deployment or rollback. Retain useful failure evidence
  and the external job link; any later rollback capability requires its own exact target/action scope.

### Operator surfaces and persistence

- Provide hermetic API/client types and CLI/web parity for configuration, request, inspect,
  authorize, and supported cancellation. Readiness checks are read-only backend queries, not trial
  deployments. Do not add a second Team roster or move permanent Agents between Teams.
- Telegram and native clients can receive authorized summaries and open the authenticated detail;
  direct Telegram deployment authorization and a dedicated mobile deployment screen are deferred.
- Retain bounded deployment metadata and redacted evidence outside the writable Team tree. Reuse
  BAZ-034 access/retention primitives for exports; peer access to source logs requires explicit
  authorization and cannot bypass a held Agent delivery. Missing evidence stays visibly unavailable.
- Project actionable requests/failures into the existing Attention Center with resolution at the
  deployment source. Extend its closed kind contract explicitly; acknowledgement cannot authorize
  or retry deployment. BAZ-038 notification delivery is optional, not a prerequisite.
- Persist only deployment-specific intent/authorization/receipt metadata; Pi JSONL remains the
  transcript. Do not introduce generic runs/events tables or a configurable pipeline engine. Apply
  the alpha clean-install schema and backup contract. Restored pending authorizations are invalid;
  reconcile known external work read-only before permitting newly authorized deployment attempts.

## Acceptance criteria

1. A selected deployment Agent can prepare and inspect a request from protected execution without
   receiving deployment credentials, host tools, or arbitrary network access.
2. Only explicit authenticated execution authorization can submit the captured published input to
   its captured target/recipe. Wrong membership, missing evidence, stale inputs, expired permission,
   recipe changes, and approved communication alone cannot authorize submission.
3. One configured backend proves that the submitted and deployed source/artifact match the request.
   Dirty-tree evidence is used only after verified content mapping; moving refs cannot substitute.
4. Duplicate admission and competing environment aliases cannot cause repeated Bazilion submission.
   Running/unknown deployment keeps the target busy. Crash/timeout recovery reconciles known external
   work or reports unknown without automatic replay or admission of a competing release.
5. Accepted, running, deployed, superseded, failed, unknown, and health results follow observed
   external facts. A job success, HTTP 200, cancelled chat, or model statement cannot invent them.
6. Credentials remain daemon-only on configured local and protected paths, including stdio MCP,
   exports, and failure diagnostics. Arbitrary endpoint/input and identity-forgery attempts fail.
7. CLI/web show the same request and exact authorization scope; Attention and Telegram notices
   cannot execute it. Restart/restore preserves truthful history without reviving authorization.

## Dependencies and sequencing

- Follow [BAZ-045](BAZ-045-specialist-verification-handoff.md) in the recommended coding sequence.
  Reuse [BAZ-041](BAZ-041-coding-command-verification.md) receipts and
  [BAZ-042](BAZ-042-git-change-review.md) source identity. A passing specialist result is evidence,
  not a deployment grant. [BAZ-044](BAZ-044-coding-review-handoff.md) packets are optional context.
- Use [BAZ-034](../done/BAZ-034-durable-agent-deliverables.md) for durable evidence exports and current
  Team Policy/authentication. [BAZ-043](BAZ-043-isolated-coding-workspaces.md) is not required to
  deploy an already published immutable input; deployment never mutates the coding workspace.
- Publication remains an operator/existing-CI prerequisite. Automatic commit/push/PR creation and
  managed test services require separate later stories; neither is silently included here.
- L is provisional for one backend. Resolve the open contract choices before todo; split before
  implementation if connector authorization, recovery, and operator surfaces exceed that bound.

## Out of scope

Automatic commit/push/PR/merge, CI provisioning/hosting, arbitrary deployment scripts or webhooks,
multiple providers, infrastructure provisioning, managed test services, direct SSH/host-shell
deployment, general credentialed tools in protected turns, autonomous production authorization,
approval chains, rolling/canary strategy engines, automatic deployment retries/rollback, and
synthetic claims of production acceptance.

## Tests

- Contract-test one backend's immutable dispatch inputs, observed artifact/source identity, bounded
  inputs, credential scope, status mapping, health checks, and supported cancellation semantics.
- Race duplicate requests, approval delivery, inbox wake, target aliases, simultaneous Agents,
  configuration changes, expiry, and revocation against dispatch. Prove one admitted submission
  and target exclusion while remote work is accepted/running or its outcome is unknown.
- Interrupt before submission, after remote acceptance but before its reply, and during polling;
  verify reconciliation or unknown state with no blind replay, including backup restoration.
- Change published refs/artifacts, source coverage, check receipts, recipe revision, and live target
  state. Verify blockers, stale evidence, historical success, and a truthful superseded state.
- Test deployment-secret exclusion from all worker/MCP paths, logs, exports, attention diagnostics,
  and refreshed credentials; exercise forged identities, redirects, endpoints, and unsafe inputs.
- Validate authenticated web/CLI parity, CSRF, held egress, source-owned Attention resolution,
  retention/deletion, and the relevant adversarial security acceptance checks.
- Before release, exercise an explicitly authorized non-production deployment on the selected
  backend and verify actual deployed identity and health. Mock success alone is not live proof.

## Open Questions

- **First backend and target:** select one existing deployment job/platform and non-production
  acceptance target. Document official dispatch/auth/status semantics during refinement; do not
  assume every provider supports immutable inputs, idempotency, cancellation, or release identity.
- **Required checks and provenance:** define each target's exact required check policy and how a
  dirty snapshot maps to published source/build artifacts. Default to blocking unknown equivalence.
- **Credential export boundary:** choose the smallest daemon-only secret representation and audit
  every existing merged-environment consumer. Merely encrypting a normally exported row is insufficient.
- **Authorization and retention:** set finite expiry, same-target submission rules, evidence quotas,
  and operator reconciliation for unknown outcomes. Keep source resolution separate from acknowledgement.
- **Health identity:** choose a bounded observation that identifies the deployed release; explicitly
  document backends/apps where only job completion or generic reachability can be established.
