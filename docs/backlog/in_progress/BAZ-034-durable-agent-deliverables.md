---
id: BAZ-034
title: Durable agent deliverables and a Team results library
status: in_progress
refined: 2026-09-07
size: M
created: 2026-09-07
priority: high
note: Implementation validated locally; pending commit and release. Evidence is in the implementation record.
---

# BAZ-034 — Durable agent deliverables and a Team results library

## User stories

- **As an operator**, I want to reopen and download a report after a turn finishes or I close chat,
  so an Agent's useful output does not depend on keeping its live stream open.
- **As an operator working with a Team**, I want a list of delivered files with their producing
  Agent and conversation, so I can find yesterday's result without searching every transcript.
- **As an operator switching between web, CLI, and Telegram**, I want each surface to refer to the
  same saved result, so receiving it in one place does not make it unavailable elsewhere.

## Goal

Make an explicit `deliver_file` call publish a durable snapshot with a stable reference, and expose
those results through authenticated downloads, conversation cards, and a small Team results view.

Implementation checkpoints, decisions, and validation evidence are tracked in the
[implementation record](../BAZ-034-progress.md).

## Why and current baseline

Verified against Bazilion `13c3a63` (v0.14.2) on 2026-09-07:

- Incoming attachments and outbound file delivery already exist; this is not an attachment story.
- [deliver_file](../../../apps/daemon/src/runtime/tools/deliver-file.ts) validates a workspace file,
  emits its bytes through a sink, and returns only a descriptive string to the transcript.
- [Worker delivery](../../../apps/daemon/src/runtime/worker/entry.ts) forwards a transient `file`
  event. [ChatPane](../../../apps/web/src/components/ChatPane.tsx) clears live entries on `done`;
  [ProviderMessage](../../../packages/api-types/src/events.ts) has no durable file reference.
- The baseline disappearing card was reproduced in Chromium before implementation; the
  implementation record contains the reproduction and retained-card verification evidence.
- Telegram already sends documents through the existing authorized
  [outbound mirror](../../../apps/daemon/src/lib/telegram/mirror.ts).

Hermes's release-tagged [desktop guide](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/desktop.md)
describes a gallery linked to originating sessions. That is the product inspiration; the storage
and access design below follows Bazilion's daemon ownership and Team boundaries.

## Scope

### Publication and ownership

- Publish only files explicitly passed to `deliver_file`; do not scan the Team workspace for
  outputs or retrospectively infer artifacts from arbitrary paths in old transcripts.
- Snapshot the validated bytes into daemon-owned storage outside the Agent-writable Team tree.
  Subsequent source-file edits, renames, and deletion must not change an already published result.
- The daemon assigns identity and binds the result to the producing Agent, Team, canonical session,
  and tool call. The worker cannot supply another Agent's identity or an arbitrary storage path.
- Keep the existing 25 MB per-file limit and workspace confinement. Enforce actual bytes received,
  including when the source grows after a size check; handle unavailable storage explicitly.
- Record filename, media type, byte length, content hash, creation time, and source references.
  Repeating publication for the same source operation must return its existing reference; two
  different deliveries with the same filename remain distinct results.
- Return success only after bytes and metadata are durably published. Define staging cleanup and
  restart reconciliation so a partial write cannot expose a successful but unreadable download.
- Distinguish a privately stored snapshot from an authorized operator-visible result. HTTP file
  frames already pass the shared Agent-to-user authorizer, as do Telegram deliveries. A denied or
  approval-held delivery must not become accessible through the library, detail/download API,
  transcript replay, or result card. Use the same source-owned authorization and approval attempt;
  approval releases the captured bytes and identity, never a reread of a changed workspace file.
- Persist the stable result reference in Pi's canonical transcript/tool result and carry it through
  the hermetic HTTP/IPC message types. Keep transcript JSONL authoritative; do not add runs/events
  tables or another copy of the conversation. Recover an interrupted publication without replaying
  the Agent's tools or promising exactly-once delivery to external transports.

### Operator surfaces

- Add authenticated list/detail/download operations, filtered by Team and optionally Agent, with
  pagination. Resolve opaque result IDs through daemon ownership; never accept a host path to read.
- Browser requests use the existing session/CSRF gateway; CLI/native requests use current device
  credentials. Publishing a result must not grant Agents broader access to other Teams' outputs.
- Preserve a download card after `done`, history hydration, client reconnect, and daemon restart.
- Existing native chat must preserve the result reference and offer a supported download/handoff
  instead of dropping the new wire field. A native results-library screen remains deferred.
- Add a Team results view with filename, type, size, date, Agent, and source conversation reference.
  Use a normal download for every supported file and bounded previews for raster images and plain
  text/Markdown. HTML, SVG, scripts, and other active content remain downloads in this slice.
- Provide CLI list/show/download parity with explicit output paths and no silent overwrite.
- Preserve Telegram document delivery using the saved bytes and existing egress authorization.
  A transport failure must not delete the result or claim the recipient received it.
- Route source links through existing Agent chat initially. Until BAZ-035 exposes named history,
  show an unavailable-history state when the originating conversation cannot be opened; never
  mislabel the newest conversation as the source. Add exact navigation when BAZ-035 ships.

