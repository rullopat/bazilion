---
id: BAZ-036
title: Visible, durable follow-up queue
status: in_progress
size: L (1-2 weeks)
created: 2026-09-07
refined: 2026-09-07
priority: high
note: Depends on BAZ-035 explicit session targeting; extends user ingress without replacing scheduler or approval dispatch.
---

# BAZ-036 — Visible, durable follow-up queue

## User stories

- **As an operator watching an Agent work**, I want to submit the next instruction while it is
  busy and see that it is waiting, so I can continue thinking without interrupting useful work.
- **As an operator refining a request**, I want to edit or remove an unsent follow-up and pause
  the queue, so an outdated instruction cannot start while I am correcting it.
- **As an operator using web, CLI, and Telegram**, I want one visible queue for an Agent, so
  changing interfaces or restarting the daemon cannot silently lose accepted follow-ups.
- **As an operator returning after an interruption**, I want pending work distinguished from
  work that might already have acted, so recovery does not repeat external side effects.

## Goal

Persist accepted user follow-ups in the daemon, expose their order and lifecycle across web,
CLI, and Telegram, and execute each through the existing serialized Agent turn boundary.
An accepted queue item means its input is retained; it does not mean the Agent has started,
completed, obtained communication approval, or delivered a response.

## Why and implementation baseline

- [ChatPane](../../../apps/web/src/components/ChatPane.tsx) now keeps the composer usable while
  busy and offers **Queue follow-up**. Unacknowledged submissions and their attachment bytes are
  retained in the browser with stable request identities for reconciliation after reload.
- The previous process-local Telegram FIFO is replaced by the
  [daemon-owned durable queue](../../../apps/daemon/src/core/repos/user-queue.ts). HTTP, CLI and
  Telegram input share its retained bytes, ordering, controls and lifecycle receipts.
- [Telegram ingress binding](../../../apps/daemon/src/lib/telegram/ingress-attempt.ts) binds
  each update to its exact `chatId:messageId`, original payload, and derived attachment input.
  Queue work must preserve this identity instead of concatenating messages under one attempt.
- [HTTP chat](../../../apps/daemon/src/routes/agents.ts),
  [turn preparation](../../../apps/daemon/src/lib/turn-preparation.ts), and the
  [active-Agent registry](../../../apps/daemon/src/lib/agent-cancel.ts) already own admission,
  final authorization, and one active turn per Agent. Their ownership remains authoritative.
