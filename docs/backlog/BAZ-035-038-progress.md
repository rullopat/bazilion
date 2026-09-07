# BAZ-035–038: conversation and operator interaction milestone

Target: draft [PR #44](https://github.com/rullopat/bazilion/pull/44), branch `release/0.15.0`.
BAZ-034 is preserved. Completion requires all four full first-slice contracts, integration evidence,
commits/push and passing final CI. Merge, versioning, publication and deployment are excluded.

## Checkpoints

- [ ] Refine shared contracts and each story's open questions against current code.
- [x] BAZ-035: retained conversations and safe explicit targeting (0af1061, CI passed).
- [ ] BAZ-036: implementation and local acceptance passed; commit/push and CI pending.
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

- Question policy delivery/answer attempt mapping, approval dispatch hooks and retention limits.
- Notification source-to-policy mapping, destination generation, mirror correlation and restore
  detection that distinguishes restoration from a normal restart.

## Validation ledger

BAZ-035 is verified and pushed at `0af1061`, with its local and CI evidence recorded below.
BAZ-036–038 remain incomplete. Foundation tests do not establish an entire story's acceptance.

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

### PR checkpoint and BAZ-036 refinement

- BAZ-035 is committed and pushed as **`0af106176d01ecb958162e5bd81aec879ebaca13`** on
  `release/0.15.0`. Local and remote branch SHAs matched; the implementation worktree was clean.
  PR #44 remains draft and now checks BAZ-035 while leaving BAZ-036–038 unchecked.
- GitHub CI run **34131503647** was pending at the last check; verify it before claiming remote
  acceptance. Local gates and deployment remain distinct.
- BAZ-036 refinement now fixes durable byte/count/retention bounds, immutable replacement attempts,
  FIFO approval holds, canonical `queued_user` dispatch ownership, unattended shell-review behavior,
  Stop ordering and conservative restart uncertainty. See its refined contract before implementing.
  The story remains in draft until implementation begins; no queue implementation is claimed yet.
- GitHub CI **34131503647 completed successfully** for `0af1061` (Typecheck, test, build).
  BAZ-035 has local and remote checkpoint acceptance. The later BAZ-036 refinement/log edits are
  local and will accompany its implementation checkpoint; the overall four-story goal remains active.


### BAZ-036 durable storage foundation

- Moved refined BAZ-036 to `in_progress`; reconciled index counts and dependent links.
- Added hermetic queue wire types and canonical item/control/attachment tables. Acceptance retains
  normalized text, original attachment metadata and bytes in one SQLite transaction. Quotas cover
  per-Agent/home active items, retained bytes, attachment count/size, text and identity receipts.
- Immutable digests reject mismatched retries and detect missing attachment rows, corrupt bytes or
  changed input bindings. Terminal payload pruning keeps compact identity receipts; it does not
  discard unresolved uncertain work or bytes still owned by a live canonical approval.
- Added revision-checked replacement attempts preserving FIFO position, remove, pause/resume,
  claim/transition guards, strict held-head ordering and conservative restart reconciliation.
  Restarted claimed/running items become uncertain and pause the Agent queue. Resume requires
  explicit reconciliation; these receipts never become automatic retries.
- **10 storage tests passed** (`/tmp/baz036-storage-tests.log`) and root typecheck passed
  (`/tmp/baz036-storage-types.log`). Tests include transactional attachment failure, missing/corrupt
  bytes, stale edits/removal, FIFO holds, quota rejection, pruning/idempotency and an actual SQLite
  close/reopen preserving pending bytes and uncertainty/pause. These are storage-level tests only.
- Backup canonical object list/hash updated for the new tables/indexes; full backup regression is
  still required for this schema. No BAZ-036 service, dispatcher, API/client, CLI/web or Telegram
  integration is implemented yet, and no complete BAZ-036 acceptance criterion is claimed.
- Next: admission and canonical `queued_user` approval ownership, then serialized drain/startup,
  Stop and API/CLI/web/Telegram controls. Add an early foreground admission selection receipt so
  the web can target follow-ups during its very first streaming turn. Replace the old Telegram map
  and preserve the BAZ-035 pending-work guard. Question/notification work remains outstanding.
- Restore needs a separate conservative queue boundary: an older snapshot can contain pending work
  that already acted after the backup. Pause and require reconciliation for restored nonterminal
  items; normal restart may resume genuinely pending items. Canonical approval replay must respect
  that restore uncertainty too. Implement/verify this in the filesystem-level restore flow.

### BAZ-036 HTTP admission checkpoint

- Added the internal HTTP admission service under the existing Agent lifecycle lease. Busy Agents
  can retain follow-ups without taking or disturbing their active registration. It validates input,
  rejects stale selection, captures the existing target, and uses the shared ingress authorizer.
- Queue input/attachments and a reference-only canonical `queued_user` approval hold commit in one
  transaction. Failed approval persistence restores a superseded original input and its FIFO place.
  Policy denial rolls back bytes/receipts while preserving source-owned policy-block evidence.
- Exact attempts reconcile before current selection/membership checks, including after a later New
  conversation. Mismatched retries conflict; malformed UUIDs cannot create a conversation as a side
  effect. The service assumes its eventual route caller has authenticated the operator.
- **16 storage/admission tests passed**, root typecheck passed, changed-file Biome checks passed
  with one test warning, and diff checks passed (`/tmp/baz036-admission-{tests,types,format}.log`).
- The `queued_user` approval is currently only captured by internal admission: its closed delivery
  planner and dispatcher have NOT yet been extended. No public enqueue endpoint or drain is enabled.
  Next implement that canonical owner, then service/API/CLI/web/Telegram and restore integration.
  BAZ-036 is still local and incomplete; BAZ-037–038 remain outstanding. Goal stays active.

### BAZ-036 approval binding checkpoint

- Added a metadata-only `validateQueuedUserApproval` helper to the canonical approval planner
  module. It checks the closed payload shape, digest, queue identity, Agent/Team, canonical
  approval owner, original attempt and HTTP/Telegram origin pairing before bytes are loaded.
- Tested against an actual persisted policy hold, including forged references, ownership and
  transport changes. Metadata validation deliberately does not imply byte integrity: execution
  must still call `readInput`, which rejects missing or altered attachments.
- Targeted admission/planner suites: 30 tests passed. Root typecheck and diff checks passed
  (`/tmp/baz036-approval-binding-{tests,types}.log`).
- This helper is not yet wired into the plan union or delivery route. The closed dispatcher still
  rejects `queued_user`; no public queue or drain is enabled. Next connect canonical delivery,
  admission ownership and interrupted-approval recovery before exposing queue controls.

### BAZ-036 canonical delivery checkpoint

- Connected `queued_user` to the closed approval planner and canonical approval route. Its
  reference lookup is metadata-only. A paused or non-head hold returns 409 before claiming the
  approval, preserving the pending decision. An eligible hold is claimed only by that dispatcher.
- Added HTTP queued approval delivery through the existing trusted `approval_delivery` invocation
  and `prepareAgentTurn` admission. It waits for active work to release the Agent, retries admission
  races, checks captured membership, revalidates exact policy references after waiting, and uses
  captured conversation and retained attachment bytes. Shell approval remains `auto_deny`.
- Queue outcomes distinguish completion, failure, cancellation and missing/uncertain completion.
  A failure before worker execution releases prepared registration; uncertainty pauses the queue.
  Duplicate delivery cannot start a second worker. Telegram delivery intentionally still rejects
  until its owner/topic/provenance admission and revalidation are implemented.
- Bootstrap now recovers claimed/running input and the canonical-approval-claimed/queue-still-held
  crash window to uncertain plus paused. Terminal denied/expired/cancelled approvals release their
  holds as cancelled; terminal delivery without queue outcome becomes uncertain. Approval routes
  and bootstrap reconcile these holds without dispatching them independently.
- 56 targeted tests passed across queue storage, admission, approval delivery, planner and existing
  communication routes. Root typecheck, changed-file formatting and diff checks passed
  (`/tmp/baz036-approved-final-tests.log`, `/tmp/baz036-approved-types.log`). Delivery service tests
  mock worker preparation/frames; real worker, public route, browser and full acceptance tests remain.
- Next: normal serialized queue drain, public API and client controls, Telegram durable replacement,
  early foreground target receipt, restore reconciliation, retention scheduling and demos. Review
  the pending-approval UX alongside queue controls. No public enqueue endpoint is enabled yet.
  BAZ-036 remains uncommitted and incomplete; BAZ-037 and BAZ-038 are still outstanding.

### BAZ-036 normal drain checkpoint

- Added `drainUserQueueHead` for ordinary HTTP input. SQLite claims the FIFO head; preparation
  remains the only Agent admission path. Busy races return an unstarted claim to pending, policy
  holds attach the canonical approval, and execution records completed/failed/cancelled/uncertain
  outcomes without automatic replay of uncertain work.
- The daemon-only preparation input can carry a queue item ID. Under the lifecycle lease it
  verifies claimed state, source, Agent membership/archive state, target conversation, original
  attempt, exact text/attachments and pause state against retained storage. Policy re-evaluation
  then captures a `queued_user` reference instead of duplicating input into `agent_turn` approval.
- Added an independent one-second queue pump at daemon listener startup. It bounds each Agent to
  one local task, reconciles terminal approvals and periodically prunes eligible terminal bytes.
  Shutdown stops new claims, cancels running pump work and waits within the existing shutdown cap.
  It does not depend on `BAZILION_SCHEDULER`.
- 41 targeted tests passed across real preparation, mocked-frame delivery/pump, storage, admission
  and communication routes. Tests cover substituted input, a newly required policy hold, FIFO,
  busy admission, scheduler-off pumping, non-overlap and no further claims after pump shutdown.
  Root typecheck, formatting and diff checks passed (`/tmp/baz036-drain-final-tests.log`,
  `/tmp/baz036-drain-types.log`). Full and real-provider integration gates remain outstanding.
- No public enqueue endpoint yet. Telegram items still fail closed pending their transport binding
  integration. Next expose authenticated queue API/client controls and early foreground target
  receipt, then web/CLI/Telegram and restore integration. BAZ-036 is still local and incomplete.

### BAZ-036 authenticated API checkpoint

- Mounted `/api/agents/:agentId/queue` under existing authentication/setup middleware with bounded
  request bodies and no-store responses. Added list/detail, retained input read, enqueue, fresh
  replacement edit, revision-checked remove, pause/resume, Stop and acknowledged reconciliation.
  Policy denial, capacity and stale selection/revision have typed status responses.
- Stop persists pause before aborting; a stale control revision leaves active work untouched.
  Reconciliation closes only an explicitly acknowledged uncertain receipt and leaves the queue
  paused. Retrying its original input returns that terminal receipt and never enqueues it again.
- New-conversation admission now includes durable queue items in the pending-work guard. Added
  typed `client.queue(agentId)` methods, including retained input retrieval for edit recovery.
- 11 authenticated queue/conversation route tests passed, covering unauthorized reads, exact
  retries, retained attachments, New guard, replacement/stale remove, Stop ordering and explicit
  uncertain reconciliation. Root typecheck and changed-file formatting passed
  (`/tmp/baz036-api-tests.log`, `/tmp/baz036-api-types.log`).
- Web and CLI controls are next, including an early foreground target receipt so the very first
  streaming turn can accept correctly targeted follow-ups. Telegram/restore and full integrated
  acceptance remain outstanding. BAZ-036 is not complete or committed.

### BAZ-036 CLI checkpoint

- Added `bazilion queue list|show|add|edit|remove|pause|resume|stop|reconcile`. Mutations require
  observed revisions; uncertain reconciliation requires `--acknowledge`. Add/edit print exact retry
  parameters before submitting. `--files` accepts a bounded JSON array of paths. Text-only edits
  retrieve and preserve retained attachments; explicit `--files '[]'` removes them.
- Disposable daemon CLI integration passed: pause, add with an original filename, exact retry,
  text edit preserving attachment metadata, stale remove rejection, removal and resume. No model
  or external transport was called (`/tmp/baz036-cli-tests.log`). Root and web types passed.
- Added `x-bazilion-conversation-selection` on admitted HTTP chat streams and consume it in the web
  before reading frames. This prepares first-turn busy enqueue targeting; browser verification and
  composer queue integration are still required. Existing gateway forwards this response header.
- Next implement the visible web queue/composer controls, then complete Telegram and restore work.
  BAZ-036 remains incomplete and uncommitted; BAZ-037–038 remain outstanding.

### BAZ-036 web queue checkpoint

- Added the visible follow-up panel with pending/history pagination, status/source/attachment
  metadata, pause/resume/Stop, fresh replacement edits preserving files, removal, explicit uncertain
  acknowledgement and retained-conversation navigation. Busy text/paste/file/drop input remains
  usable and uses the explicit **Queue follow-up** action. Idle input also joins an existing queue.
- Stop now uses the durable pause-first API; a failed Stop does not abort the local response and
  pretend the daemon stopped. Initial metadata/recovery loading preserves drafts until ready.
- IndexedDB retains each request and its attachment bytes before HTTP submission, keyed by attempt
  rather than Agent so separate tabs cannot overwrite each other's recovery record. Reload can
  retry the same immutable request. Clearing one acknowledgement removes only that attempt; saved
  unacknowledged requests keep queue mode active even if their daemon item has already completed.
- Real browser evidence found and fixed delayed admission headers (flush an empty NDJSON line before
  provider output) and a narrow-layout composer clipped by the queue. Chat history now flexes down
  and the queue scrolls within a bounded height, leaving the composer visible.
- Disposable browser scenario passed: first-turn busy enqueue, original attachment metadata,
  reload/edit preserving bytes, intentionally lost HTTP acknowledgement, a second tab's independent
  enqueue, exact retry after reload with no duplicate, and 390px layout/composer bounds. Evidence:
  `/tmp/baz036-web-demo/check-queue.mjs`, `browser-final.log`, `queue-desktop.png`, `queue-narrow.png`.
  This demo uses a local fake provider and disposable `home-v2`; no personal data/external AI.
- 23 relevant route/delivery tests passed (`/tmp/baz036-web-queue-regressions.log`), root/web types
  and diff checks passed. Full integration/security/build gates remain outstanding.
- Remaining BAZ-036: finish Telegram owner/topic/provenance ingress/egress and commands, conservative
  restore reconciliation, fuller race/policy/retention and keyboard/Stop demos, attachment replacement
  UX review and criterion-by-criterion final audit. Update user docs/changeset, then full gates and
  commit/push. The queue is still local and incomplete; BAZ-037–038 remain outstanding.

### BAZ-036 restore checkpoint

- Added an offline staged-home queue recovery mutation to CLI restore, after canonical validation
  and before installation. One FULL-synchronous transaction marks pending/claimed/running/held/
  uncertain input uncertain, increments revisions, and pauses each affected Agent with the
  `restored_backup` reason. Terminal receipts, bytes, captured conversations and approval IDs stay
  intact. Revalidation still runs before publishing the staged home; no daemon runtime import was
  added to the CLI implementation.
- Extended the actual tar backup/restore round trip to prove restored input cannot be claimed or
  resumed, an exact retry returns uncertainty, and original attachment bytes survive. A separate
  captured-approval test proves the restored pending approval cannot pass queue readiness, while
  the source hold remains unchanged.
- All **42 backup regression tests passed** (`/tmp/baz036-backup-full-tests.log`); **13 queue
  approval/delivery tests passed** (`/tmp/baz036-restore-approval-tests.log`). Root typecheck,
  formatting and diff checks passed. Added `docs/follow-up-queue.md` with implemented web/CLI
  controls, limits and restart/restore recovery boundaries.
- Next major work is durable Telegram replacement and exact transport/owner/topic binding, followed
  by remaining queue races/UX audit and full gates. Telegram currently still uses its old in-memory
  queue; its missing-media fallback also needs replacement with explicit non-acceptance rather than
  silently retaining text-only input. BAZ-036 remains incomplete and uncommitted.

### BAZ-036 Telegram binding checkpoint

- Added daemon-internal owner-grant and Agent-topic binding identities to the canonical clean
  schema. Owner metadata updates retain a grant; reset/re-pair creates a different grant even at
  the same clock instant. Each topic assignment rotates its binding, including reassigning the
  same numeric topic. No compatibility migration or new public wire identity was introduced.
- Added capture/revalidation for the exact Telegram transport attempt, paired owner grant,
  current Agent topic binding, current chat and bot credential. The retained digest includes the
  encrypted credential envelope when stored, so removing/re-adding the same stored token also
  invalidates an earlier binding. No plaintext bot credential is persisted in queue provenance.
- 15 binding/storage tests passed (`/tmp/baz036-telegram-binding-tests.log`), including same-time
  owner re-pair, same-topic reassignment, metadata-only owner update, bot rotation/removal and chat
  mismatch. Root typecheck and diff checks passed. Updated canonical backup schema hash to
  `a3b6fae86153d39271fff253c35c810d0a6828d24d9f3d68c45a167e2b37c9d2`; the real backup/restore
  round trip passed again (`/tmp/baz036-binding-backup-test.log`).
- This binding helper is not yet wired into routing/admission or the normal/approved queue drain.
  Next capture it before media download, persist only complete input with canonical queued-user
  holds, replace the old in-memory Telegram queue, and revalidate at final worker admission.
  Telegram controls/notices and final acceptance remain outstanding. BAZ-036 is still incomplete.

### BAZ-036 Telegram integration checkpoint

- Added durable Telegram admission: complete input, attachment bytes and any reference-only
  canonical hold commit together. Binding capture precedes media download; admission revalidates
  owner/Team/topic/credential and exact transport-derived text, names/types and known file size.
  Missing media is explicitly not accepted. Denial during download rolls back input and preserves
  source-owned block evidence. Exact retained attempts return their original receipt.
- Routing now uses this admission instead of enqueueing into the old in-memory map, acknowledges
  durable receipt status, and preserves a prior receipt's captured conversation when resolving a
  repeated Telegram transport attempt. Unsupported empty updates do not create conversations.
  Initial policy denial still precedes media fetching; an approval-required input first retains
  complete bytes and then holds them under the canonical approval reference.
- Normal and approved queue delivery now build the original Telegram invocation/authorization,
  preserving protected execution and automatic shell denial. Final preparation verifies retained
  input against the exact invocation and captures a queued-user reference if policy changes.
  Both paths recheck the Telegram binding immediately before marking the turn running.
- Added topic `/queue` commands for metadata-only list, revision-checked pause/resume/Stop/remove
  and acknowledged uncertainty reconciliation. The paired owner/current topic/chat/credential gate
  is checked independently of broader ACL membership. Stop persists pause before Agent cancellation.
- 60 targeted tests passed (`/tmp/baz036-telegram-integrated-tests.log`), covering routing/admission,
  complete-media holds, policy changes during fetch, conversation capture, owner controls, stale
  Stop and ordinary/approved Telegram invocation. Worker frames remain mocked in dispatch tests.
  Root typecheck, changed-file formatting and diff checks passed.
- Remaining: retire the now-unused in-memory queue implementation/its old tests and update all
  Telegram consumer tests; complete delayed outcome notifications/history and retry/retention
  edge cases; audit keyboard/attachment replacement and cross-story races; run full gates and
  update docs/changeset before commit/push. BAZ-036 is still incomplete and local. BAZ-037–038 remain.

### BAZ-036 retired queue and status notice checkpoint

- Removed the old in-memory Telegram inbound queue and its implementation-specific suite. The
  canonical pending-work guard now reads durable queue state only. Replacement coverage is in
  queue storage, real preparation, routing and durable drain/pump suites: FIFO identities, active
  admission, Agent isolation, failure continuation, busy-code text rejection, exact payload binding,
  restart/restore uncertainty and protected/approval paths. Old behavior that continued after a
  missing turn outcome is deliberately replaced by uncertainty plus pause.
- Added metadata-only best-effort delayed hold/failure/cancellation notices via the active bot's
  paced transport. They carry receipt ID/status, never input text or raw provider diagnostics. Owner,
  Team, topic, credential and receipt revision are rechecked after pacing. A stopped/replaced bot
  or changed binding suppresses delivery. Ten-second request cancellation bounds sends; transport
  failure cannot change the durable queue outcome or replay input. These are control receipts,
  separate from the default-off Attention notifications planned for BAZ-038.
- Added `/queue history [offset]` and help copy. Web/CLI removal of pending Telegram input also
  attempts a captured-topic cancellation receipt. An accepted transport retry bypasses the new-input
  rate counter but must still match the retained receipt. User queue documentation now covers
  Telegram controls and best-effort notice boundaries.
- 74 replacement queue/conversation tests and 30 broader Telegram consumer tests passed. Notice
  tests cover metadata-only failure output, transport failure and rebinding while waiting to send.
  Root typecheck and diff checks passed. The full repository suite completed successfully:
  **1283 tests passed, 3 skipped; 158 files passed, 1 skipped** in 70 seconds
  (`/tmp/baz036-full-first.log`, completed exec session `94010`). Its production web build passed.
- Remaining BAZ-036: full-suite failures if any, final story acceptance/keyboard/attachment audit,
  security/type/lint/build gates, docs/changeset and commit/push. BAZ-037 and BAZ-038 remain unfinished.

### BAZ-036 local acceptance audit

| Criterion | Evidence |
| --- | --- |
| 1. Durable mixed ingress and serialized FIFO | Real HTTP/CLI admission, Telegram routing, shared SQLite positions, and dispatcher tests retain distinct inputs while the existing Agent registry is busy. Pump and approved dispatch tests preserve the single admission boundary. |
| 2. Reload/restart and exact identity | Browser lost-response interception followed by reload and exact retry retains one receipt; a second tab retains its separate request. Storage reopen/recovery and real backup round-trip preserve original files and conversation identity. |
| 3. Edit/delete versus claim and approval | Transactional revision checks reject stale edits/removals; replacement receives a new authenticated attempt at the same position. Held input is immutable and its canonical approval retains dispatch ownership. |
| 4. Pause/Stop/uncertainty | Route and dispatcher tests prove pause-before-cancel, saved pause, and rejection of Resume while uncertainty exists. Restore pauses unresolved work and canonical approval cannot dispatch it. |
| 5. Revalidation and visible failure | Real preparation and binding tests reject changed policy, membership, owner grant, topic, credential and retained attachment bindings. Invalid input never becomes a text-only turn. Preflight failure records a bounded outcome without starting a worker. |
| 6. Canonical approval and active-Agent admission | Approval readiness rejects paused/non-head items before claim; duplicate delivery fails. Both dispatch paths recheck authority after waiting for existing registration, and a missing final outcome pauses instead of replaying. |
| 7. Cross-client status truth | Authenticated API/CLI, Telegram controls/history and polling web panel expose the same daemon receipts. Completion is a turn outcome; best-effort Telegram receipt delivery cannot change it. |

- Fresh current-schema disposable demo `/tmp/baz036-web-demo/home-v3` passed keyboard Edit,
  Tab through attachment removal to Save, and Enter submission. The browser also passed busy
  enqueue, original filename/bytes, reload and replacement, two-tab lost-acknowledgement recovery,
  and 390px composer/overflow checks (`/tmp/baz036-web-demo/browser-v3.log`). Web edits preserve
  or remove files; CLI/API can replace the file set. This satisfies pending-payload editing without
  adding a second upload composer to the queue panel.
- Full suite passed **1283 tests, 3 skipped** before two additional adversarial tests. The updated
  binding/delivery suites then passed **27 tests**, including the added identity/payload and actual
  protected-preflight-to-notice cases (`/tmp/baz036-security-replacements.log`). Required security
  case IDs were retained and mapped from the removed in-memory implementation to these durable
  tests; **all 60 required adversarial cases passed** (`/tmp/baz036-security-final.log`).
- Root, web and mobile typechecks passed. Lint passed with warnings (no errors), production web
  build passed within security acceptance, package build passed, and `git diff --check` passed.
  Canonical schema/backup hash is unchanged from the verified Telegram binding checkpoint.
- Reconciled story baseline, added CLI quickstart entry and a pending minor Changeset. The story
  remains `in_progress` because the release is unshipped. Next commit/push this checkpoint and check
  its CI, then implement BAZ-037 and BAZ-038; the four-story goal remains active.
