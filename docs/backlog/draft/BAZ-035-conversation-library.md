---
id: BAZ-035
title: Conversation library and safe new conversations
status: draft
size: L
created: 2026-09-07
priority: high
note: Refine cross-channel conversation targeting and retained-session identity before moving to todo.
---

# BAZ-035 — Conversation library and safe new conversations

## User stories

- **As an operator working with a permanent Agent**, I want to start a separate conversation without
  deleting earlier work, so a fresh context does not cost me the previous discussion or its outputs.
- **As an operator returning to an earlier task**, I want a named conversation library with readable
  history, so I can find the relevant work without scrolling through one ever-growing conversation.
- **As an operator switching between web, CLI, and Telegram**, I want each accepted message to have
  an unambiguous conversation destination, so another client cannot silently redirect my message.

## Goal

Give each Agent a retained conversation library and exactly one daemon-selected active conversation.
The first useful slice is list, rename, read, and safe **New conversation**, with explicit selection
state across clients. Exact text search and resuming a retained conversation can follow as separately
accepted increments. Conversation branching is outside this story.

## Why and current baseline

An Agent currently behaves as one persistent conversation. The session bridge opens the newest JSONL
by modification time in both normal and protected execution
([session bridge](../../../apps/daemon/src/runtime/pi/session.ts)). That makes file activity an
implicit routing decision; it cannot safely represent a user-selected conversation library.

The daemon exposes only current-session messages and a lightweight file/size head. Its chat reset
deletes every session JSONL, while last-message editing branches the current Pi transcript internally
([Agent routes](../../../apps/daemon/src/routes/agents.ts)). Neither operation provides retained,
named conversations that the operator can browse independently.

The web chat polls the session head, shows a stale-history banner, and offers a destructive reset
([ChatPane](../../../apps/web/src/components/ChatPane.tsx)). Mobile also loads current messages
([native chat](../../../apps/mobile/app/agents/[id]/chat.tsx)). Keep those established clients working
against one daemon-owned selection contract; a browser tab must not become the session authority.

Inspiration: OpenClaw's [session search](https://docs.openclaw.ai/concepts/session-search) and the
[Hermes desktop guide at v2026.8.31](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/desktop.md)
show the value of returning to earlier work. These are reference experiences, not a requirement to
copy their storage, branching, or desktop architecture.

## Scope

### 1. Retained library and explicit selection

- Add daemon-owned conversation identity, an editable display title, timestamps, and the Agent's
  active-conversation reference. Keep exactly one selected conversation per Agent, regardless of
  client. A new Agent may have no conversation until its first explicit creation or admitted turn.
- List an Agent's conversations with bounded pagination and a clear active marker. Read a selected
  retained conversation without changing where future turns will run; opening history is read-only.
- **New conversation** creates and selects an empty canonical session without deleting the previous
  one. It preserves Agent documents, reviewed lessons, Team memory, Skills, and prior artifacts.
- Titles are user-editable metadata; use a deterministic default without an additional model call.
  Renaming must not change canonical session identity, transcript contents, or turn routing.
- Replace the ordinary fresh-context action with **New conversation**. Keep any permanent history
  deletion behind a separate explicit operation whose consequences are refined before implementation.
- Give list/read/create/rename/selection management HTTP and CLI parity. Provide web library and
  read-only history views, including empty, loading, unavailable, and selected-conversation states.
- Existing mobile chat must display and submit against the daemon's selection safely. A full native
  conversation-management UI is deferred; the web library remains usable in a narrow viewport.

### 2. Turn admission and consistency

- Preserve one active turn per Agent across foreground chat, protected turns, reviews, scheduler,
  inbox, Telegram, and communication-approval execution. New conversation or a selection change
  must acquire the same lifecycle protection and fail with a typed busy conflict while occupied.
- Resolve the conversation on the daemon before worker spawn, then pass that exact identity to the
  worker. Neither normal nor protected session opening may select a different file by latest mtime.
- Foreground submissions include the conversation identity and selection revision the client saw.
  If stale, reject before model/tool side effects and preserve the user's draft for an explicit retry.
  Old cached clients lacking required targeting metadata receive recovery guidance, not silent routing.
- Return authoritative selection metadata with history/head responses. Other clients detect a change
  without losing an unsent draft; a stale tab cannot append to a different conversation unnoticed.
- Define queued, scheduled, inbox, Telegram, and held-approval destination rules before this story
  becomes ready. Every eventual dispatch must resolve one explicit, authorized conversation and
  record its identity in the owning operation's existing receipt where applicable.
- Creation/selection is atomic from the caller's perspective. Repeated requests and crashes must not
  produce duplicate selected conversations, orphan an accepted message, or fall back to another file.

