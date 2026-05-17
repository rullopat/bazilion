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
- **Frontmatter** (every file): `id`, `title`, `status`, `size`, `created`, optional `shipped` / `priority` / `deferred` / `deferred_reason` / `note`.
- **Body shape:** User stories (As a / I want / So that) → Goal → Why → Scope → Out of scope → Tests. Open items add Open Questions; shipped items add an As-built block.
- **Sizes** (solo-dev pace): XS ≈ afternoon, S ≈ 1–2 days, M ≈ ~1 week, L ≈ 1–2 weeks, XL > 2 weeks → split into multiple BAZs.
- **State transitions:** to move an item, `git mv` it between dirs and update the `status:` field in frontmatter.

## State definitions

- **Draft** — captured but not committed-to. Has open questions, missing acceptance criteria, or no forcing function. Don't start work without resolving the open questions.
- **Todo** — refined and ready. User stories + scope are clear; pulling it into a sprint is a yes/no decision, not a "let's first figure out what this means" decision.
- **In Progress** — actively being worked on right now. Move here from `todo/` when implementation starts, so it's clear what's in flight. There's no enforced limit — solo-dev pace usually keeps this folder at 0–1 items, but a refactor with multiple side BAZs in parallel is fine. Move to `done/` when shipped.
- **Done** — shipped. The file becomes part of the project's release history; the `As-built` block records what actually happened (vs. what was planned).

---

## Draft (1)

| ID | Title | Size | Notes |
|----|-------|------|-------|
| [BAZ-001](draft/BAZ-001-a2a-federation-spike.md) | Spike — federated multi-employee Bazilion via A2A | S | Investigation only; output is a follow-up implementation BAZ |

## Todo (0)

_None yet._

## Done (0)

_None yet._
