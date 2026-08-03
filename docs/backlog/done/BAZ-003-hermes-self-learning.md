---
id: BAZ-003
title: Reviewed learning loop — transcript digest to durable lessons
status: done
size: M
created: 2026-05-23
refined: 2026-08-03
shipped: 2026-08-03
priority: high
note: Shipped implementation and real-provider calibration completed 2026-08-03. Opt-in, proposal-only, reversible MVP.
---

# BAZ-003 — Reviewed learning loop — transcript digest to durable lessons

## User stories

- **As an operator of a long-lived Agent**, I want it to periodically extract reusable lessons
  from completed conversations so repeated corrections and successful techniques survive future
  sessions.
- **As an operator paying for model calls**, I want learning to be opt-in, bounded, observable,
  and independently configurable so it cannot silently double the cost of every turn.
- **As an operator reviewing learned behavior**, I want to edit, approve, reject, and later revoke
  learned material so an outdated or harmful lesson never becomes permanent merely because I once
  accepted it.

## Goal

Ship one closed, human-reviewed learning loop:

```text
successful user turn -> durable review request -> restricted reviewer worker
                     -> 0..5 proposals -> operator decision -> applied lesson
```

The reviewer digests recent transcript content and proposes concise lessons. It cannot write files,
memory, skills, messages, or USER.md. Approved private lessons are injected into that Agent's future
system prompts; approved shared lessons are written to Team memory. Every transition is durable and
inspectable through HTTP, CLI, and web.

## Current research snapshot (2026-08-03)

Research was refreshed against Hermes Agent v0.20.0 (`v2026.8.3`) and current `main` commit
`a991dfc25daf68994c21d6adcdfbafb1b3dc23cf`, not the May draft.

Verified current behavior:

- The reviewer still forks after a successful foreground response and directly operates
  memory/skill tools. It is best-effort and process-thread based, not a durable job.
- Main-model review replays the full warm-cache conversation. Operators can route
  `auxiliary.background_review` to another provider/model; only that cold-cache path digests older
  history and keeps the newest 24 messages verbatim.
- Hermes now carries runtime/auth/reasoning/prompt-cache context into the fork, isolates it from the
  canonical session, restricts dispatch to memory/skill tools, and prevents autonomous writes to
  bundled, hub, pinned, or user-owned skills. Background skill edits require read-before-write.
- `memory.write_approval` and `skills.write_approval` can stage reviewer writes durably for human
  approval. `/journey` exposes learned memory/skills and supports later edit/delete.
- Recent fixes explicitly reject transient errors and unresolved failed attempts as reusable skills.
- One classification defect remains open: the combined reviewer can blur user preferences, factual
  memory, and procedural skills. Its current skill prompt still pressures the model to save
  something, biasing toward false positives.
- Earlier cadence loss in gateway sessions, unrestricted reviewer side effects, missing runtime
  inheritance, and protected-skill mutation reports are closed, but their fixes show which boundaries
  must be architectural rather than prompt-only.

Implication for Bazilion: take the auxiliary-model option, bounded digest, visible history, durable
approval, and reversibility. Do not copy direct writes, a best-effort thread, broad tool access, or
save-something pressure.

Primary references:

