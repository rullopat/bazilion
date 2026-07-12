---
id: BAZ-003
title: Hermes-style self-learning loop — background reviewer + skill self-editing
status: draft
size: L (1–2 weeks for MVP; v2 features broken out below)
created: 2026-05-23
note: Pattern is borrowed from Nous Research's hermes-agent (MIT, github.com/NousResearch/hermes-agent). MVP intentionally clones the *minimum* surface that demonstrates the loop and reuses every existing Bazilion primitive (worker subprocess, scheduler, qmd memory, home_write, session JSONL). Curator + FTS5 session search + dialectic user modeling are explicitly v2.
---

# BAZ-003 — Hermes-style self-learning loop — background reviewer + skill self-editing

**Status:** Backlog (draft). Bazilion agents today are amnesiac across the learning axis — they write to per-team qmd memory and per-agent `IDENTITY.md` while answering the user, but nothing wakes them up to review their own past turns and update either store with lessons. Nous Research shipped `hermes-agent` in Feb 2026 ([github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), MIT, model-agnostic) around a single load-bearing idea — **"a closed learning loop"**: after each turn the agent is briefly forked into a "reviewer" copy of itself that reads the transcript and edits its own markdown memory and skill files via the same tool API the main agent uses. Same model, different prompt, write access to procedural memory. No fine-tuning, no embeddings, no separate critic model — just structured prompt-and-skill-library editing as a first-class tool call. Bazilion already has every primitive needed (worker subprocess, `agent_triggers` scheduler at [apps/daemon/src/lib/scheduler.ts](../../../apps/daemon/src/lib/scheduler.ts), qmd memory at `teams/<slug>/memory/`, `home_write` tool, pi session JSONL, `MessagingHost` IPC). This BAZ wires those primitives into the same loop, scoped tightly so v1 ships in a week.

**Dependency:** None. Sits on top of the existing scheduler + tools + session-transcript layer.

## What hermes-agent actually does (research-backed, not paraphrase)

