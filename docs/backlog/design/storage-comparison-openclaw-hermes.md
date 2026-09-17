# Storage comparison: OpenClaw and Hermes Agent

*Researched 2026-09-17 from public sources, to ground the beta storage-contract work (BAZ-047) and post-1.0 storage refinements (BAZ-048). All findings are from the projects' own documentation; repo paths cited so claims can be re-verified.*

## Why this matters

Bazilion currently runs a SQLite-database + workspace-text-files mix, with an **alpha clean-install contract**: schema changes wipe homes, migrations have been edited in place, and homes cannot upgrade across releases (BAZ-040, 042, 044, 046 all required it). Before a beta, we need a stable schema contract. Both reference projects already solved this — and both **converged on the same hybrid shape** Bazilion already has: SQLite for control-plane and conversational state, plain Markdown for agent-facing memory. Neither uses a client/server database engine.

## OpenClaw (`openclaw/openclaw`, TypeScript)

Sources: `docs/reference/database-schemas.md`, `docs/reference/database-schemas/layout.md`, `docs/concepts/memory.md`, `docs/concepts/memory-architecture.md`, `docs/concepts/agent-workspace.md`.

### Databases

| Scope | Default path | Contents |
|---|---|---|
| Global control plane | `~/.openclaw/state/openclaw.sqlite` | Shared configuration state, registries, approvals, plugin state, shared runtime state |
| Per-agent data plane | `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite` | Sessions, transcripts, memory indexes, auth state, conversation state |

### Schema versioning contract (the part most relevant to BAZ-047)

- Migrations run **forward** when a database opens. Older builds **refuse** databases written by a newer schema. Downgrades are explicitly unsupported, with a documented recovery path per schema bump.
- `openclaw doctor --fix` owns file-to-SQLite migrations and **records a receipt per migration** in shared `migration_runs` and `migration_sources` tables.
- CI runs `scripts/check-native-state-schema-version.mjs`, failing the build when the Swift and TypeScript state-database contracts declare different schema versions.
- `openclaw database preflight` lets an updater check schema compatibility **before** crossing a release boundary.
- Integrity verification: databases that fail checks are **quarantined**, not silently used.
- Backups: per-database snapshots, scheduling, offsite copies; the updater takes a verified backup before a schema bump.

### Cold transcript archives

The per-agent DB keeps a `session_transcript_cold_archives` table that records archive locations alongside `session_windows` / `transcript_events`. The payload lives in an **immutable compressed JSONL file**: `~/.openclaw/agents/<agentId>/sessions/cold/<sha256>.jsonl.zst`. The DB holds the index; the filesystem holds the heavy history. Archival is schema-versioned (agent schema 20).

### Memory = plain Markdown in the workspace

Five design principles from `memory-architecture.md`, worth reading in full:

1. **No hidden state** — the model only remembers what is written to files; every memory surface is inspectable and editable with a text editor.
2. **Writing is the hard part** — retrieval over notes files is competitive with far heavier designs; write-time curation is what degrades memory systems (they cite LongMemEval, arXiv:2410.10813). Curation is moved off the busy reply path into a background pass ("dreaming").
3. **The write path is the security boundary** — content-level scanning cannot reliably catch poisoned facts, so provenance is enforced at write time and promotion is gated structurally.
4. **Deterministic gates, model judgment inside them.**
5. **Failures never block replies** — memory subsystem degradation never eats a turn.

Tier model:

| Tier | Surface | Written by | Injected |
|---|---|---|---|
| Instructions | `AGENTS.md` + workspace instruction files | Human only | Always, at session start |
| Curated core | `MEMORY.md`, `USER.md` | Dreaming consolidation; direct user request | At session start, budgeted |
| Episodic | `memory/YYYY-MM-DD.md` daily notes, session transcripts | Agent during work | Never; searchable on demand |
| Prospective | Standing intents (SQLite), cron jobs | `intent` tool | Only when trigger fires |
| Review | `DREAMS.md`, dreaming reports | Dreaming phases | Never; human reading |

`USER.md` uses supersede-in-place directives (a changed preference supersedes the old one rather than appending a contradiction). `MEMORY.md` over budget → file stays intact on disk, injected copy is truncated, with `/context` commands exposing raw vs. injected sizes. The workspace (`~/.openclaw/workspace`) is deliberately separate from `~/.openclaw/` (config, credentials, sessions).

## Hermes Agent (`NousResearch/hermes-agent`, Python)

Sources: `website/docs/user-guide/features/memory.md`, `website/docs/user-guide/sessions.md`, `website/docs/user-guide/which-file-does-what.md`.

### One SQLite database for everything conversational