### Storage lifecycle

- Centralize storage paths in [Paths](../../../apps/daemon/src/core/paths.ts). Any metadata schema
  change edits `0001_init.sql` directly and updates canonical backup validation; no ALTER migrations
  or importers under the alpha contract.
- Include saved bytes and references in backup/restore, with a manifest that detects missing or
  changed content. Specify consistency during concurrent publication rather than claiming a
  point-in-time snapshot of every ordinary workspace file.
- Provide explicit operator deletion with a named consequence and an unavailable/deleted result
  state in history. Define Agent/Team deletion, transfer, reset, and uninstall ownership before
  refinement; never traverse or delete an external linked Team target to clean stored results.

## Acceptance criteria

1. A delivered file remains downloadable after the final frame, reload, and daemon restart, with
   exactly the bytes and hash captured at publication even if its workspace source changes.
2. A second delivery of the same filename appears as a distinct item with accurate provenance.
3. Retrying the same publication operation cannot create duplicate items; failed publication
   produces an actionable failure and no successful dangling card.
4. Team/Agent filters, pagination, source references, preview, download, and explicit deletion work
   through the daemon API and supported operator clients. Deletion is truthful in old transcripts.
5. Traversal, escaping symlinks, spoofed ownership, oversized/growing streams, and unauthenticated
   requests cannot expose arbitrary host data. Previews cannot execute content or contact origins.
   Denied/approval-held egress cannot be bypassed through saved results or history; approving a held
   delivery releases only its captured snapshot through the canonical approval path.
6. Backup/restore preserves published results and provenance; lifecycle cleanup honors the agreed
   retention rules and never modifies a linked Team's external source files.
7. Web results and history cards remain usable with keyboard navigation and at a 390 px viewport.

## Dependencies and sequencing

- Extends existing file delivery, BAZ-024/030 backup guarantees, and BAZ-027/031 protected execution.
- Does not require BAZ-035, a desktop app, a new scheduler, or native mobile file-management screens.
- Implement durability and the completion/reload regression first, then the results view and
  previews. If lifecycle work pushes beyond M, split the library presentation before moving to todo.

## Out of scope

Executable HTML widgets, arbitrary workspace browsing, public sharing, automatic file discovery,
image generation, general document editing, Agent-to-Agent artifact sharing, native desktop
packaging, and reconstructing unavailable historic output bytes.

## Tests

- Reproduce live-card loss with a real completed turn, then verify live and hydrated references
  agree across success, failure, cancellation, refresh, and a second browser session.
- Exercise snapshot immutability, operation idempotency, duplicate filenames, partial publication,
  missing bytes, disk errors, size races, path confinement, ownership checks, and safe previews.
- Verify denied and approval-held HTTP/Telegram file deliveries stay inaccessible through every
  result projection; approval, expiry, revocation, and source-file changes honor captured content.
- Cover authenticated API/CLI operations, Telegram egress denial/failure, and preserved CLI download
  semantics. Verify content hashes after a backup/restore and every supported deletion lifecycle.
- Inspect populated, empty, deleted, and failed-download UI states at desktop and narrow widths.

## Refinement decisions

- Store immutable bytes and their receipts in SQLite BLOB rows in the daemon-owned
  `Paths.db`, outside Team workspaces. One transaction publishes bytes, hash and identity;
  SQLite rollback and WAL recovery own partial-write recovery. A receipt may survive an
  interrupted transcript append without claiming that the transcript or a transport succeeded.
- Limit retained bytes to 1 GiB per home and 25 MiB per file. Pending snapshots count toward
  the cap. Capacity exhaustion fails visibly; there is no automatic expiry of released results.
- Explicit deletion removes bytes and leaves a tombstone for truthful historic references.
  Agent deletion retains the original Team's results; transfers do not move ownership. Team
  deletion cascades all its result records. Reset/full uninstall remove them with the DB.
- A result becomes operator-visible only when the shared Agent-to-user
  authorizer allows HTTP, Telegram, or background library delivery, or the canonical approval dispatch releases the captured result.
  A successful release is a retained operator receipt: later policy edits govern new delivery
  attempts, not withdrawal of files already released to that same owner. Pending approval still
  revalidates current policy/membership; expired, rejected or invalidated holds do not release.
- Background turns use a reference-only `agent_result` attempt in the existing approval queue.
  HTTP and Telegram retain their transport-owned approvals. Private snapshots are reclaimed
  after the producer settles and no pending/delivering approval holds them. Startup reconciles
  interrupted result dispatches as failed, without retrying an uncertain Telegram send. Cleanup
  runs at startup, turn settlement, approval/result access, and before new publication; released
  results never expire automatically. Tombstones prevent abandoned source operations resurrecting.
- SQLite online backup includes result bytes and metadata in the same snapshot. The stored
  size/hash is the result manifest; backup and restore validation check every retained blob.
- Keep source session/tool-call references without requiring BAZ-035. Source navigation must
  report unavailable history when the current chat is no longer the originating session.
- Keep the complete story together; implement and validate in checkpoints. The provisional M
  estimate is not a scope cap.