The loop has three coupled subsystems in their codebase ([agent/background_review.py](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py), [agent/conversation_loop.py](https://github.com/NousResearch/hermes-agent/blob/main/agent/conversation_loop.py), [agent/curator.py](https://github.com/NousResearch/hermes-agent/blob/main/agent/curator.py)):

1. **Background reviewer.** After every assistant turn, two trigger counters are checked (`_turns_since_memory`, `_iters_since_skill`). If either crosses its nudge interval, the user-facing response is delivered first, *then* a daemon thread forks an `AIAgent` with inherited credentials + same system prompt (for prefix-cache hits) and runs a short tool-calling loop against one of three prompts (`_MEMORY_REVIEW_PROMPT`, `_SKILL_REVIEW_PROMPT`, `_COMBINED_REVIEW_PROMPT`). Writes are tagged `_memory_write_origin = "background_review"`. Approval prompts auto-deny in the fork to avoid deadlocks.
2. **`skill_manage` tool.** Exposed to both the live agent and the reviewer fork. Actions: `create | edit | patch | delete | write_file | remove_file` against `~/.hermes/skills/<name>/SKILL.md` + sidecar files (`references/`, `templates/`, `scripts/`, `assets/`). Skills written this turn are loaded as procedural knowledge in the next turn's system prompt — Voyager-style skill library, prompt-only.
3. **Curator.** Long-horizon GC + consolidation pass, fired by inactivity (default 168h since last run AND 2h of agent idle). Reads `~/.hermes/skills/.usage.json` telemetry (`use_count`, `view_count`, `last_used_at`, `patch_count`, `state: active|stale|archived`, `pinned`) and consolidates / archives via its own LLM pass.

**Storage is all filesystem.** No vector store, no embeddings, no LoRA. `~/.hermes/memories/MEMORY.md` + `USER.md` (markdown, `§`-delimited entries), `~/.hermes/skills/<name>/SKILL.md` (+ sidecars), a SQLite FTS5 session index for cross-session search, and Honcho ([github.com/plastic-labs/honcho](https://github.com/plastic-labs/honcho)) plugged in as a "dialectic user modeling" sidecar.

The reflection prompt is the load-bearing artifact and worth quoting near-verbatim (from `agent/background_review.py:45`):

> "Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome. […] Signals to look for (any one of these warrants action): user corrected your style, tone, format, legibility, or verbosity; non-trivial technique, fix, workaround, debugging path; a skill that got loaded or consulted this session turned out to be wrong, missing a step, or outdated. Patch it NOW."

And the **anti-pattern blocklist** (same file) is what makes the loop survivable in practice — without it, agents harden transient errors into lasting refusals:

> "Don't capture environment-dependent failures, negative tool claims ('X is broken'), transient errors that resolved, or one-off task narratives — these harden into refusals the agent cites against itself for months."

**Known weakness, surfaced by independent reviewers** ([autogpt.net comparison](https://autogpt.net/hermes-agent-vs-openclaw/)): the self-grading is over-optimistic — "Hermes evaluates its own work to decide whether a task succeeded, but it almost always thinks it did well, even when it didn't." This is critical for our MVP scope decision below.

## User stories

- **As an operator running a long-lived agent across many sessions**, I want the agent to wake itself up periodically and distill its own mistakes and successful patterns into durable lessons in its `IDENTITY.md` and in the team's shared memory, so repeated work surfaces less repeated failure and the agent visibly gets better at recurring tasks instead of forgetting everything between sessions.
- **As an operator who has corrected the same stylistic mistake three times this week** ("no, use single quotes", "no, no trailing semicolons", "stop adding emojis"), I want the agent to notice the pattern and write the rule into its own identity file without me running `bazilion agent edit <id> IDENTITY.md` manually each time.
- **As an operator skeptical of "the agent thinks it's doing great when it isn't"**, I want a human-in-the-loop review surface that shows me every lesson the reviewer produced, so I can promote, edit, or trash each one before it ossifies — instead of finding out three weeks later that the agent built a long list of misleading "lessons" that it now cites against itself.
- **As an operator who's seen this play out in hermes-agent and wants the *good* parts without the failure mode**, I want the v1 to ship the background-reviewer loop *with* the anti-pattern blocklist baked into the prompt and *with* the human-approval gate enabled by default, with the auto-promote behavior available behind a flag only.

## Goal

Ship an MVP of the Hermes loop scoped to **one job**: after every N turns of conversation, fork the agent into a reviewer that reads the recent transcript, identifies high-signal lessons (style corrections, repeated tool errors, repeated user corrections), and proposes 0–5 lesson edits in a strict format. The lessons land in a **pending review queue** that the operator approves/edits/rejects from CLI + web UI. Approved lessons get written to `IDENTITY.md` (private) or to team qmd memory (shared) via the existing tool surface.

**MVP explicitly does NOT include** runtime skill authoring (the `skill_manage` equivalent), curator-style long-horizon GC, FTS5 cross-session search, or Honcho user modeling. Each of those is a separate follow-on BAZ — see "Out of scope" below.

**Strict bound on cost:** the reviewer fork uses the same provider config as the main agent today; the operator can override to a cheaper model per-agent (matching hermes-agent's `auxiliary.curator` slot pattern). Reviewer turns are capped at a small tool-iteration budget (default: 4) so a runaway critique can't burn the operator's budget.

## Why now

Three reasons converging:

1. **The primitives just landed.** `agent_triggers` + scheduler ([apps/daemon/src/lib/scheduler.ts](../../../apps/daemon/src/lib/scheduler.ts)) shipped recently; per-team qmd memory shipped; the worker subprocess can be re-invoked with synthetic input (`runAgentTurn` is parameterized). The cost of adding the loop today is wiring, not new infrastructure.
2. **OpenClaw lineage matters for positioning.** Bazilion documents the [OpenClaw skill model](../../openclaw-reference.md) as its skill spec; hermes-agent's own README calls itself "the only agent with a built-in learning loop" and includes a `hermes claw migrate` command importing `~/.openclaw/` state. Bazilion already speaks the same skill standard ([agentskills.io](https://agentskills.io)) — there's a credible "we have the OpenClaw model AND a learning loop too" story that lands flat without this feature.
3. **Known failure mode is documented.** Independent reviewers have already surfaced where hermes-agent's self-grading goes wrong (over-optimistic, hardens transient errors into refusals). Building it after that's in the wild means we can ship the v1 with the human-approval gate enabled by default — we don't have to discover the failure mode ourselves.

## Scope (MVP)

### Trigger plumbing

Two new trigger paths, both fired by the existing scheduler — no new ticker:

- **Per-turn counter** (new): `agents.turns_since_review INTEGER NOT NULL DEFAULT 0`, incremented at the end of each `runAgentTurn` ([apps/daemon/src/lib/agent-turn.ts](../../../apps/daemon/src/lib/agent-turn.ts)). When the counter reaches `agent.review_every_n_turns` (per-agent config, default 8), the daemon enqueues a review pass via `runAgentTurn` with a synthetic system message (the review prompt) instead of a user message. The counter resets on enqueue.
- **Idle-cron fallback** (also new): a new `kind = 'review'` row in `agent_triggers` lets the operator force a periodic review (e.g. nightly at 3am regardless of turn count). Reuses the existing scheduler entirely; no new code path beyond a `kind` value.

**Why both:** per-turn fires while the conversation is hot (cheap signal capture); the cron fallback covers idle agents (long-lived heartbeat agents that only act on schedule).

### The reviewer pass

A new function in [apps/daemon/src/lib/agent-turn.ts](../../../apps/daemon/src/lib/agent-turn.ts): `runAgentReview(agentId, options)`. Behavior:

1. Read the last `N` turns from the agent's pi session JSONL files (`~/.bazilion/agents/<id>/sessions/`). N is `min(turns_since_review, 32)` — bound the context cost.
2. Build a worker input with `{ agent, message: REVIEW_SYSTEM_MESSAGE + transcript, enabledProviders, apiKey?, mode: 'review' }`.
3. Worker enters a review-specific code path that:
   - Loads the review prompt template (see below) into the system position.
   - Restricts tool surface to a narrow set: `propose_lesson(scope: 'private'|'shared', text: string)` only. No `home_write` / `memory_write` from inside the fork — proposals are emitted as tool calls and dropped into the pending queue, NOT written directly. **This is the human-approval gate.**
   - Caps tool iterations at 4 (default; per-agent override).
4. Each `propose_lesson` call inserts a row into a new table `agent_lesson_proposals`.
5. On completion, emits a `SessionEvent` of new kind `review_summary` with the proposed-lesson count, which gets persisted to a small `agent_reviews` audit table (id, agent_id, started_at, ended_at, turns_reviewed, proposals_count, status).

### The review prompt

A new file `apps/daemon/src/runtime/session/prompts/review.md` — borrowed conceptually from hermes-agent's `_MEMORY_REVIEW_PROMPT` + `_SKILL_REVIEW_PROMPT` but trimmed to Bazilion's shape. Bakes in the anti-pattern blocklist verbatim (quoted in the research section above) — that's the load-bearing safety rail. Encodes the private-vs-shared classifier:

> "Private (→ your own IDENTITY.md): persona, voice, tone, format preferences, your own preferred working style, anything that reflects who *you* are. Shared (→ team memory): domain facts about the project, procedures that any teammate could reuse, gotchas about the codebase or tools."

### Data model

```sql
-- Migration apps/daemon/src/core/db/migrations/0003_self_learning.sql
ALTER TABLE agents ADD COLUMN turns_since_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN review_every_n_turns INTEGER NOT NULL DEFAULT 8;
ALTER TABLE agents ADD COLUMN review_enabled INTEGER NOT NULL DEFAULT 1; -- 0|1

CREATE TABLE agent_reviews (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  turns_reviewed  INTEGER NOT NULL,
  proposals_count INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('running','completed','errored','cancelled'))
);

CREATE TABLE agent_lesson_proposals (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES agent_reviews(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL CHECK (scope IN ('private','shared')),
  text        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','edited')),
  applied_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_proposals_agent_status ON agent_lesson_proposals(agent_id, status);
```

### Routes

- `GET /api/agents/:id/lesson-proposals?status=pending` — list pending proposals.
- `POST /api/agents/:id/lesson-proposals/:proposal_id/approve` — flips status; on private scope, appends a line to a `## Lessons` section in `agents/<id>/IDENTITY.md` (creating the section if absent) via the same file-write path as `home_write`; on shared scope, writes to the team qmd store via `memory_write` tagged `lesson:`.
- `POST /api/agents/:id/lesson-proposals/:proposal_id/reject` — sets status to rejected, leaves the row for audit.
- `PATCH /api/agents/:id/lesson-proposals/:proposal_id` — body `{ text, scope? }` — operator edits before approve.
- `POST /api/agents/:id/review` — manual one-shot trigger (operator forces a review pass now).
- `GET /api/agents/:id/reviews` — audit list.

### CLI

- `bazilion agent review <id>` — fire a one-shot review pass; streams the resulting proposals to stdout.
- `bazilion agent lessons <id> [--pending|--approved]` — list proposals.
- `bazilion agent lesson approve <proposal-id> [--scope private|shared] [--edit]` — approve, optionally edit first via `$EDITOR`.
- `bazilion agent lesson reject <proposal-id>`.
- `bazilion agent review-config <id> --every <n> --enabled <true|false>` — per-agent config.

### Web

- New tab `/agents/:id/lessons` on the agent detail page: two cards.
  - **Pending proposals** — list of pending lessons with inline-edit textarea, scope picker (private/shared), approve/reject buttons. Empty state: "No pending lessons. Reviews fire every N turns or on manual trigger."
  - **History** — list of past reviews with proposal counts, expandable to see approved/rejected lessons per pass.
- "Force review now" button on the agent detail page.
- Per-agent config card: `review_every_n_turns`, `review_enabled` toggle.

## Out of scope (deferred to follow-on BAZs)

Each of these is a credible v2 — but landing the MVP without them is the whole point.

- **Runtime skill authoring (Voyager-style `skill_manage` tool).** Letting agents draft new `SKILL.md` files at runtime is hermes-agent's signature feature ([tools/skill_manager_tool.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/skill_manager_tool.py)) but it dramatically expands the failure surface — a hallucinated skill loaded into every subsequent agent's system prompt is the worst kind of bug. **v2 BAZ:** "Self-authored skills with promotion gate". Reuses the same proposal queue model — agent proposes a skill, operator promotes from review surface to `~/.bazilion/skills/<name>/`.
- **Curator / long-horizon GC.** Hermes's `~/.hermes/skills/.usage.json` + `curator.py` 7-day consolidation pass is the right answer eventually, but only after we have enough lessons + skills to need GC. **v2 BAZ:** "Lesson and skill curator". Adds the usage telemetry sidecar + the 7-day consolidation trigger.
- **FTS5 cross-session search.** Hermes uses SQLite FTS5 over session transcripts for cross-session recall ([tools/session_search_tool.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/session_search_tool.py)). Bazilion's existing qmd memory is BM25 over the *memory* store, not the session JSONLs. **v3 BAZ:** "Session search tool over pi JSONL transcripts".
- **Dialectic user modeling (Honcho).** Bazilion has per-team USER.md but no auto-update loop. **v3 BAZ:** "Auto-updating USER.md from cross-session observations".
- **Auto-approval mode** (skipping the human gate). Should exist as a per-agent flag eventually for trusted agents on stable tasks. Deliberately *not* the default for MVP — the known failure mode (over-optimistic self-grading) is enough reason to start with the gate on and unlock auto-approval later only for agents that have demonstrated a high accept rate over time.
- **Reviewer-specific cheaper model.** Hermes pins the curator to an `auxiliary.curator` slot (e.g. `google/gemini-3-flash-preview`). Bazilion's review pass uses the agent's own provider config in MVP. **Small follow-up:** add `agents.review_model_override TEXT` later if cost matters.
- **Background-thread forking inside the worker.** Hermes literally forks a daemon thread inside the live process. Bazilion's worker subprocess model means each review pass is a separate subprocess via `runAgentTurn`. Slightly more expensive (worker spin-up) but architecturally cleaner — *don't* try to clone hermes's thread-fork pattern, the IPC + worker boundary is the right place to draw the line.
- **Migration command from hermes-agent or openclaw state.** No `bazilion claw migrate` — interesting but not load-bearing.

## Open questions

1. **Does the reviewer write *anything* directly, or always through the proposal queue?** Hermes writes directly (with audit tagging). Bazilion's MVP is queue-only because we want the gate. But there's a real argument for "highly conservative direct writes for proposals that score 9/10 on a confidence rubric, queue for everything else". **Lean: queue-only for MVP, revisit after seeing accept rate.**
2. **Scope classifier source of truth.** Does the agent classify private-vs-shared in the proposal itself, or does the human always reclassify at approve time? **Lean: agent proposes, human can flip in the review UI. Track agreement rate as a signal of whether the prompt is calibrated.**
3. **Where does the `## Lessons` section live in `IDENTITY.md`?** Appended? At a marker like `<!-- bazilion-lessons -->`? **Lean: a marker comment, since `home_write` lets the agent rewrite the whole file and we don't want a runaway rewrite to nuke the lessons section.**
4. **Cost ceiling.** A review pass on a long agent could read 32 turns × 4K tokens = 128K input tokens. At Opus pricing that's not nothing. Should we hard-cap input tokens (truncate transcript) or input turns (already do, at 32)? **Lean: cap turns at 32 AND total input at ~80K tokens (rough). Surface the cost-per-review in the audit table for operators to monitor.**
5. **Should approved-private lessons also appear in the team memory?** Sometimes "I learned that *I* prefer X" is also useful for teammates. **Lean: no — keep the private/shared boundary clean. Operator can manually re-classify by editing and re-approving as shared if they think a private lesson generalizes.**
6. **Per-turn trigger or per-task-completion trigger?** Hermes uses per-turn counters. Bazilion could plausibly fire only when the agent emits a `final_response`-equivalent event. **Lean: per-turn counter (simpler, matches Hermes); revisit if reviews fire mid-multi-turn-task too often.**

## Deliverable

A working end-to-end self-learning loop with the human-approval gate:

- Operator chats with an agent for ~8 turns; at turn 8 a background review fires automatically (visible as a row in `agent_reviews`).
- 0–5 lesson proposals land in `agent_lesson_proposals` with `status='pending'`.
- Operator visits `/agents/:id/lessons`, sees the proposals, edits one, approves two, rejects one.
- Approved private lessons appear as new lines in `agents/<id>/IDENTITY.md` under a `## Lessons` section, visible in the agent's next-turn system prompt.
- Approved shared lessons appear in the team's qmd memory tagged `lesson:`, searchable via `memory_search`.
- Operator can disable reviews per-agent (`review_enabled = 0`) and adjust cadence (`review_every_n_turns`).

## Tests

- **Unit: trigger counter** — `runAgentTurn` correctly increments `turns_since_review` on success, leaves it untouched on cancel/error.
- **Unit: review enqueue** — when the counter hits the threshold, a review pass is enqueued and the counter resets; with `review_enabled=0`, no enqueue happens.
- **Integration: review pass produces proposals** — fixture transcript with planted "stop using semicolons" user correction → run reviewer → assert ≥1 pending proposal with scope `private`. Uses a mocked provider that returns a canned `propose_lesson` tool call so the test is deterministic.
- **Integration: anti-pattern blocklist** — fixture transcript with a *transient* tool error (network timeout that resolved on retry) → run reviewer → assert 0 proposals about "network is broken". This is the load-bearing safety test; the prompt either holds the line or it doesn't.
- **Integration: approval writes to IDENTITY.md** — approve a private proposal → assert `agents/<id>/IDENTITY.md` contains the line under the `## Lessons` marker, and that the section is created if previously absent.
- **Integration: approval writes to team memory** — approve a shared proposal → assert a qmd entry tagged `lesson:` exists; `memory_search` returns it.
- **Integration: edit-then-approve** — PATCH a proposal's text, then approve → asserted-on-disk content matches the edited text, not the original.
- **Route tests** — full CRUD on proposals (list/approve/reject/edit), manual `/review` trigger.
- **CLI smoke** — `bazilion agent review <id>` → `bazilion agent lessons <id> --pending` shows what was just produced.
- **Cancellation** — cancelling an agent mid-review aborts the review worker; the `agent_reviews` row lands in `status='cancelled'`. Reuses the existing per-agent cancel registry ([apps/daemon/src/lib/agent-cancel.ts](../../../apps/daemon/src/lib/agent-cancel.ts)).
- **Cost ceiling** — synthetic transcript exceeding the input-token cap → reviewer truncates rather than blowing past the limit; audit row records the truncation.
- **Failure mode regression (mandatory before promoting v1 from draft → todo):** run the reviewer over a 50-turn real-world transcript and have a human review the proposal quality. Target: ≥60% of proposals are kept (approved as-is or with edits); <20% are rejected as anti-pattern; <20% are rejected as too-vague-to-be-useful. If those numbers don't hold, the prompt isn't ready and the MVP shouldn't ship without a tighter prompt or a stronger gate.

---

## Research provenance (for future readers)

This BAZ was drafted from three parallel research streams over the hermes-agent repo:

1. **Repo overview + README** — confirmed elevator pitch ("the only agent with a built-in learning loop"), four-signal model (memory nudges, autonomous skill creation, skills self-improve, FTS5 session search), MIT license, model-agnostic, active dev (last push 2026-05-23). Lineage: explicit OpenClaw successor with `hermes claw migrate` import path.
2. **Code-level architecture** — confirmed the three-subsystem decomposition (background reviewer, `skill_manage` tool, curator), the daemon-thread fork pattern with credential inheritance, the trigger counter shape (`_turns_since_memory` / `_iters_since_skill`), the auto-deny on approval prompts inside the fork, the storage medium (markdown + SQLite FTS5 + Honcho), the verbatim reflection prompt and anti-pattern blocklist quoted above, the Voyager-style `skill_manage` actions, and the single-agent-with-introspection-forks architecture (plus `delegate_tool` as a separate parallel-subagent primitive that is NOT part of the learning loop).
3. **Ecosystem context** — confirmed no formal paper, disambiguated Hermes 4 LLM family vs hermes-agent teamPolicy, surfaced the over-optimistic self-grading failure mode from independent reviews (autogpt.net), confirmed OpenClaw is the most-frequently-compared system.

Key sources:

- [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — MIT, primary.
- [agent/background_review.py](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py) — the reflection orchestrator + three review prompts (load-bearing for the prompt we'll write).
- [agent/conversation_loop.py](https://github.com/NousResearch/hermes-agent/blob/main/agent/conversation_loop.py) — trigger logic (`_should_review_memory` / `_should_review_skills`, lines ~433 / ~4139, spawn at ~4156).
- [agent/curator.py](https://github.com/NousResearch/hermes-agent/blob/main/agent/curator.py) — long-horizon GC (deferred to v2 BAZ).
- [website/docs/user-guide/features/curator.md](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/curator.md) — plain-English walkthrough.
- [autogpt.net/hermes-agent-vs-openclaw](https://autogpt.net/hermes-agent-vs-openclaw/) — independent commentary surfacing the self-grading weakness.
- [hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/) — official documentation.
