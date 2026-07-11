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

## Draft (2)

| ID | Title | Size | Notes |
|----|-------|------|-------|
| [BAZ-001](draft/BAZ-001-a2a-federation-spike.md) | Spike — federated multi-employee Bazilion via A2A | S | Investigation only; output is a follow-up implementation BAZ |
| [BAZ-003](draft/BAZ-003-hermes-self-learning.md) | Hermes-style self-learning loop — background reviewer + skill self-editing | L | MVP = reviewer + human-approval gate; curator / FTS5 / runtime skill authoring deferred to v2 BAZs |

## Todo (3)

| ID | Title | Size | Notes |
|----|-------|------|-------|
| [BAZ-006](todo/BAZ-006-skill-execution-security.md) | Skill execution security - sandbox and command approval | L | Runtime hardening after BAZ-008: opt-in Docker bash sandbox + dangerous-command approval; selection is *not* security |
| [BAZ-013](todo/BAZ-013-harness-cli-policy-tools.md) | Harness CLI policy show, import/export, and block history | M | Revision-aware typed CLI management and canonical JSON interchange |
| [BAZ-014](todo/BAZ-014-harness-communication-approvals.md) | Human approval gates for harness communication | L | Optional approval-required edges after production allow/deny is validated |

## In Progress (0)

_None right now._

## Done (11)

| ID | Title | Size | Shipped | Release | Notes |
|----|-------|------|---------|---------|-------|
| [BAZ-002](done/BAZ-002-profile-groups.md) | Profile Groups — preconfigured team templates | M | 2026-05-25 | [v0.2.0](https://github.com/rullopat/bazilion/releases/tag/v0.2.0) | Atomic team-template spawn — see the file's As-built block for deltas |
| [BAZ-005](done/BAZ-005-agent-templates-refresh.md) | Agent templates refresh — two-sided bootstrap, USER.md seed, workspace doc | M | 2026-05-29 | v0.5.0 | Two-phase bootstrap, USER.md seed + backfill, creature/avatar, default-on AGENTS/TOOLS (HEARTBEAT opt-in) — see As-built for deltas |
| [BAZ-007](done/BAZ-007-simple-installer-and-dashboard.md) | Simple installer and dashboard launch for non-technical users | M | 2026-06-22 | v0.6.0 | Bundled web UI, `bazilion dashboard`, and one-line website installers |
| [BAZ-008](done/BAZ-008-skill-content-scan.md) | Skill content scan — prompt-injection and exfiltration warnings | S | 2026-07-02 | unreleased | Static scan on import/list/attach; confirmation required for risky imports and attaches |
| [BAZ-009](done/BAZ-009-configurable-agent-harness.md) | Configurable agent harness - functional communication-flow prototype | L | 2026-07-10 | unreleased | Local-only Flow/Matrix policy prototype, live-group snapshots, denial simulation, and verified responsive Browser matrix |
| [BAZ-010](done/BAZ-010-harness-persistence-api.md) | Canonical harness storage and compatibility migration | L | 2026-07-11 | unreleased | Canonical Team revisions, one Group policy, atomic legacy migration, exact-Open adapters, and lifecycle lease |
| [BAZ-015](done/BAZ-015-harness-policy-lifecycle-api.md) | Revisioned Team-template, Group-policy, and Agent lifecycle APIs | L | 2026-07-11 | unreleased | Canonical Team/Group policy APIs, stable-slot source workflows, explicit placement, and atomic lifecycle |