- Hermes's released desktop offers editable queued prompts and a paused queue after Stop.
  This is inspiration for visible pending input, not a requirement to adopt its runtime:
  [Hermes desktop guide, v2026.8.31](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/desktop.md#chat).

## Dependencies

- [BAZ-035](../in_progress/BAZ-035-conversation-library.md): agree its explicit session-targeting contract before
  implementing this queue; the full conversation search UI need not ship first. Freeze the target
  at acceptance; UI session changes cannot retarget it. Cross-session items serialize by Agent.
- Reuse shipped BAZ-014 approval ownership, BAZ-019 scheduler admission, BAZ-027/031 protected
  execution, and BAZ-029 Telegram identity. This story adds no alternative authorization path.

## Scope

### Durable acceptance and lifecycle

- Add a bounded daemon-owned queue for user follow-ups from authenticated HTTP/CLI and paired
  Telegram ingress. Retain Agent, explicit session, source, attempt identity, input revision,
  ordering, timestamps, attachment references, and the minimum lifecycle receipt needed by UI.
- Define distinct states for accepted/pending, claimed/running, completed, failed, cancelled,
  and interrupted/uncertain. Queue pause is an Agent-level control, not a terminal item state.
  An approval-held item references its canonical approval and is not eligible for queue drain.
- Acknowledge acceptance only after the item and all required attachment bytes are durably
  retained. Enforce count, byte, and per-item limits; rejection leaves the user's draft intact.
  Repeated identical ingress attempts return the existing receipt; mismatched payloads conflict.
- Retain original attachment names/types and validated content bindings in daemon-owned storage.
  A missing or corrupt attachment fails explicitly; never silently send text alone. Define
  terminal retention and cleanup, including references held by canonical approvals and backups.
- Keep pi session JSONL authoritative for conversation content and results. Queue receipts link
  to that transcript; do not copy responses/tool events or introduce generic runs/events tables.

### Dispatch, authorization, and recovery

- Use the current turn-preparation boundary and active-Agent registry to claim an eligible head.
  Web, CLI, Telegram, scheduler, inbox, reviews, and approved turns cannot overlap for one Agent.
  Queue receipt ordering alone cannot bypass a busy Agent or displace another source's claim.
- Persist source provenance and exact attempt IDs, not process-local trusted objects. Rebuild
  typed invocations only inside the daemon after validating retained bindings and current
  Agent/session lifecycle, membership, policy, Telegram ownership/topic binding, and credentials.
- Check admissibility at acceptance and revalidate immediately before execution. A pending item
  is not a durable authorization grant. Denial or changed policy produces an explicit outcome.
- If communication approval is required, capture one canonical attempt and transfer dispatch
  ownership to that approval path. Queue UI follows the linked source; its drain never executes
  the same payload independently after approval. Frozen approval payloads use existing lifecycle
  controls and cannot be edited through the queue.
- Preserve each invocation's execution posture. Telegram stays protected with unattended shell
  approval behavior. A queued interactive request cannot assume its approving client is still
  present; use existing command-approval rules and fail closed when no eligible responder exists.
  Missing protected prerequisites never fall back to host execution.
- Restart may resume durably pending items through normal validation, respecting saved pause.
  A claimed/running item interrupted before its outcome was recorded becomes uncertain and
  pauses subsequent dispatch for that Agent until reconciled. Never automatically replay it:
  a worker may have acted before the crash. Explicit resubmission gets a new attempt identity.
- Keep this a narrow user-input queue. Scheduler occurrences, retries, and approval dispatch keep
  their existing owners; do not create a universal job engine or automatic tool-side-effect retry.

### Editing and operator controls

- Permit edits and deletion only before claim, using a revision check atomic with dispatch.
  A stale editor reports that execution already started and preserves the attempted correction
  as a local draft. A successful deletion prevents that item from starting.
- A changed payload is a replacement attempt, with its own authenticated provenance and fresh
  authorization, linked to the superseded receipt. Never reuse a Telegram transport identity or
  an approval for different content. Preserve original acceptance order for an eligible edit.
- **Pause queue** stops future claims without stopping the running turn. **Resume queue** enables
  normal admission. **Stop current turn** pauses the queue first and invokes existing Agent
  cancellation; pending messages remain visible and do not start when cancellation releases it.
- Do not describe queued messages as live steering. They reach the selected session in a later
  turn. Mid-turn model instruction injection requires a separate capability and story.

### Web, CLI, and Telegram

- Keep the web composer usable while busy, with explicit **Queue follow-up** copy. Show pending
  items, source/session, ordering, paused state, and separate running status above the composer;
  expose edit/remove/pause/resume and transcript links with responsive keyboard access.
- Add typed API/client contracts and CLI commands for enqueue/list/show/edit/remove/pause/resume.
  JSON output distinguishes acceptance from execution. Support stable request identity so a
  client can reconcile a lost response without unknowingly creating a second instruction.
- Route Telegram's existing FIFO through the same durable queue. Send a concise queued receipt
  for delayed input and expose queue status/pause/resume/remove through owner-validated controls.
  Web and CLI can edit pending Telegram items only as the replacement attempt described above.
- Changes are visible across clients without depending on the originating connection staying
  open. Surface failed persistence, full queue, changed target, approval hold, and uncertain
  outcomes clearly; a Telegram notification failure does not revoke a durable acceptance.

## Acceptance criteria

1. While one turn runs, two follow-ups from different user surfaces are durably accepted, visible
   in stable order, and start individually only after Agent admission permits them.
2. Reload/reconnect and a daemon restart preserve pending inputs, attachment bytes, selected
   sessions, identities, and pause state without duplicating any accepted request.
3. An edit/delete racing claim has one winner; claimed or approval-held content cannot change.
   Replacement content receives fresh authorization and never inherits the old payload's grant.
4. Pause leaves the active turn alone; Stop pauses future work and cancels the active turn;
   Resume cannot silently replay a turn marked uncertain after interruption.
5. Policy changes, revocation, Agent/session removal, stale Telegram binding, missing credentials,
   and lost attachments prevent inappropriate execution with a visible, inspectable outcome.
6. A canonical communication approval dispatches its item at most once; the queue does not also
   execute it. Busy scheduler/inbox/review turns cannot race a queued user turn into a second worker.
7. Web, CLI, and Telegram agree about pending/running/terminal status. Completion means the turn
   completed, not that a Telegram notification was delivered or an external task was verified.

## Out of scope

- Mid-turn steering, autonomous subagents, priority scheduling, queue reordering, or task boards.
- Automatic recovery of arbitrary side effects, general retries, or exactly-once execution claims.
- A second scheduler, approval engine, transcript store, or protected-execution bypass.
- Native desktop/mobile queue UI, push notifications, public sharing, or new Team membership.

## Tests and verification

- Cover durable acceptance/idempotency, attachment quotas/cleanup, restart before/after claim,
  cross-client revision conflicts, pause/Stop ordering, and explicit uncertain recovery.
- Exercise mixed user ingress against busy scheduler/inbox/review/approval paths, exact Telegram
  attempt bindings, changed policy/ownership, approval handoff, and protected-preflight failures.
- Verify API/CLI contracts, Telegram control authorization, transcript targeting through BAZ-035,
  backup round-trip, and web rendering at desktop and narrow widths with keyboard navigation.
- Run applicable full repository checks and adversarial security acceptance before release.

## Refined first-slice contract (2026-09-07)

- **Ownership:** `user_queue_items`, per-Agent queue controls and attachment rows are daemon-owned
  domain records. Attachment bytes live transactionally in SQLite with SHA-256/name/type metadata.
  No second transcript or generic job scheduler is introduced. Pending drain resumes from daemon
  bootstrap independently of the optional scheduled-trigger switch. A one-second pump checks the
  existing Agent registration before claim and final preparation; it does not own another worker lock.
- **Bounds:** 20 nonterminal items per Agent, 100 per home, 16 attachments per item, 25 MiB per file
  and aggregate item, 256 MiB retained queue attachment bytes per home, and 64 KiB UTF-8 input text.
  Invalid or over-limit attachments reject the entire request; do not silently omit them. Retain
  terminal input for seven days, then compact to receipt/identity metadata. Pending, held and
  unresolved uncertain inputs are never age-pruned. Cap compact identity receipts at 100,000 per
  home and reject new acceptance at capacity; do not evict an idempotency key and later replay it.
  Agent deletion cascades its queue storage. Canonical approvals prevent premature reclamation.
- **Identity:** a stable UUID request identity for HTTP/CLI; Telegram keeps its exact transport
  attempt. Store the original accepted Team, conversation, normalized input digest and Telegram
  owner/chat/topic binding. Retried identical requests reconcile the receipt before checking a new
  selection; different content under the same identity conflicts. Fresh authorization still applies
  at execution. A Telegram-derived turn cannot be rebound by editing its original transport payload.
- **Ordering/edits:** FIFO by immutable acceptance position. Editing a pending item creates a new
  authenticated HTTP replacement attempt at that position and atomically supersedes the old receipt.
  Compare input revision under the same transaction used for claim/remove. Held, claimed/running and
  terminal content is immutable. No implicit reorder, concatenation or retry of external effects.
- **Admission:** the existing lifecycle lease and `prepareAgentTurn` remain the only worker admission
  boundary. A durable queue claim is not an Agent registration. If another source wins admission,
  return the unstarted queue head to pending and await Agent idle. A claimed item surviving restart
  is conservatively uncertain, even if a crash may have preceded worker spawn. It is not replayed.
- **Approval handoff:** introduce a canonical typed `queued_user` approval payload containing the
  queue receipt ID and immutable input binding. The approval dispatcher resolves retained bytes and
  original provenance; only that canonical dispatcher can execute a held item. Queue drain observes
  the linked outcome and never also runs it. Holds block later user items, preserving execution FIFO.
- **Execution posture:** queued HTTP remains the configured operator surface; Telegram remains
  protected. Both use `auto_deny` for dangerous-command approval because no connected approving
  client can be assumed at dispatch or after restart. A future live question route must be verified
  separately by BAZ-037; persisting a client capability claim does not grant one.
- **Restore:** an older snapshot cannot prove its pending inputs have never acted. Restore pauses
  nonterminal queue work for explicit reconciliation; canonical approval dispatch also rejects
  uncertain restored inputs. Ordinary daemon restart can still resume unclaimed pending work.
- **Controls/recovery:** Pause prevents future claims. Stop persists pause before invoking existing
  Agent cancellation. Resume enables pending work but cannot replay uncertainty. Explicit resubmission
  creates a fresh attempt and requires the operator to reconcile possible prior effects. A failure
  remains visible; admission/credential/binding/attachment failures do not become silent text-only turns.
- **Cross-client contract:** enqueue/list/show/edit/remove/pause/resume/Stop share authenticated API
  and CLI operations. Telegram adds owner-validated status/pause/resume/remove controls and durable
  queued receipts; send failures do not revoke acceptance. Web keeps text/attachments editable while
  busy and labels acceptance **Queue follow-up**. Initial HTTP admission must expose the newly created
  conversation selection before the first turn ends, so a first-turn follow-up has an observed target.
- **Fairness/retention:** other sources retain their existing admission rules, so a continuously busy
  non-queue source can delay user FIFO work. Retention is bounded storage, not a delivery guarantee;
  inspectable terminal receipts do not mean Telegram delivery or external task success.

Track implementation, races and acceptance evidence in
[the milestone progress log](../BAZ-035-038-progress.md).