### 3. Canonical history and output references

- Pi session JSONL remains the transcript authority. Any DB metadata or search index is a projection
  or routing record, never a second copy of chat history or a revived runs/events subsystem.
- Establish an immutable, Agent-scoped conversation identity independent of display title and active
  selection. Preserve canonical transcript-entry identities through rename, viewing, and selection.
- Coordinate with [BAZ-034](../in_progress/BAZ-034-durable-agent-deliverables.md): artifact provenance links to the
  original conversation and canonical source entry. New conversation, rename, or resume must not
  retarget a delivery, break an existing download, or confuse two same-named outputs.
- Resolve requested identities through the owning Agent and validated canonical session metadata;
  never accept arbitrary filesystem paths. Missing/corrupt history is visibly unavailable and cannot
  silently become a fresh conversation. Bound transcript reads and exclude private review sessions.
- Cover metadata and canonical files in backup/restore. Follow the clean-install alpha schema
  contract; no ALTER migrations, legacy adapters, or automatic transcript-format conversions.

### 4. Follow-on increments to refine separately

- Exact text search across retained user/assistant text, scoped to an Agent or Team with pagination
  and links to canonical entries. Exclude attachment bytes, tool payloads, and hidden review input.
  A derived index must be rebuildable, and opening a result must not change active selection.
- Explicit **Resume conversation** can select retained history while idle using the same revision
  check and lifecycle lock. Reading old work alone must never resume it. Do not include these two
  increments in the first implementation commitment without estimating them separately.

## Acceptance criteria

- Creating a new conversation leaves previous history and BAZ-034 output links readable after page
  reload and daemon restart, with exactly one active conversation and an understandable default title.
- Renaming and opening retained history cannot alter selection, canonical IDs, or existing content.
- A stale web/CLI/mobile submission is rejected before spawn; the client can recover its draft and
  consciously send it to the current conversation. All normal/protected workers use the admitted ID.
- Concurrent create/select/send attempts cannot overlap Agent turns or route a message by file mtime.
  Busy selection conflicts are explicit and leave both history and active selection unchanged.
- All background and queued sources follow the targeting decisions resolved during refinement.
- Missing/corrupt sessions and invalid/foreign identities fail visibly without exposing another
  Agent's transcript. An interrupted metadata/file write has a documented recovery outcome.
- Web and CLI expose the agreed first slice; narrow web layouts and native chat remain usable.

## Out of scope

- Branch trees, forks, merging transcripts, rollback of tool side effects, and simultaneous Agent turns.
- Semantic/vector search, model-generated titles/summaries, transcript analytics, or a desktop app.
- A new task/workflow model, per-client active conversations, channel-specific transcript copies,
  sharing conversations between Agents, or automatic history deletion/retention policies.
- Changes to Team memory ownership, the reviewed-learning classifier, or provider credential handling.

## Tests and verification

- Session-selection integration tests for normal/protected execution, rename/read non-mutation,
  concurrent creation, stale revisions, missing files, crash boundaries, and restart recovery.
- Cover every resolved ingress/dispatch rule, especially queued Telegram updates, scheduler retries,
  delayed approvals, inbox wakes, and selection changes between admission and execution.
- Verify retained JSONL and BAZ-034 provenance through creation, rename, reload, and backup/restore;
  exercise path traversal, foreign Agent IDs, private review exclusion, and bounded reads.
- CLI/API parity and web/mobile recovery tests, plus keyboard and narrow-screen browser acceptance
  using isolated state. Run applicable repository typechecks, regression and security gates.

## Dependencies and Open Questions

- **Identity agreement:** coordinate immutable session/entry references with BAZ-034 before either
  implementation settles its schema. Neither feature needs the other's complete UI to ship.
- **Background targeting:** should scheduled/inbox work follow the currently selected conversation,
  or retain its admission-time destination? Recommend pinning each admitted occurrence/attempt and
  never retargeting accepted work; define pre-admission and delayed-approval behavior explicitly.
- **Telegram selection:** it has no conversation picker today. Recommend exposing the active title
  and an explicit new/resume action before shared selection ships; decide the minimum channel UX.
- **Queued follow-ups:** coordinate with [BAZ-036](BAZ-036-visible-follow-up-queue.md). Recommend
  capturing conversation identity when an item is accepted and preventing silent retargeting; decide
  whether selection is blocked by waiting items or those items require explicit cancellation.
- **First release boundary:** recommend library/read/rename/New conversation first; decide whether
  exact text search or explicit resume warrants a separate story after the identity contract lands.
- **Deletion and recovery:** recommend retaining history by default and leaving purge separate.
  Specify missing-active-session recovery and metadata/file crash reconciliation before todo.
