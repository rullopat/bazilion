# BAZ-035–038: conversation and operator interaction milestone

Target: draft [PR #44](https://github.com/rullopat/bazilion/pull/44), branch `release/0.15.0`.
BAZ-034 is preserved. Completion requires all four full first-slice contracts, integration evidence,
commits/push and passing final CI. Merge, versioning, publication and deployment are excluded.

## Checkpoints

- [ ] Refine shared contracts and each story's open questions against current code.
- [ ] BAZ-035: retained conversations and safe explicit targeting.
- [ ] BAZ-036: durable follow-ups across web/CLI/Telegram.
- [ ] BAZ-037: correlated live clarification across supported human clients.
- [ ] BAZ-038: opt-in notifications for existing Attention sources.
- [ ] Integrated acceptance, security, client demos, full checks and final PR evidence.

## Current evidence

- Starting implementation commit: `624b731`; the release branch was clean.
- `runtime/pi/session.ts` chooses the newest session by mtime in normal and protected session
  creation and current-history reads. Its optional `sessionId` is not used for selection.
- Pi's SessionManager defers writing new session headers until assistant output. A user-visible
  empty conversation therefore needs an explicitly durable canonical header before selection.
- `turn-preparation.ts` owns the Agent lifecycle lease and registration. Selection/create must
  share that lease; introducing an independent busy flag would allow races.
- `result-source.ts` already provides bounded, no-follow canonical-header identity validation.
  Preserve that read boundary and existing result provenance when adding library access.

## Refinement direction

These choices guide implementation; remaining dispatch and policy mappings must be checked before
marking the corresponding story refined.

- Conversation identity equals its immutable Pi header ID. Store only daemon-owned routing/title
  metadata, never a second transcript. Bind each row to its Agent and explicit filename.
- Store active conversation and monotonic selection revision per Agent. Reads/renames do not
  select. New conversation uses the shared lifecycle lease and rejects busy Agents.
- Foreground sends require the selection the client saw; stale requests preserve drafts and fail
  before spawn. Resolve accepted background/Telegram/approval work once and retain its target.
- Reading a missing/corrupt active session must fail visibly, never create or select another one.
  Explicit New conversation is the recovery path; search, resume and purge are deferred.
- Queue inputs retain their targets. Pending/held queued input blocks New conversation in the
  first slice, avoiding a hidden retained-session resume path; remove/reconcile it first.
- Queue approval holds remain visible and block later user items, preserving FIFO rather than
  silently permitting later inputs to overtake. Canonical approvals exclusively own held dispatch.
- Queue Stop pauses before cancellation; crash-uncertain execution pauses subsequent dispatch.
  Explicit resubmission creates a new attempt. No tool replay or implicit retry of side effects.
- Questions occupy the existing live Agent slot. Default wait is at most five minutes and never
  longer than the existing turn deadline. Startup closes old waiters; an accepted answer is not
  proof of consumption. Telegram answers require explicit prompt/question correlation.
- Notifications use the existing paired service topic, default off, no quiet window until set,
  newly eligible items by default. Resolve egress mapping and source/mirror correlation explicitly;
  suppressed policy must not create notification approval recursion. Ambiguous sends require
  explicit retry; restored receipt state remains paused until operator reconciliation.

## Outstanding refinement

- Exact scheduler, inbox, Telegram and delayed-approval target persistence/admission points.
- Queue attachment/count/byte/terminal-retention defaults and disconnected responder behavior.
- Question policy delivery/answer attempt mapping, approval dispatch hooks and retention limits.
- Notification source-to-policy mapping, destination generation, mirror correlation and restore
  detection that distinguishes restoration from a normal restart.

## Validation ledger

No BAZ-035–038 acceptance criterion is complete yet. Record tests and rendered evidence under each
story as implementation lands; passing BAZ-034 evidence alone does not establish this milestone.

### BAZ-035 foundation checkpoint

- Refined BAZ-035's complete first-slice routing/recovery decisions and moved it to `in_progress`;
  dependent links and backlog counts updated. BAZ-036–038 remain drafts awaiting their own mapping.
- Added `lib/conversation-file.ts`: durable canonical empty-session publication, exclusive staging,
  fsync, non-overwriting retry behavior, UUID/Agent confinement and no-follow existing-file checks.
  It is not yet wired into daemon selection or turn preparation.
- Three focused filesystem/Pi tests passed; root typecheck passed. No full BAZ-035 acceptance
  criterion is claimed from this foundation alone.
- PR #44 now explicitly lists all four selected stories unchecked. Existing BAZ-034 head CI passed
  (`34124892534`); it does not cover these uncommitted foundation changes.
- Next: daemon conversation metadata/revision transactions and explicit runtime file selection,
  then foreground and delayed-dispatch targeting with integration tests.

### Conversation metadata and API checkpoint

- Added hermetic conversation/selection/create wire types, canonical metadata and selection tables,
  transactional create with an idempotent UUID request, monotonic selection revisions, title revisions,
  Agent-scoped reads and bounded pagination. Retried creation never reselects older history.
- Added authenticated Agent conversation list/create/read/rename endpoints. New conversation shares
  the existing lifecycle lease, rejects active Agents and pending Telegram items, and publishes the
  durable header before selection. Missing history returns an explicit unavailable response.
- Ten focused tests passed across metadata, filesystem/Pi and authenticated routes; root typecheck
  passed. Tests cover stale creation before filesystem writes, rollback on failed publication,
  idempotent retries after later selection, rename non-selection, foreign Agent access and cascade.
- Canonical CLI backup schema object list/fingerprint updated for the two new tables and index.
  Backup regression verification is tracked separately below.
- Runtime workers and existing current-history clients are NOT yet connected to these metadata
  rows. No full BAZ-035 criterion is complete until all foreground/background admission and client
  paths use the explicit target. Queue/question/notification implementation remains outstanding.
- Backup regression: all 42 CLI backup tests passed after updating the canonical schema fingerprint
  (`/tmp/baz035-backup-check.log`). The first sandboxed attempt could not start its loopback server;
  the same test passed with loopback permission. This verifies existing backup paths, not yet the
  complete conversation-specific restore acceptance.

### Admission-to-worker target checkpoint

- Added `ConversationTarget` and `resolveConversationTarget`: admission creates an initial canonical
  conversation only for an empty selection, resolves explicit pinned targets without selecting them,
  and rejects missing/foreign/corrupt targets. File mtime does not influence this resolver.
- Prepared turns now carry the target through configured/protected worker input. Worker parsing
  requires a bounded ID/filename binding; normal/protected Pi creation opens that exact validated
  file. Restricted review keeps its separate scratch session and receives no conversation target.
- Extracted the existing bounded descriptor reader for exact worker file validation. Pi cannot
  repair or recreate an unavailable target through normal session opening.
- Bound production result publication to the admitted conversation and pre-turn transcript offset.
- 23 admission/target/worker-runtime tests passed; 19 protected-session/OAuth/source-security tests
  passed; root typecheck passed. Low-level fixtures now provide explicit conversation targets.
- Remaining integration is substantial: current-history/head/review readers still include mtime
  selection; foreground selection tokens/client recovery, admission-time persistence for delayed
  approvals/scheduler/inbox/Telegram, and lifecycle guards for context/compact/edit/reset still need
  completion. The optional head-reader target is transitional internal work, not the final routing
  contract; remove production implicit selection when these consumers are connected.
- No full BAZ-035 acceptance or integrated four-story completion is claimed. Changes remain local.

### Foreground selection and read surfaces checkpoint

- Current history/head and reviewer reads now receive the metadata-selected target. Runtime
  history readers no longer discover a most-recent file when no target is supplied; remaining
  mtime discovery is confined to the existing test helpers. Result source display addresses the
  captured canonical session filename directly, so selection changes do not retarget its link.
- History responses include selection and head together; web SSR uses that one response. Chat
  rejects absent/stale expected selection before execution. HTTP approval payloads now retain
  their original conversation ID and approval dispatch carries it into preparation.
- Web sends observed selection and preserves text/attachments on conflict; explicit history refresh
  keeps the draft. Mobile submits observed selection and restores a conflicted draft with refreshed
  history. CLI TTY captures selection before the prompt and restores failed input for explicit retry.
- Added `bazilion conversation list/show/new/rename`. Its end-to-end CLI/API check passed against
  an isolated daemon. Eleven route/target/admission tests passed, including stale/absent foreground
  selection rejection with unchanged empty canonical history. Root/web/mobile typechecks passed.
- Remaining: web library/New action, control-route lifecycle/selection guards and removal of the
  destructive ordinary reset, scheduler/inbox/Telegram target persistence, idempotent CLI create
  retry ergonomics, and updating older fixtures to register canonical metadata explicitly. Full
  result/approval regression gates have not yet been rerun; prior tests assuming mtime/untargeted
  requests must be adapted to the new contract without weakening their original assertions.

### Library, delayed targets and recovery checkpoint

- Web now has paginated list/read/rename/New controls. Retained history lives in the scrollable chat
  area so the composer remains visible at narrow widths. A pending creation UUID and original
  selection survive tab reload. CLI prints exact retry parameters; retrying after rename or a newer
  selection returns the original receipt without selecting it. Accepted creation can be reconciled
  while a later turn is busy. Reused IDs with different input return a typed conflict.
- Removed ordinary destructive chat reset from API/CLI/web and updated operational docs. Compact,
  edit and context share the Agent lifecycle lease; mutations require observed selection, and context
  does not implicitly create history. Both web loaders use one atomic history/head response.
- Scheduler occurrences persist conversation ID at materialization. Inbox claims bind the target in
  their existing message receipt transaction. Telegram captures before asynchronous media download,
  validates that binding in typed invocations, and carries it through held approval dispatch.
- Result publication now requires its admitted target. Runtime and test session helpers no longer
  discover history by mtime. Current readers mark missing/corrupt selected history unavailable so the
  library and explicit New recovery remain accessible; native chat reports web/CLI recovery guidance.
- Fresh isolated simulator browser checks passed: create, rename, file delivery, New, retained file
  rendering, view-without-selection, 390px layout, two-tab stale-send rejection with text and attachment
  preserved through refresh, and missing-file recovery. The original result source stayed readable.
  Harness/evidence: `/tmp/baz035-final-demo/check-library.mjs`, `check-stale.mjs`, `check-recovery.mjs`
  and `library-narrow.png`; no personal home or external messages/providers used.
- 90 focused daemon regressions and 22 CLI checks passed. Added scheduler target-retention and inbox
  receipt checks (15 scheduler tests pass), plus Telegram media-download selection-race coverage.
  Enhanced real backup round-trip passes with two conversations, renamed history, exact active
  selection, byte-identical canonical file and result provenance preserved in the restored home.
- The full checkpoint run reached 1,240 passing tests with three fixture failures (an obsolete backup
  session-ID expectation and two invalid self-edge test fixtures). Those are corrected and targeted
  reruns pass. The first security rerun included the obsolete backup expectation and failed; final
  full/security reruns are now in progress. Do not treat earlier PR CI as covering this work.
- Root/web/mobile typechecks passed before the last retry refinement; rerunning them now. Biome
  formatting applied to intended files. Package build, final lint/diff and final CI remain required.
- BAZ-036–038 are still unimplemented. Before the BAZ-035 checkpoint is called complete, verify the
  final reruns and maintain the pending-work/New guard when replacing Telegram's in-memory queue.
  All milestone code remains uncommitted; PR #44 still has only the previous BAZ-034 implementation.

### Verified BAZ-035 local checkpoint

- Full suite: **1,244 passed, 3 skipped, 153 passing files** (`/tmp/baz035-full-verified.log`).
- Security acceptance: **all 60 required adversarial cases passed**
  (`/tmp/baz035-security-verified.log`), including the production web build/gateway tests.
- Root, web and mobile typechecks passed (`/tmp/baz035-final-types.log`). Root lint passed with
  warnings only; `git diff --check` passed. Package build is the remaining local checkpoint gate.
- New tests retain the original security assertions while providing admitted canonical targets.
  The final suite includes creation retry during a busy later turn, scheduler and inbox receipt
  binding, Telegram pre-download targeting, retained result-source reads and backup round-trip.
- BAZ-035's library/targeting slice is locally verified. Queue integration remains part of BAZ-036;
  the four-story goal is active, and nothing in this checkpoint means published or deployed.
- Package build also passed (`/tmp/baz035-package-build.log`). All local BAZ-035 checkpoint gates
  are green; committing/pushing the slice into the existing draft release PR is next.