- `~/.hermes/state.db` — session metadata **with FTS5 full-text search**, plus full message history, model configuration, system-prompt snapshots.
- Housekeeping command `hermes sessions optimize` merges FTS5 index segments and `VACUUM`s without touching session data; `hermes sessions prune` is the destructive option.
- Rich export surface: `hermes sessions export` to `jsonl` (default, machine round-trip), `md`/`qmd` (readable archives), `html`, `trace` (Claude Code JSONL), with bulk filters and `--redact` for secrets.
- Small file-based adjuncts: per-terminal breadcrumb files under `~/.hermes/terminal-sessions/` for `-c` resume.

### Memory = two bounded Markdown files

- `~/.hermes/memories/MEMORY.md` (2,200 chars) — agent's notes; `USER.md` (1,375 chars) — user profile.
- **Hard char limits; error-on-overflow.** A write that would exceed the limit fails, and the agent must consolidate/remove entries in the same turn before retrying. No silent truncation, no auto-compaction.
- Agent curates via a `memory` tool (`add`/`replace`/`remove`; `replace`/`remove` use unique-substring matching; there is no `read` — memory is auto-injected).
- **Frozen-snapshot injection:** memory is captured once at session start and never refreshed mid-session, preserving the LLM prefix cache. Writes hit disk immediately, tool responses show live state, and the new snapshot appears next session. Documented tradeoff.
- Explicit warning against two agent processes sharing one home (compounding memory writes); memory is scoped per profile, shared memory goes through external memory providers.
- `which-file-does-what.md` resolves the classic confusion: SOUL.md = who the agent *is* (human-edited, always injected), USER.md = who *you* are (agent-maintained), MEMORY.md = what the agent *learned* (agent-maintained), AGENTS.md = what the *project* needs (project directory).

## Side by side

| Aspect | OpenClaw | Hermes | Bazilion today |
|---|---|---|---|
| Conversational/session state | Per-agent SQLite | Single SQLite + FTS5 | SQLite (canonical) |
| Control-plane state | Shared SQLite | — (single-agent product) | SQLite |
| Memory/persona files | Workspace Markdown, tiered, budgeted | Two files, hard char limits | Workspace templates (SOUL/IDENTITY/USER/AGENTS/TOOLS.md) + `user_md` column |
| Search over history | `memory_search` index + SQLite | FTS5 + `sessions optimize` | — |
| Heavy payloads | Cold `jsonl.zst` archives outside DB | Export-time, not runtime | Snapshots/logs in tables |
| Schema contract | Versioned, forward-only, refuse-newer, doctor receipts, CI check, preflight | Not documented publicly | **Clean-install alpha contract; wipes on change** |
| Backup | Per-database snapshots, pre-upgrade verified backup | Export/prune commands | BAZ-024 online snapshot, BAZ-030 encrypted |
| Ownership doctrine | "No hidden state"; write path is security boundary | "Which file does what" one-pager | Implicit; no written invariant |

## Takeaways for Bazilion

**Validated:** the SQLite + text mix is the converged industry answer for this product class. Do not switch engines for 1.0.

**For the beta (→ BAZ-047):** adopt an OpenClaw-style schema contract — forward-only migrations from a frozen baseline, schema version recorded in the DB, refuse-database-newer-than-binary, verified backup taken before upgrade, a tested N-1 → N upgrade path, and a release gate that proves it. This is the single biggest alpha→beta blocker; OpenClaw's doctor-receipt pattern is the reference implementation shape.

**Post-1.0 candidates (→ BAZ-048):**

1. **Ownership invariant / file-to-DB map** — an ADR listing every artifact (SOUL/IDENTITY/USER/AGENTS/TOOLS.md, `user_md` column, receipts, snapshots) and its canonical owner, with reconcile-on-boot. Borrow Hermes' "which file does what" one-pager as operator documentation. *(Cheap; arguably should join BAZ-047.)*
2. **FTS over conversations** — Hermes' FTS5 + `sessions optimize`/VACUUM pattern for the conversation library (BAZ-035).
3. **Cold archives outside the DB** — OpenClaw's `jsonl.zst` pattern for `coding_command_logs` and `source_snapshots` if they dominate DB size.
4. **Per-agent data-plane split** — OpenClaw's two-database model, only if/when multi-agent DB contention or size becomes real.
5. **Bounded-memory injection** — Hermes' char-limit + error-on-overflow guardrail for prompt budget discipline, and OpenClaw's budgeted/truncated injection with visible raw-vs-injected diagnostics.
6. **Pre-upgrade preflight** — `database preflight`-style check so an updater refuses a schema crossing before it happens, not after.
