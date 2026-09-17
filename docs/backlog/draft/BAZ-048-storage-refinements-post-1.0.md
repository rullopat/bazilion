---
id: BAZ-048
title: Storage refinements from the OpenClaw/Hermes comparison (post-1.0)
status: draft
size: L (1-2 weeks, if built as one slice — more likely split)
created: 2026-09-17
note: Capture of post-1.0 storage ideas from design/storage-comparison-openclaw-hermes.md. Not committed; refine individually when a concrete use case exists.
---

# BAZ-048 - Storage refinements from the OpenClaw/Hermes comparison (post-1.0)

## User stories

- **As an operator with a year of conversation history**, I want full-text search over past
  conversations that stays fast as the library grows, so recall does not degrade with size.
- **As an operator whose database has grown large**, I want bulky retained payloads (coding
  command logs, source snapshots) moved out of the hot database into immutable compressed
  archives, so backups stay small and the DB stays fast without losing history.
- **As an operator running several agents**, I want each agent's conversational data isolated
  in its own data plane, so one agent's growth or corruption cannot stall the others.
- **As an operator reading the product docs**, I want one written statement of which storage
  surface is canonical for every artifact, so I never wonder whether the file or the database
  is the truth.

## Goal

A menu of storage refinements observed in OpenClaw and Hermes Agent, to be pulled from
individually when a concrete use case forces it. This item intentionally does not commit to
building them; it exists so the analysis is not lost and each can graduate to its own BAZ.

## Why

The [storage comparison](../design/storage-comparison-openclaw-hermes.md) found that
Bazilion's SQLite + Markdown mix matches where both mature projects converged. The remaining
gaps are refinements, not rewrites: both projects add capabilities around the same core that
Bazilion has not needed yet — and may never need at current scale.

## Candidate refinements

1. **Storage ownership invariant (ADR + docs).** One ADR listing every artifact — SOUL,
   IDENTITY, USER, AGENTS, TOOLS.md, the `user_md` column, receipts, snapshots, command
   logs — with its canonical owner and reconcile-on-boot behavior. Publish the operator-facing
   "which file does what" one-pager (Hermes' model) and the tier table (OpenClaw's model).
   *Cheapest item; consider promoting into BAZ-047 rather than deferring.*
2. **FTS over the conversation library.** Hermes stores full message history with FTS5
   indexes in `state.db`, with `sessions optimize` (merge FTS segments + VACUUM) as
   non-destructive housekeeping and rich filtered export. Natural fit for BAZ-035's library
   and BAZ-036's follow-up queue as history accumulates.
3. **Cold archives outside the database.** OpenClaw keeps a DB index row per archive with
   payloads as immutable `<sha256>.jsonl.zst` files beside the DB, schema-versioned, restored
   on demand. Apply to `coding_command_logs` and `source_snapshots` when they dominate DB
   size — keeps BAZ-024 snapshots small.
4. **Per-agent data-plane split.** OpenClaw separates global control-plane SQLite from a
   per-agent SQLite holding sessions/transcripts/memory indexes. Relevant only if Bazilion's
   multi-agent workloads create contention or unbounded per-agent growth in one file.
5. **Bounded-memory injection.** Hermes' hard char limits with error-on-overflow (forcing the
   agent to consolidate in the same turn) and frozen-snapshot injection for prefix-cache
   stability; OpenClaw's budgeted injection with visible raw-vs-injected diagnostics. Apply
   to prompt budget discipline for the agent templates as workspaces age.
6. **Pre-upgrade preflight as a product feature.** OpenClaw's `database preflight` lets an
   updater verify schema compatibility before crossing a release. Once BAZ-047 ships, expose
   the same check to `bazilion upgrade` so operators see "this version is too old to cross"
   before, not during, the migration.

## Open Questions

- Is there real evidence (DB size, query latency, backup size) for any of these yet, or are
  they all speculative? Each should graduate only on a concrete trigger.
- For FTS (2): should search cover workspace Markdown too, or only DB-resident conversation
  history? OpenClaw keeps memory search over files with a separate index.
- For cold archives (3): does BAZ-046's publication evidence chain require snapshots to stay
  inline in the DB for integrity verification, or can hash-checked external archives serve?
- For the split (4): single-operator personal server — is multi-tenancy ever a goal, or does
  that permanently rule the per-agent split out?

## Out of scope

- Any non-SQLite storage engine (Postgres, libSQL, DuckDB) — rejected for this product class.
- Anything blocking the beta; BAZ-047 owns the beta storage work.

## Tests

_Per candidate, when it graduates to its own BAZ. The one shared invariant to test today:
nothing here changes BAZ-047's contract — forward-only migrations, receipts, and
refuse-newer-schema hold regardless of which refinements land._
