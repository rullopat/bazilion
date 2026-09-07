# Bazilion — Product Backlog

Backlog items live in this directory, one file per item, organised by state.

```
docs/backlog/
├── draft/        ← needs more definition / open questions / explicitly deferred
├── todo/         ← refined, ready to pull into a sprint
├── in_progress/  ← actively being worked on right now
└── done/         ← shipped, kept as a historical record
```

## Conventions

- **Naming:** `BAZ-NNN-short-slug.md` (sequential at creation time so codes don't shift when priority changes).
- **Frontmatter** (every file): `id`, `title`, `status`, `size`, `created`, optional `refined` / `shipped` / `priority` / `deferred` / `deferred_reason` / `note`.
- **Body shape:** User stories (As a / I want / So that) → Goal → Why → Scope → Out of scope → Tests. Open items add Open Questions; shipped items add an As-built block.
- **Sizes** (solo-dev pace): XS ≈ afternoon, S ≈ 1–2 days, M ≈ ~1 week, L ≈ 1–2 weeks, XL > 2 weeks → split into multiple BAZs.
- **State transitions:** to move an item, `git mv` it between dirs and update the `status:` field in frontmatter.

## State definitions

- **Draft** — captured but not committed-to. Has open questions, missing acceptance criteria, or no forcing function. Don't start work without resolving the open questions.
- **Todo** — refined and ready. User stories + scope are clear; pulling it into a sprint is a yes/no decision, not a "let's first figure out what this means" decision.
- **In Progress** — actively being worked on right now. Move here from `todo/` when implementation starts, so it's clear what's in flight. There's no enforced limit — solo-dev pace usually keeps this folder at 0–1 items, but a refactor with multiple side BAZs in parallel is fine. Move to `done/` when shipped.
- **Done** — shipped. The file becomes part of the project's release history; the `As-built` block records what actually happened (vs. what was planned).

---

## Draft (9)

| ID | Title | Size | Notes |
|----|-------|------|-------|
| [BAZ-038](draft/BAZ-038-telegram-attention-notifications.md) | Opt-in Telegram delivery of existing Attention items | M | Independent candidate: notification receipts, quiet hours, and canonical resolution links |
| [BAZ-039](draft/BAZ-039-repository-coding-context.md) | Repository context and coding onboarding within a Team | M | Coding first slice: bounded repository instructions, provenance, and command suggestions |
| [BAZ-040](draft/BAZ-040-coding-environment-readiness.md) | Prepared per-Team coding environments and truthful readiness | L | Prepared local toolchains and explicit finite probes under the actual execution posture |
| [BAZ-041](draft/BAZ-041-coding-command-verification.md) | Live coding command output and snapshot-bound verification | L | Retained logs and executor-owned check outcomes with code/environment freshness |
| [BAZ-042](draft/BAZ-042-git-change-review.md) | Git changes and review beside coding conversations | M | Read-only diffs, explicit dirty baselines, and revision-bound feedback |
| [BAZ-043](draft/BAZ-043-isolated-coding-workspaces.md) | Isolated coding workspaces for parallel assignments | L | Later: canonical Team checkout ownership, writer coordination, and safe Git metadata access |
| [BAZ-044](draft/BAZ-044-coding-review-handoff.md) | Revision-bound coding review and handoff | L | Later: captured changes, scoped reviewer access, and handoff exports; publication deferred |
| [BAZ-045](draft/BAZ-045-specialist-verification-handoff.md) | Specialist verification of a captured code change | L | After the coding milestone: same-Team tester, captured checks, coordinated execution, and scoped evidence |
| [BAZ-046](draft/BAZ-046-controlled-deployment-execution.md) | Controlled deployment execution and verified outcomes | L | After specialist testing: one configured backend, exact release authorization, and observed deployment/health |

Drafted on 2026-09-07 from the OpenClaw 2.0 / Hermes desktop review and current Bazilion code.
BAZ-034 through BAZ-036 are committed in draft PR #44, pending release. BAZ-037 is in progress;
BAZ-038 remains selected for the same 0.15.0 PR. Track decisions and acceptance evidence
in [the milestone progress log](BAZ-035-038-progress.md). Sizes are provisional; each draft records
open decisions and boundaries to resolve before moving to `todo/`. Desktop packaging and Team
conversation views remain later ideas rather than part of this initial slice.

Coding drafts BAZ-039 through BAZ-044 were added on 2026-09-07. The initial coding milestone is
BAZ-039 through BAZ-042: follow repository instructions, use a prepared environment, run the relevant
finite checks, and return a persistent diff with verifiable results for a small real-repository bug.
Refine context and environment first; command evidence and Git review can proceed in parallel once
their shared snapshot contract is agreed. BAZ-034 supplies reusable durable-output primitives.
BAZ-043 adds parallel workspace ownership later, followed by BAZ-044's review/handoff experience;
static review itself does not require managed worktrees. Managed previews, language-server features,
and automatic commit/push/PR publication are outside these first coding drafts.

Specialist integration drafts BAZ-045 and BAZ-046 were added on 2026-09-07. Existing Profiles,
Team Templates, and policy-controlled messaging already support specialist collaboration. Refine
BAZ-045 after BAZ-039 through BAZ-042 for a coder-to-tester handoff with snapshot-bound check evidence;
coordinated same-Team verification does not require BAZ-043's managed parallel workspaces or
BAZ-044's static review UI. Follow with BAZ-046 for an explicitly authorized deployment through one
configured backend, consuming an already published revision/artifact and verifying the actual
outcome. Automatic Git publication and managed service/browser test environments remain separate
later story candidates. Neither draft introduces a general pipeline engine or turns communication
approval into permission to deploy.

## Todo (0)

| ID | Title | Size | Notes |
|----|-------|------|-------|

## In Progress (4)

| ID | Title | Size | Notes |
|----|-------|------|-------|
| [BAZ-034](in_progress/BAZ-034-durable-agent-deliverables.md) | Durable agent deliverables and a Team results library | M | Committed in PR #44; pending release |
| [BAZ-035](in_progress/BAZ-035-conversation-library.md) | Conversation library and safe new conversations | L | Explicit session foundation; selected for PR #44 |
| [BAZ-036](in_progress/BAZ-036-visible-follow-up-queue.md) | Visible, durable follow-up queue | L | Accepted pending messages across clients; active-turn steering deferred |
| [BAZ-037](in_progress/BAZ-037-structured-agent-questions.md) | Structured agent questions across web, CLI, and Telegram | L | Bounded live clarification; separate policy approvals and consumption evidence |

## Done (28)

| ID | Title | Size | Shipped | Release | Notes |
|----|-------|------|---------|---------|-------|
| [BAZ-033](done/BAZ-033-product-experience-hardening.md) | Product experience hardening across web and mobile | L | 2026-08-29 | [v0.14.0](https://github.com/rullopat/bazilion/releases/tag/v0.14.0) | First-run, chat, navigation, configuration, responsive, accessibility, and destructive-action UX hardening |
| [BAZ-031](done/BAZ-031-protected-runtime-provider-expansion.md) | Provider-neutral protected runtime | L | 2026-08-27 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Exhaustive credential-minimal protected execution for every provider in the pinned Pi catalog |
| [BAZ-032](done/BAZ-032-personal-server-security-acceptance.md) | Personal-server adversarial security acceptance gate | M | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | 60-case deterministic cross-boundary release gate for BAZ-027 through BAZ-031, with live posture evidence kept separate |
| [BAZ-028](done/BAZ-028-secure-personal-web-mobile-gateway.md) | Secure personal web and mobile gateway | L | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Expiring device credentials, hashed browser sessions, hardened private HTTPS gateway, and loopback-only Tailscale Serve preflight |
| [BAZ-030](done/BAZ-030-encrypted-backups-credential-recovery.md) | Encrypted backups and single-operator credential recovery | L | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Standard age recipient encryption, authenticated staged restore, secret-safe inventory, local token rotation, and external recovery guidance |
| [BAZ-029](done/BAZ-029-single-owner-telegram-pairing.md) | Single-owner Telegram pairing and visibility hardening | M | 2026-08-26 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | One-time owner pairing, fail-closed ingress identity, private-supergroup warnings, and secret-safe diagnostics |
| [BAZ-027](done/BAZ-027-credential-minimal-protected-agent-execution.md) | Credential-minimal protected Agent execution | L | 2026-08-23 | [v0.13.0](https://github.com/rullopat/bazilion/releases/tag/v0.13.0) | Minimal OpenAI Codex credentials, mandatory protected Docker, exact unattended-turn identity, no browser/MCP, and operator readiness visibility |
| [BAZ-026](done/BAZ-026-operator-attention-center.md) | Operator Attention Center — one queue for actionable runtime signals | M | 2026-08-05 | [v0.12.0](https://github.com/rullopat/bazilion/releases/tag/v0.12.0) | Unified source-owned queue, informational acknowledgement state, CLI parity, responsive web UI, and navigation badge |
| [BAZ-003](done/BAZ-003-hermes-self-learning.md) | Reviewed learning loop — transcript digest to durable lessons | M | 2026-08-03 | [v0.12.0](https://github.com/rullopat/bazilion/releases/tag/v0.12.0) | Opt-in restricted review worker, evidence-backed human approval, private prompt lessons, and shared Team-memory lessons |
| [BAZ-002](done/BAZ-002-profile-groups.md) | Profile Groups — preconfigured team templates (historical) | M | 2026-05-25 | [v0.2.0](https://github.com/rullopat/bazilion/releases/tag/v0.2.0) | Superseded by the canonical Team Template model in BAZ-018 |
| [BAZ-005](done/BAZ-005-agent-templates-refresh.md) | Agent templates refresh — two-sided bootstrap, USER.md seed, workspace doc | M | 2026-05-29 | v0.5.0 | Two-phase bootstrap, USER.md seed + backfill, creature/avatar, default-on AGENTS/TOOLS (HEARTBEAT opt-in) — see As-built for deltas |
| [BAZ-006](done/BAZ-006-skill-execution-security.md) | Skill execution security - sandbox and command approval | L | 2026-08-02 | [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Independent default-off Docker shell isolation and one-shot dangerous-command approval; non-interactive turns fail closed |
| [BAZ-007](done/BAZ-007-simple-installer-and-dashboard.md) | Simple installer and dashboard launch for non-technical users | M | 2026-06-22 | v0.6.0 | Bundled web UI, `bazilion dashboard`, and one-line website installers |
| [BAZ-008](done/BAZ-008-skill-content-scan.md) | Skill content scan — prompt-injection and exfiltration warnings | S | 2026-07-02 | [v0.8.0](https://github.com/rullopat/bazilion/releases/tag/v0.8.0) | Static scan on import/list/attach; confirmation required for risky imports and attaches |
| [BAZ-009](done/BAZ-009-configurable-agent-harness.md) | Configurable agent harness prototype (historical) | L | 2026-07-10 | Superseded before release | Local-only prototype removed after its interaction model graduated to Team Policy in v0.9.0 |
| [BAZ-010](done/BAZ-010-harness-persistence-api.md) | Production harness persistence foundation (historical) | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Canonical storage retained; transitional migration/adapters removed by BAZ-018 |
| [BAZ-015](done/BAZ-015-harness-policy-lifecycle-api.md) | Revisioned Team Template, Team Policy, and Agent lifecycle APIs | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Canonical APIs, stable-slot workflows, explicit placement, and atomic lifecycle |
| [BAZ-011](done/BAZ-011-harness-runtime-enforcement.md) | Team Policy authorizer, denial audit, and gated Agent messaging | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Shared authorizer, immutable denial audit, diagnostic evaluation, and gated messaging |
| [BAZ-012](done/BAZ-012-production-harness-web.md) | Production Templates and Teams web information architecture | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Canonical navigation, projections, lifecycle shells, and degraded recovery |
| [BAZ-016](done/BAZ-016-harness-runtime-boundaries.md) | Team Policy ingress, egress, scheduler, and turn-boundary enforcement | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | All runtime boundaries and activation-safe lifecycle linearization |
| [BAZ-017](done/BAZ-017-harness-web-editor-migration.md) | Production Team Policy editors, activity, and web QA | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Server-backed editors, conflicts/import/activity, accessibility, and viewport matrix |
| [BAZ-013](done/BAZ-013-harness-cli-policy-tools.md) | Team Policy CLI management and block history | M | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Revision-safe typed CLI management, portable JSON, diagnostics, and block filters |
| [BAZ-014](done/BAZ-014-harness-communication-approvals.md) | Human approval gates for Team Policy communication | L | 2026-07-11 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Durable approval-required edges, at-most-once dispatch, authenticated queue, CLI/tools, and responsive web workflow |
| [BAZ-018](done/BAZ-018-canonical-teams-cleanup.md) | Canonical Teams cleanup and clean-install schema | L | 2026-07-12 | [v0.9.0](https://github.com/rullopat/bazilion/releases/tag/v0.9.0) | Removed Group/Harness/Profile Group compatibility and made Teams the only product vocabulary |
| [BAZ-019](done/BAZ-019-scheduled-trigger-reliability.md) | Scheduled triggers without heartbeat files | L | 2026-08-01 | [v0.10.0](https://github.com/rullopat/bazilion/releases/tag/v0.10.0) + [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Removed HEARTBEAT.md; durable coalesced dispatch adds leases, bounded retry, approvals, and diagnostics |
| [BAZ-023](done/BAZ-023-worker-oauth-refresh.md) | Worker-side OpenAI Codex OAuth refresh | S | 2026-08-02 | [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Turn-bound daemon IPC refresh, token redaction, cancellation cleanup, and concurrent-refresh single-flight |
| [BAZ-024](done/BAZ-024-consistent-backup-restore.md) | SQLite-consistent backup and validated restore | M | 2026-08-02 | [v0.11.0](https://github.com/rullopat/bazilion/releases/tag/v0.11.0) | Verified online DB snapshot, safe archive validation, staged atomic restore, and rollback |
| [BAZ-025](done/BAZ-025-agent-loop-circuit-breaker.md) | Durable agent-message loop circuit breaker | M | 2026-08-03 | [v0.12.0](https://github.com/rullopat/bazilion/releases/tag/v0.12.0) | Daemon-enforced causal hop budget with payload-free diagnostics across API, CLI, and web |