- [Hermes Agent repository](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent v0.20.0 release](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3)
- [Current background-review implementation](https://github.com/NousResearch/hermes-agent/blob/a991dfc25daf68994c21d6adcdfbafb1b3dc23cf/agent/background_review.py)
- [Hermes memory documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md)
- [Hermes skill-mutation provenance issue](https://github.com/NousResearch/hermes-agent/issues/20273)
- [Hermes reviewer classification issue](https://github.com/NousResearch/hermes-agent/issues/30220)
- [Hermes unresolved-failure hardening](https://github.com/NousResearch/hermes-agent/commit/2ace68ad378ed0375f9f10e39bcfad7bff628b5f)

## Product decisions resolved by refinement

- **Opt-in:** learning is disabled on new Agents. Enabling it is an explicit operator action.
- **Cadence:** review every 8 successful user-facing turns by default. Manual review is also
  available. Scheduled/cron review is not part of this story.
- **No recursive review:** review turns never increment cadence and never enqueue another review.
- **No direct mutation:** the reviewer only calls `propose_lesson`; it receives no ordinary Agent
  tools and cannot apply its own output.
- **Two scopes:** `private` is Agent-specific behavior or working style; `shared` is reusable Team
  project knowledge. The operator can change scope before approval.
- **One fact, one owner:** stable facts/preferences about the human belong in Team `USER.md`, not in
  either lesson scope. The reviewer returns no proposal for those in this MVP and the Learning UI
  points the operator to USER.md. Automatic USER.md proposals are a separate story.
- **Private source of truth:** approved private lessons remain canonical DB records and are rendered
  into the Agent system prompt. They do not rewrite `IDENTITY.md`, avoiding concurrent whole-file
  overwrite and marker ownership problems.
- **Shared application:** approving a shared lesson writes a deterministic qmd note under
  `lessons/<proposal-id>.md`; the proposal row records the applied key.
- **Model:** an optional review-model override uses the existing `provider:model` format. With no
  override, review uses the Agent's model. The UI must show this cost implication before enablement.
- **Reasoning:** review reasoning defaults to `low` and is independently configurable using the
  existing reasoning-level vocabulary; it never silently inherits an expensive Agent setting.
- **No auto-approval:** approval is always human in this MVP.
- **Nothing is valid:** zero proposals is an expected successful review, not degraded behavior.
- **Reversible:** approved lessons can be revoked later from the same CLI/web history.

## Scope

### Canonical schema

Edit `apps/daemon/src/core/db/migrations/0001_init.sql`; do not add an ALTER migration.

Add review configuration to `agents`:

- `review_enabled INTEGER NOT NULL DEFAULT 0 CHECK (review_enabled IN (0, 1))`
- `review_every_n_turns INTEGER NOT NULL DEFAULT 8 CHECK (review_every_n_turns BETWEEN 1 AND 100)`
- `review_model TEXT` — nullable `provider:model` override
- `review_reasoning_level TEXT NOT NULL DEFAULT 'low'`
- `review_turns_since_last INTEGER NOT NULL DEFAULT 0`

Add `agent_reviews`:

- identity: `id`, `agent_id`
- durable lifecycle: `status` = `pending | running | completed | failed | cancelled`
- source cursor: session id plus the bounded transcript-entry range selected at enqueue time
- accounting: trigger (`cadence | manual`), input characters, turns reviewed, proposal count
- diagnostics: timestamps and a bounded error string; never duplicate the transcript
- only one open (`pending | running`) review per Agent

Add `agent_lesson_proposals`:

- identity: `id`, `review_id`, `agent_id`
- content: `scope`, `text`
- lifecycle: `pending | approved | rejected | revoked`
- decision metadata: timestamps and final edited text/scope
- application receipt: private prompt record or shared qmd key

The existing alpha backup allowlist/hash and reset fixtures must cover both tables and indexes.

### Enqueue and execution

After a successful, non-review `runAgentTurn`:

1. Increment `review_turns_since_last` only for a completed user-facing turn. Cancellation, provider
   failure, scheduled triggers, inbox wakes, and review turns do not count.
2. If enabled and cadence is reached, atomically create one pending review and reset the counter.
   If an open review already exists, do not create another and do not lose accumulated turns.
3. A daemon-owned review dispatcher claims pending rows with a lease. Reuse the scheduler's
   lifecycle pattern, but do not add a new `agent_triggers.kind` or pretend the review is a chat
   trigger.
4. Agent lifecycle locking prevents a review and normal turn from using the same Agent concurrently.
   Expired running leases are recoverable after restart. A recovered attempt may repeat provider
   cost, but proposals are persisted together only after valid output, so it cannot partially apply
   or duplicate lessons. Bound retries at 3 before terminal failure.

Manual review uses the same durable enqueue path. It returns `202` with the review record; it does
not hold an HTTP stream open while the model runs.

### Transcript digest and cost bounds

- Read only completed user/assistant/tool-summary entries from pi's canonical session JSONL.
- Select entries newer than the preceding completed review cursor, newest first, capped at 8
  user-facing turns and 40,000 Unicode characters after redaction.
- Exclude attachment bodies, image data, secret-bearing tool arguments/results, system prompts,
  compacted raw history, and prior review activity.
- Store the cursor and counts, not a second transcript copy.
- Reviewer output is limited to 5 proposals, each 1–500 characters.
- Every proposal must cite at least one selected evidence entry. A citation proves where the candidate
  came from, not that it is correct; human approval remains required.
- One reviewer call; no open-ended tool loop. If the provider cannot produce valid proposals after
  one schema-repair attempt, mark the review failed.
- Use the existing provider credential and OAuth-refresh resolution paths. Never persist credentials
  or provider payloads in review tables.

### Restricted reviewer worker

Add an explicit worker mode rather than invoking `runAgentTurn` with a synthetic user message:

- `mode: 'chat' | 'review'` on the daemon-to-worker input.
- Review mode builds a review-specific system prompt and exposes only a daemon-owned
  `propose_lesson({scope, text, evidenceEntryIds})` tool.
- Evidence identifiers use the canonical session id plus entry ordinal and are stored with the
  proposal for operator inspection; quoted transcript content is not copied into the proposal row.
- No workspace, shell, browser, MCP, messaging, memory, home, USER.md, skill, delivery, or approval
  tools exist in review mode.
- Review output is not appended to the Agent's user-visible chat session and is not mirrored to
  Telegram.
- Cancellation uses the existing Agent-keyed cancellation registry and leaves a terminal review
  status.

### Review classifier and prompt contract

The prompt classifies candidates before proposing them:

1. **Stable human preference or biographical fact** -> USER.md owner -> do not propose in this story.
2. **Agent-specific behavior/strategy** -> `private` candidate.
3. **Reusable Team project fact, decision, or verified procedure** -> `shared` candidate.
4. **Anything else** -> nothing to learn.

One observation may produce at most one proposal. The prompt explicitly welcomes an empty result and
must reject:

- transient/environment-dependent failures and unresolved attempts;
- guesses, unverified workarounds, and claims contradicted later in the same digest;
- one-off task narratives, status updates, and facts easily rediscovered from source;
- secrets, credentials, personal sensitive data, raw logs, or large copied text;
- duplicates or semantic near-duplicates of already approved lessons supplied to the reviewer.

The reviewer receives the current approved-private lesson set and a compact index of Team-memory
lesson keys for deduplication, still within the total input bound.

### Applying lessons

- Editing a pending proposal updates its text/scope using optimistic concurrency.
- Approval is transactional and idempotent. A decided proposal cannot be edited or decided again.
- Private approval leaves the approved row as the canonical lesson. Prompt construction injects all
  approved private lessons in a bounded `# Reviewed lessons` section, newest first, with a total
  8,000-character ceiling.
- Shared approval writes `lessons/<proposal-id>.md` through the Team qmd backend, then records the
  exact key. Retry after a partial failure detects the deterministic key and converges without a
  duplicate note.
- Reject preserves the proposal and evidence identifiers for audit but never changes prompts or
  memory.
- Revoking an approved private lesson atomically removes it from future prompt projection. Revoking
  an approved shared lesson removes its deterministic qmd note and records the receipt; retry after
  partial failure converges. Revocation preserves the audit row and original decision.
- Deleting an Agent cascades its reviews/proposals; shared qmd notes already applied to a Team remain
  Team-owned.

### HTTP and wire types

- `GET|PATCH /api/agents/:id/review-config`
- `POST /api/agents/:id/reviews` — durable manual enqueue, returns `202`
- `GET /api/agents/:id/reviews`
- `GET /api/agents/:id/reviews/:reviewId`
- `GET /api/agents/:id/lesson-proposals?status=pending|approved|rejected|revoked`
- `PATCH /api/agents/:id/lesson-proposals/:proposalId`
- `POST /api/agents/:id/lesson-proposals/:proposalId/approve`
- `POST /api/agents/:id/lesson-proposals/:proposalId/reject`
- `POST /api/agents/:id/lesson-proposals/:proposalId/revoke`

Canonical entities and envelopes live in `@bazilion/api-types`. Mutations return typed conflicts for
stale edits and already-decided proposals. Daemon auth and first-run gates apply normally.

### CLI and web parity

CLI:

- `bazilion agent review-config <id> [--enable|--disable] [--every N] [--model provider:model|agent] [--reasoning LEVEL]`
- `bazilion agent review <id>`
- `bazilion agent reviews <id> [--status ...]`
- `bazilion agent lessons <id> [--status ...]`
- `bazilion agent lesson edit|approve|reject|revoke <proposal-id>`; mutating decisions require
  `--yes`

Web:

- Add an Agent **Learning** tab with review configuration, manual trigger, pending proposal queue,
  and review/decision history.
- Enablement explains cadence, selected review model, bounds, and that every proposal requires human
  approval.
- Proposal cards show scope, text, evidence references with redacted excerpts resolved from the
  canonical session on read, status, and edit/approve/reject/revoke actions using the shared
  `<Button>` component.
- Empty, loading, stale-conflict, provider-failure, cancellation, and disabled states are explicit.

## Out of scope

- Runtime creation, mutation, promotion, or deletion of skills.
- Automatic approval or direct reviewer writes to any persistent surface.
- Updating Team `USER.md` or Agent `IDENTITY.md`.
- Curator/garbage-collection passes, adaptive cadence, quality scoring, or acceptance-rate tuning.
- FTS/session search, embeddings, Honcho-style user modeling, or fine-tuning.
- Cron review triggers, reviewer conversation UI, or review notifications.
- Provider cost conversion. Persist counts available from the provider, but do not invent currency
  estimates when pricing metadata is absent.

## Acceptance tests

- Disabled-by-default Agent completes turns without counters producing review work.
- At enabled cadence, exactly one durable review is enqueued after a successful user-facing turn;
  errors, cancellations, scheduler turns, inbox wakes, and reviews do not increment it.
- Restart recovers a pending/expired review without duplicating proposals.
- Reviewer worker exposes only `propose_lesson`, never mirrors output, and never appends review text to
  the chat transcript.
- Transcript digest honors cursor, turn/character bounds, redaction, and excludes prior reviews.
- Reviewer produces 0–5 schema-valid proposals; malformed output takes one repair attempt then fails
  terminally with a bounded diagnostic.
- Classifier fixtures prove: stable user preference -> no lesson; verified Agent behavior -> private;
  verified reusable project procedure -> shared; transient/unresolved failure -> no lesson; and one
  observation never lands in two stores.
- Empty output completes successfully and does not trigger retries or warnings.
- Editing with a stale version conflicts; approve/reject/revoke transitions are idempotent and valid
  only from their specified predecessor state.
- Approved private lessons appear in the next Agent prompt within the total character ceiling.
- Approved shared lessons are searchable from Team memory and retry does not duplicate the qmd note.
- Revoking private/shared lessons removes their active projection, remains idempotent across partial
  failures, and retains decision history.
- Cancellation records `cancelled` and releases the Agent lifecycle/cancel registry.
- API auth, CLI commands, and Learning web tab cover configuration, enqueue, decisions, history, and
  degraded states.
- Backup/restore round-trip preserves config, reviews, proposals, decisions, and application receipts.

## Delivery slice

This story is complete when an operator can enable review for one Agent, complete the configured
number of successful chat turns, observe one background review, inspect/edit/approve its proposals,
and see an approved private lesson in the next prompt or an approved shared lesson in Team memory.

Before moving to Done, run one real 8-turn transcript through the configured production provider and
record proposal counts plus operator decisions in the As-built section. This is product calibration,
not a pass-rate gate; the human approval boundary remains mandatory regardless of initial quality.

## As-built

Implemented on `main` in four checkpoints:

- canonical review configuration, leased review/proposal records, backup schema coverage, and a
  bounded redacting transcript digest;
- an isolated review worker with only `propose_lesson`, one schema-repair allowance, provider/OAuth
  reuse, scheduler dispatch, Agent lifecycle exclusion, bounded retries, and cancellation;
- optimistic proposal decisions, deterministic Team-memory application, bounded private-prompt
  projection, evidence excerpts resolved and redacted from canonical sessions, and backup/restore
  receipts;
- authenticated HTTP endpoints, exact CLI commands, and the Agent Learning web tab with explicit
  disabled, empty, running/failure, stale-conflict, and decision states.

Real-provider calibration (2026-08-03): ran eight successful user-facing turns in a disposable,
current-schema home against the configured `openai-codex:gpt-5.5` production provider. The source
home was not migrated or modified; its OAuth credential was decrypted from a temporary DB copy and
re-encrypted under the disposable home's bootstrap token.

- Review result: `completed`, 8 turns, 3 proposals, no retry or failure.
- Private proposal: verify relevant tests before completion claims and cite the commands actually
  run; approved.
- Shared proposal: run `pnpm test` plus root and web typechecks before shipping; approved.
- Shared proposal: edit `0001_init.sql` and clean-bootstrap for alpha schema changes; approved.
- Correctly omitted: the stable coffee preference, transient service outage, unresolved workaround,
  and one-off status text.

All three approvals succeeded through `bazilion agent lesson approve <id> --yes`. The private
proposal became the sole approved private prompt projection and both shared proposals received
distinct deterministic `lessons/<proposal-id>.md` application receipts. The disposable calibration
home was then removed.
