# BAZ-035–038: conversation and operator interaction milestone

Target: draft [PR #44](https://github.com/rullopat/bazilion/pull/44), branch `release/0.15.0`.
BAZ-034 is preserved. Completion requires all four full first-slice contracts, integration evidence,
commits/push and passing final CI. Merge, versioning, publication and deployment are excluded.

## Checkpoints

- [x] Refine shared contracts and each story's open questions against current code.
- [x] BAZ-035: retained conversations and safe explicit targeting (0af1061, CI passed).
- [x] BAZ-036: durable follow-ups across web/CLI/Telegram (fa126ac, CI passed).
- [x] BAZ-037: correlated live clarification across supported human clients (6e37e77, CI passed).
- [x] BAZ-038: opt-in notifications for existing Attention sources (4f34efc, CI passed).
- [x] Integrated acceptance, security, client demos and full checks (4f34efc, CI passed).
- Final documentation SHA and PR checklist are verified against GitHub after this ledger is committed.

## Current status

BAZ-034 through BAZ-038 shipped in [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0)
on 2026-09-08. PR #44 delivered implementation and guided UI fixes; PR #45 versioned the three public
packages together. Both passed CI before merge, followed by successful npm publication and independent
published-package verification. The stories now live in `done/`; earlier checkpoint notes below are
historical. The initial goal excluded publication; the operator authorized this release separately.

## Starting evidence (historical)

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

## Initial refinement questions (resolved in the checkpoints below)

- Question policy delivery/answer attempt mapping, approval dispatch hooks and retention limits.
- Notification source-to-policy mapping, destination generation, mirror correlation and restore
  detection that distinguishes restoration from a normal restart.

## Validation ledger

The following entries preserve the chronological implementation evidence. Incomplete-state notes
describe those earlier checkpoints; the current status above supersedes them.

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

### BAZ-036 PR checkpoint and BAZ-037 foundation

- Committed and pushed BAZ-036 as **fa126acbdd315ccb6208da0bee7b69be1bd6ab3b**. Verified the
  remote `release/0.15.0` SHA equals this local commit. PR #44 remains draft, with BAZ-034–036
  checked and BAZ-037–038 plus integrated final validation still outstanding.
- CI **34140914898** completed successfully at this SHA. Local full-suite/security/build evidence
  remains above. Automatic push review initially required proof of destination ownership; verified
  origin and GitHub's non-fork PR head matched `rullopat/bazilion` / `release/0.15.0`, after which the
  same push was approved. No alternate destination or approval bypass was used.
- Refined BAZ-037 against trusted invocation, final preparation, canonical approval planning,
  worker IPC lifetime, the single CLI readline owner and pinned Pi persistence ordering. Moved the
  story to `in_progress` and reconciled backlog counts. Full contract decisions are in the story.
- Added hermetic question/answer/status types and daemon content validators: bounded UTF-8 prompt,
  choices and text, normalized duplicate-choice rejection, exact answer conversation and UUID,
  explicit Skip, and rejection of model-supplied authority fields. Three focused contract tests
  passed (`/tmp/baz037-input-tests.log`); root typecheck and changed-file Biome checks passed.
- This is only the BAZ-037 input foundation. No question schema, live registry, IPC tool, approval
  release, HTTP/client methods, Telegram correlation or user controls exist yet. Next implement
  bounded durable records and a turn-bound live host, then wire policy-owned delivery/answers,
  transcript-backed consumption evidence and supported clients. BAZ-038 remains unimplemented.

### BAZ-037 durable state and live waiter checkpoint

- Added canonical `agent_questions` storage with exact Agent/conversation/turn/tool identity,
  bounded question and private binding data, one pending question per turn, answer request identity,
  terminal reason and separate continuation evidence. Per-turn/home capacity rejects excess input.
  Terminal pruning preserves pending records and canonical approval references.
- Answer settlement is transactional: one response wins, identical UUID/content retries return
  its receipt, conflicting/late replies return authoritative state, and deadline expiry never
  synthesizes the recommended choice. Recording an answer leaves consumption unconfirmed.
- Startup closes prior pending questions and marks unconfirmed continuation interrupted. Offline
  staged restore applies the same conservative closure with `restored_backup`; accepted answer
  data remains inspectable. Canonical schema hash is now
  `d851dad8face6ba127c41d55bd59326c2d1e2083ee2e2502675eb29181ac2abd`.
- Added a process-local `QuestionWaiters` registry. Durable settlement wakes its one live waiter;
  merely observing a still-pending approval hold cannot wake it. Deadlines, cancellation, worker
  loss, already-aborted signals and wrong-Agent wake attempts are covered. This registry does not
  authorize answers or advertise a worker capability; those boundaries still require integration.
- **13 foundation tests passed** (`/tmp/baz037-foundation-tests.log`), including competing replies,
  exact retry, no premature consumption, expiry, interrupted continuation, retention and an actual
  staged SQLite restore preserving the source. **59 backup/queue approval regressions passed**
  (`/tmp/baz037-backup-regressions.log`), plus **9 bootstrap/identity tests**
  (`/tmp/baz037-bootstrap-tests.log`). Root typecheck, changed-file formatting and diff checks passed.
- BAZ-037 remains local and incomplete. Next add the live turn-bound policy host, canonical
  question delivery/answer approval plans, narrow worker IPC/tool selection, transcript-backed
  consumption acknowledgement, authenticated API/client operations, web/TTY/Telegram interactions
  and explicit mobile fallback. BAZ-038 remains unimplemented; the four-story goal stays active.

### BAZ-037 policy approval ownership checkpoint

- Added delivery acknowledgement metadata and immutable proposed replies to question storage.
  Proposed input is not an accepted answer. Delivery and proposal digests bind the original
  Agent/Team/conversation/turn/tool tuple, normalized content and private daemon-owned route.
- `authorizeQuestionBoundary` now uses the existing Agent egress/user ingress authorizer to
  atomically capture reference-only `question_delivery` / `question_answer` holds and link their
  canonical owner. Denial retains shared block evidence; link/storage failure rolls the hold back.
  An already-held boundary stays owned by that approval even if policy subsequently allows it.
- Closed approval tuple validation checks payload keys/digest, source and target, Team, channel,
  operation, origin, attempt identity and linked approval ID. The repository requires the matching
  canonical `delivering` claim before releasing held delivery or settling its exact answer.
  A competing answer cannot substitute content, and accepted answers remain unconfirmed until
  separate transcript-backed consumption evidence exists.
- **20 question contract/storage/waiter/policy tests passed** (`/tmp/baz037-policy-tests.log`),
  including real canonical claim/finish ownership, altered metadata, policy denial, duplicate and
  conflicting proposals, rollback and a maximum-size escaped answer. Root typecheck and diff
  checks passed; changed production files pass Biome. The actual backup/restore round trip passed
  again (`/tmp/baz037-policy-backup.log`, one selected test; 41 filtered tests not run).
- Canonical schema hash is now
  `7c8945acd53f7e1d239e8c3438be5b0754b3e3912b32fde93d1ba3f352f13714`.
- These helpers are not yet wired into the shared approval plan/router or live worker host.
  Next connect the prepared-turn response route, waiter readiness/deadline revalidation and
  canonical dispatcher; then IPC/tool selection, transcript consumption evidence and clients.
  BAZ-037 remains incomplete and uncommitted; BAZ-038 remains unimplemented. Goal remains active.

### BAZ-037 prepared route, live host and canonical dispatch checkpoint

- Added explicit authenticated foreground `questionMode` to chat preparation, separate from shell
  approval mode. The prepared immutable route excludes unsupported clients and queued HTTP;
  Telegram derives its captured owner/topic/credential binding, including canonical queued approval
  delivery. Missing optional Telegram response configuration does not change normal turn admission.
- Added `QuestionService`, attached only to a nominal prepared turn and its exact active-Agent
  controller. A second host cannot attach to that turn. Replacing an Agent registration cannot take
  over the old question. The service owns live waiters, delivery authorization, reply admission and
  canonical approval release; it never starts another worker. Persisted Telegram route metadata
  excludes the original inbound text/media, avoiding a second input copy or a large-message limit.
- Integrated typed question plans and readiness checks into the existing approval router. Its
  canonical claim remains the only owner of held delivery/answers. Expiry, worker loss, changed
  membership/route or changed policy prevents release; approval cannot revive a closed question.
  An answer stays unconfirmed after settlement until the still-outstanding transcript verification.
- **61 tests across seven files passed** (`/tmp/baz037-service-integrated.log`): real prepared-turn
  host settlement, exact-registration rejection, immutable routes, queued HTTP exclusion, canonical
  HTTP approval dispatch for both directions, closed-turn rejection, and existing approval/storage
  regressions. Root typecheck, changed-file formatting and diff checks passed.
- BAZ-037 still needs worker IPC/tool selection and actual attachment in `runAgentTurn`, durable
  transcript consumption acknowledgement, authenticated question API/client, web/TTY controls,
  Telegram transport/correlation and mobile fallback. Also audit eager closure on policy/route
  changes while no response request arrives, terminal card read authorization, and delivery failure
  outcomes across paced transport. No question tool is advertised yet. BAZ-038 remains unimplemented.

### BAZ-037 worker IPC and tool selection checkpoint

- Added content-only `askUser` IPC, with exact outer request keys and the adapter's real tool-call
  ID. The daemon's bound host supplies Agent/Team/conversation/turn/route identity. Unsupported
  calls and forged outer authority fields cannot reach a host. A worker capability flag requires
  its matching host; restricted review rejects the host and input field.
- Added `ask_user` to configured/protected Pi tools only when that capability is present. The
  prompt explicitly treats answers as information, not permission, and handles typed no-answer.
  The protected tool test verifies that adding clarification changes only this one tool.
- `runAgentTurn` now attaches the eligible prepared route's service host. Spawn subscribes to its
  authorized `agent_question` events, and closes/unsubscribes on IPC lifetime end; turn cleanup
  also closes the host. The existing Telegram mirror ignores this event because the dedicated
  question transport must own its buttons and correlation. No Telegram question transport exists yet.
- Added a real disposable worker fixture for valid, forged and unsupported requests, streamed
  daemon question events and lifetime cleanup. **43 tests in five files passed**
  (`/tmp/baz037-ipc-tests.log`), including existing protected/review/real preparation regressions.
  Root/web/mobile typechecks and diff checks passed. Native state now shows an explicit unsupported
  question notice; its dedicated state test passes, but clickable web handoff remains outstanding.
- Remaining before BAZ-037 acceptance: canonical transcript-backed consumption acknowledgement;
  gate question content in tool traces, completed-frame projections and recovered history as well
  as cards (do not let raw ask_user arguments bypass a held delivery); authenticated list/detail/
  response and client contracts; web/TTY interaction and reload/retry; Telegram prompt/callback/
  free-text correlation; eager invalidation while nobody responds; full mobile handoff and demos.
  The web/CLI still do not advertise questionMode, and no user-facing question workflow is complete.
  All BAZ-037 work remains local/uncommitted. BAZ-038 remains unimplemented; goal stays active.

### BAZ-037 consumption proof checkpoint

- Worker acknowledgement now waits until after Pi's synchronous transcript append. A private
  `questionConsumed` IPC call carries only question/tool-call IDs; the live daemon host checks
  its exact active registration, originating turn and conversation before marking consumption.
  Failed acknowledgement leaves the accepted outcome unconfirmed.
- The bounded canonical transcript reader verifies the saved ask_user call and exact structured
  result. Acceptance alone, a call without its result, a substituted question/answer, wrong
  conversation, out-of-order result and duplicate result cannot establish consumption. This
  verifier does not itself mutate the receipt.
- Eight targeted transcript/worker tests passed, including the acknowledgement IPC round trip
  (`/tmp/baz037-consumption-final.log`). Two sandbox runs failed because the disposable worker
  received empty stdin; the same tests passed outside the sandbox, then passed again after adding
  explicit acknowledgement assertions. No external services or personal state were used.
- Still audit turn-scoped transcript offsets for repeated provider tool IDs and real Pi append
  ordering end to end. This checkpoint does not close consumption acceptance. All earlier
  content-visibility, API/client, web/TTY/Telegram, lifecycle and demo work remains outstanding;
  BAZ-037 is local and BAZ-038 remains unimplemented.

### BAZ-037 turn boundary and question API checkpoint

- The live host captures the canonical transcript entry boundary before worker spawn under the
  exclusive Agent registration. Consumption verification ignores earlier turns, allowing repeated
  provider tool-call IDs while rejecting old results as proof for the current question. A dedicated
  regression covers both directions. Real Pi end-to-end append ordering still needs demonstration.
- Added authenticated Agent question list/detail/answer routes under the existing application
  middleware and typed client methods. Responses use no-store; answer bodies are bounded to 32 KiB,
  strictly parsed, and bind the question's conversation plus immutable request UUID. List results
  are bounded to the latest 100, optionally filtering the conversation before applying the limit.
- Read visibility requires actual prior delivery, unchanged Agent/Team ownership, and current
  shared policy authorization. An approval-required edge additionally needs the source's canonical
  delivery approval with matching policy evidence. Reads do not create competing delivery attempts.
  Held questions remain absent from list/detail; their existing approval is the pending surface.
- Integrated route tests exercise hidden holds, approved reload, wrong-conversation rejection,
  held answers, canonical approval dispatch, identical retry, competing answer conflict, and
  policy-edge removal preventing a later read. Root typecheck passed; 20 tests in storage,
  consumption and preparation/API suites passed (`/tmp/baz037-question-api-final.log`).
- Outstanding: question content in generic tool traces/completed frames/history still needs its
  visibility gate and retention design; these API checks do not establish that broader boundary.
  Web/TTY controls, Telegram transport/correlation, eager lifecycle invalidation, native handoff,
  real Pi/browser demos and final gates remain. BAZ-037 stays local/uncommitted, BAZ-038 stays
  unimplemented, and the full four-story PR goal remains active.

### BAZ-037 web card checkpoint

- Added the Agent question panel to ChatPane. It polls the authorized API without cache, keeps
  pending/unconfirmed outcomes visible, and puts settled history in a disclosure. Cards show
  their originating conversation and distinguish acceptance, consumption and task completion.
- Controls use labelled native radios, Other text, explicit Send and Skip, expiry information
  and the existing Button component. Recommendations are labelled but never selected/submitted
  automatically. Answer submission retains its exact UUID and input in per-tab session storage
  before sending; reload can retry that same input. A held answer freezes editing and links to
  communication approvals. Terminal polling removes saved recovery data.
- Isolated Chromium verification bundles the actual component and serves a fake loopback API:
  `/tmp/baz037-card-demo/entry.tsx`, `check.mjs`, `check-verified.log`. Keyboard choice and submit,
  unavailable acknowledgement, reload, exact request replay, a single accepted/unconfirmed
  outcome, and absence of browser runtime errors passed. Chromium transparently retried the
  original socket-drop fixture with the same UUID; the explicit 503 fixture exercises manual
  recovery deterministically. This fixture excludes full application CSS and real worker/auth
  integration, so it is not the final desktop/narrow release demo. Web typecheck passed.
- Web questionMode intentionally remains unadvertised until question content in generic tool
  traces, completed frames and saved history obeys delivery policy. TTY/Telegram, eager lifecycle
  closure, native handoff and final integrated demos/gates remain outstanding. All BAZ-037 work
  stays local and the full goal remains active.

### BAZ-037 CLI commands and prompt checkpoint

- Added `bazilion question list <agent> [--conversation <id>]`, `show <agent> <question>`,
  and `answer <agent> <question>` with exactly one of `--choice <1-based number>`, `--text`,
  or `--skip`. Output is JSON. New answers print their UUID and captured conversation to stderr
  before submission; exact retries require both `--request-id` and `--conversation` plus the
  identical answer. A recommendation never becomes an implicit selection.
- The real CLI/server fixture verifies hidden unreleased questions, released reads, accepted
  retry reconciliation without a waiting worker, changed-answer conflict, and rejection of a
  retry missing its original target. Three tests passed in the command/input suites
  (`/tmp/baz037-cli-question-integration.log`).
- Added a sequential question prompt and attached it to the existing TTY readline owner in
  both one-shot and interactive chat. It renders escaped terminal text, handles explicit Other
  and Skip, and aborts readline on question expiry. EOF or expiry submits nothing. Stream handling
  deduplicates question IDs and reports held versus accepted outcomes; a lost acknowledgement
  prints exact manual-retry identity. Piped input does not acquire this prompt.
- Twenty-two prompt/input/existing shell-approval tests passed
  (`/tmp/baz037-cli-prompt-final.log`); final root typecheck passed
  (`/tmp/baz037-cli-final-types.log`), and Biome passed on the touched CLI files. A real PTY/provider
  end-to-end prompt demonstration is still required. CLI questionMode remains unadvertised,
  alongside web, until the common tool-trace/history visibility boundary is complete.
- BAZ-037 remains local/uncommitted. Telegram, history visibility/retention, eager lifecycle
  invalidation, native handoff, integrated demos and final gates are still required; BAZ-038
  remains unimplemented. The objective and completion boundary are unchanged.

### BAZ-037 proactive lifecycle checkpoint

- Each waiting question now owns a one-second, unref'ed recheck alongside its existing deadline.
  It revalidates exact turn ownership, Agent/Team/conversation and Telegram route availability,
  then checks both shared policy directions without creating another authorization attempt.
  Removed edges, changed captured approval policy, and denied/cancelled/expired/failed approval
  holds settle as typed no-answer. Final settlement clears the recheck timer.
- Added real prepared-turn tests using fake time for policy removal, approval denial and
  replacement of the owning Agent registration without any later response request. Each proves
  cancellation, interrupted continuation and zero remaining timers. Sixteen lifecycle/waiter/
  preparation tests passed (`/tmp/baz037-lifecycle-tests.log`), and root typecheck passed
  (`/tmp/baz037-lifecycle-types.log`).
- Still reconcile the linked approval's own expiry/cancellation metadata with source closure;
  dispatch already rejects a dead waiter, but a pending approval should not remain presented as
  actionable after its question dies. Telegram transport must also bound paced delivery so an
  unresolved send cannot retain the ask invocation beyond its waiter. History visibility/retention,
  Telegram correlation, native handoff, full demos and gates remain required. No BAZ-037 changes
  have been committed/pushed; BAZ-038 remains pending and the goal stays active.

### BAZ-037 source-owned approval lifetime checkpoint

- Question delivery and answer holds now pass the immutable question deadline through the shared
  communication boundary. The canonical approval repository caps its usual TTL at that deadline;
  a source cannot extend the normal lifetime. Expired holds cannot reach delivery revalidation.
- Question closure, turn loss and startup recovery now retire linked pending question approvals
  through canonical cancellation and audit events in the same transaction. Already delivering or
  terminal approvals retain their existing owner/state. Repeated cleanup produces one cancellation
  event. An injected audit failure proves question and approval state roll back together.
- Offline staged restore mirrors this narrow pending-question cancellation and event within its
  existing SQLite transaction, without importing daemon runtime. Restoring twice preserves one
  event and leaves the source database's live question/approval untouched.
- Thirty question/storage/live-service tests passed (`/tmp/baz037-approval-restore-tests.log`),
  then the final question-approval suite including rollback passed
  (`/tmp/baz037-approval-final-tests.log`). Thirty-two existing approval storage/planning tests
  passed (`/tmp/baz037-generic-approval-regressions.log`). The actual fresh-home backup restore
  passed (`/tmp/baz037-approval-backup-roundtrip.log`, one test with 41 filtered out).
  Root typecheck passed (`/tmp/baz037-approval-restore-types.log`); diff checks passed.
- Remaining major BAZ-037 work is shared tool-trace/history visibility with durable provenance,
  bounded Telegram delivery and exact reply correlation, native handoff, enabling eligible clients,
  integrated provider/PTY/browser demonstrations and full final gates. BAZ-038 is still pending.
  No release or PR completion is claimed; these changes remain local and the goal remains active.

### BAZ-037 retained-history provenance checkpoint

- Added a bounded opaque HMAC receipt for exact settled question results that were actually
  released. It binds Agent, Team, conversation, tool-call, question, delivery time, result digest
  and any canonical delivery-approval policy evidence. Undelivered questions cannot obtain proof;
  substituted results and changed signatures are rejected. Verification alone grants no new
  delivery: history consumers must still check current identity and policy.
- The daemon's private singleton `question_receipt_key` table holds one 32-byte signing key. It
  is outside configuration/secrets environment merging, remains stable across credential changes,
  and is included in canonical backup schema. The clean-install schema and manifest now hash to
  `6140f67b8098d86abe3b85b9eb801ba0ef97a02ad9e6bd62aaccbfbad60b5943`.
- The live host signs only after waiter settlement. The ask_user adapter removes the receipt from
  provider-facing text and places it in Pi tool details. Canonical question/answer text remains
  unchanged, preserving consumption verification. Tests prove receipt verification after receipt-
  record pruning and offline staged restore, foreign-home rejection, and no signing-key export
  through merged provider environments. Twenty receipt/consumption/preparation tests and root
  typecheck passed (`/tmp/baz037-receipt-final-tests.log`, `...final-types2.log`).
- Still wire verified provenance into every public history projection and suppress raw question
  arguments/results in generic live/done tool output. This checkpoint creates evidence; it does
  not yet close that visibility boundary or enable client questionMode. Telegram, native handoff,
  integrated demos and final gates remain. BAZ-038 remains pending; BAZ-037 remains local.

### BAZ-037 live and retained question visibility checkpoint

- Generic Pi tool-call arguments and tool results now withhold ask_user content. The public
  ProviderMessage projection hides unsigned question results by default, including worker done
  frames and review excerpts. The daemon independently sanitizes worker stdout, strips question
  images/results, rejects worker-created question cards, and omits malformed raw frame bytes from
  diagnostics. Authorized daemon host events remain the sole card source.
- Selected-conversation, retained-conversation and BAZ-034 source-conversation reads verify the
  signed tool details against exact result bytes, Agent, Team, conversation and tool-call identity,
  then check current shared policy. Approval-required reads need matching signed approval policy
  evidence. This works after domain-record pruning; unsigned, foreign, substituted or currently
  denied content stays hidden. Question text remains available inside the authorized saved result.
- HTTP card emission refreshes the canonical question and rechecks current visibility immediately
  before delivery, without creating a second approval. Thirty-one focused history/frame/worker/
  conversation/live-preparation tests and root typecheck passed
  (`/tmp/baz037-history-final-tests.log`, `...types-final2.log`).
- Enabled questionMode in web chat and in CLI streams only when the shared TTY prompt exists.
  Piped/native consumers do not acquire that capability. Focused web/shell-approval/worker checks
  and web typecheck ran after enabling; see `/tmp/baz037-question-enable-tests.log` and
  `/tmp/baz037-question-enable-web-types.log` for results. Real provider/PTY/browser end-to-end
  evidence remains necessary; these tests alone do not prove Pi persisted details or the complete
  user workflow. Telegram transport/correlation, native handoff, final gates and BAZ-038 remain.
  All BAZ-037 work remains local and the goal is active.

### BAZ-037 Telegram transport and correlation checkpoint

- Installed a live-bot question transport and made it the default optional Telegram route for
  the question service. It sends bounded plain-text prompt chunks and a final numbered choice/
  Other/Skip keyboard. Every paced send and 429 retry rechecks live bot, owner grant, topic binding,
  Team, question lifetime and canonical delivery authorization. Sends receive a ten-second abort
  bound; whole delivery is bounded by question expiry and turn cancellation. Queued callbacks
  recheck before acting, so an aborted delivery cannot send after pacing unblocks.
- A bounded per-home live prompt cache binds the final message ID to the original question and
  transport identity. Buttons, exact replies to that final message, and explicit `/answer <id> text`
  route before ordinary queue admission. Other buttons only explain the reply method. Wrong owner,
  topic, prompt, changed binding, stale/unknown IDs and malformed question callbacks are rejected.
  Callback/message identity derives a stable response UUID; ordinary unrelated text remains normal
  follow-up input. The service still owns policy, approvals and single settlement.
- Thirteen transport/queue-binding checks passed, then 36 maximum-size/router regressions passed
  (`/tmp/baz037-telegram-question-tests.log`, `...question-router-tests.log`). The final five focused
  transport tests also prove a stale correlated reply is handled by the real router without adding
  any queue item (`/tmp/baz037-telegram-question-final-tests.log`). Final root typecheck and diff
  checks passed. Every send used a fake API; no Telegram messages were sent externally.
- Still exercise actual live Telegram prepared-turn settlement and held-answer release, expiry/
  partial-send/uncertain-send outcomes and user-facing terminal prompt feedback end to end. Native
  handoff, real provider/PTY/browser demos, all final gates and BAZ-038 remain required. BAZ-037
  remains local/uncommitted and the full objective remains active.

### BAZ-037 native handoff and real worker checkpoint

- Native question notices now carry their originating Agent and expose an accessible Open web
  chat link. The URL helper accepts only the paired exact HTTPS origin (or loopback HTTP for
  development), rejects credentials/path/query/fragment injection and non-UUID Agent paths, and
  never includes a device bearer. The browser performs its own login. Native requests still do
  not advertise questionMode. Fourteen native state/handoff tests and mobile typecheck passed
  (`/tmp/baz037-native-handoff-tests.log`, `...handoff-types.log`).
- Added `scripts/check-question-flow.mts`, runnable with
  `node --import tsx scripts/check-question-flow.mts`. It creates fresh disposable state, chooses
  ephemeral loopback ports, runs real daemon/Pi worker subprocesses against a local provider
  simulator, and submits choice, Other text and Skip through the authenticated question API.
  All three prove actual persisted consumption and authorized retained history. The provider
  deliberately reuses a tool-call ID across turns; generic done output contains no question text.
  The repository check passed (`/tmp/baz037-e2e/repository-check.log`), preserving its fixture home
  path in output for inspection. No real provider or Telegram traffic was used.
- This proves Pi preserves signed tool details and the daemon's consumption acknowledgement
  ordering for real workers. It does not replace desktop/narrow browser or real PTY interaction
  evidence, nor live Telegram prepared-turn/approval integration. Those, final documentation/
  changeset/gates and BAZ-038 remain. A first full repository regression run has been started;
  inspect its actual completion before claiming it passed. All BAZ-037 work remains local.

- Full-run completion: `pnpm test` exited successfully with **1,347 passed and 3 skipped**
  across 171 passed files and one skipped file (`/tmp/baz037-full-tests-first.log`). The final root
  typecheck also passed (`/tmp/baz037-full-root-types.log`). This is the current integration
  baseline, not final release signoff; remaining acceptance demonstrations and BAZ-038 still apply.

### BAZ-037 Telegram settlement and security checkpoint

- Telegram settlement now schedules a best-effort edit of the exact captured final prompt,
  removing the inline keyboard and showing minimal accepted/skipped/no-answer status. It includes
  no answer payload, states that consumption/task completion are separate, and rechecks current
  policy and route after outbound pacing. Failed or revoked-route edits do not change the durable
  outcome and never restart a question.
- Added a real trusted Telegram prepared-turn/service/router integration with fake protected
  preflight and transport. Repeated callbacks create one held answer, canonical approval releases
  it to the same waiter, the queue stays empty, and the final prompt updates. Nineteen focused
  integration/transport tests passed (`/tmp/baz037-telegram-live-approval-tests.log`); root typecheck
  passed (`/tmp/baz037-telegram-live-types.log`). This is live continuation/approval evidence,
  not a claim of testing a real Telegram service or real Docker execution in this fixture.
- `pnpm security:acceptance` passed all **60 required adversarial cases**
  (`/tmp/baz037-security-acceptance.log`). `pnpm lint` exited successfully with 55 warnings and
  three informational diagnostics (`/tmp/baz037-lint.log`). Later settlement changes passed their
  focused tests; final release gates must cover the eventual complete PR head.
- Remaining BAZ-037 work includes full browser desktop/narrow and real PTY demonstrations,
  transport fault acceptance, final documentation/changeset and commit/push/CI. BAZ-038 remains
  pending. The full goal is active, and BAZ-037 remains local/uncommitted.

### BAZ-037 browser, terminal and transport fault acceptance

- Full styled browser acceptance passed against a disposable daemon and real Pi workers with a
  loopback model simulator: desktop 1365px, reload while pending, 390px native-radio keyboard
  selection and keyboard submission, no horizontal overflow, persisted consumption, and no page
  errors. Inspected desktop and narrow screenshots for readable labels, visible focus, explicit
  selection and usable controls. Evidence: `/tmp/baz037-browser/check-ready.log`,
  `desktop-pending.png`, `narrow-selected.png`, and `narrow-consumed.png` in that directory.
- An actual PTY CLI one-shot chat selected Other, submitted free text, displayed the accepted
  acknowledgement, exited successfully, and the daemon confirmed consumed continuation.
  Repeatable local harness and transcript: `/tmp/baz037-browser/pty-check.py` and
  `/tmp/baz037-browser/pty-transcript.log`. Credentials were disposable and were not printed.
- Nine Telegram transport tests passed (`/tmp/baz037-telegram-fault-tests.log`), including partial
  delivery/socket timeout without automatic resend or answer binding, destination revocation
  before a 429 retry, and expiry while queued with no later send. All use fake transport APIs.
- Added `docs/questions.md` for operator controls, exact retries, lifecycle meaning and the checked-in
  disposable real-worker demo. BAZ-037 still needs final criterion reconciliation, changeset,
  integrated gates and commit/push/CI. BAZ-038 remains pending; the full goal stays active.

### BAZ-037 final local checkpoint

- Final full suite passed: **1,352 passed, 3 skipped**, 171 passing files
  (`/tmp/baz037-full-tests-final.log`). Root/web/mobile typechecks passed
  (`/tmp/baz037-final-{root,web,mobile}-types.log`). Lint passed with 55 warnings and three
  informational diagnostics (`/tmp/baz037-final-lint.log`).
- All **60 required security acceptance cases** passed (`/tmp/baz037-final-security.log`),
  including its production web build. Package/release builds passed serially afterward
  (`/tmp/baz037-final-build.log`). Fresh disposable browser/PTY home inspection confirmed
  `schema_migrations` contains only `0001_init`. Diff whitespace checks passed.
- Added a pending minor Changeset for the fixed public package group and reconciled the story's
  acceptance evidence. BAZ-037 is ready for commit/push and CI; it remains unshipped.
  BAZ-038 and final integrated PR acceptance remain required by the active goal.

### BAZ-037 pushed checkpoint and BAZ-038 foundation

- BAZ-037 committed/pushed as `6e37e77f4a9340253ef911b2803a9e33277e52f7`; local and remote
  SHA matched and the worktree was clean before BAZ-038 started. PR #44 remains draft and its
  body now includes BAZ-037. CI run **34149793100** completed successfully, including typecheck,
  tests, build and publishable tarball verification. BAZ-037 remains unshipped.
- Read the complete BAZ-038 story and existing Attention projection, shared authorizer, Telegram
  activation/preflight, destination binding and mirrors. Moved BAZ-038 to in_progress and resolved
  destination, approval recursion, first-enable/re-enable cutoff, quiet hours, receipt bounds,
  ambiguous-send retry, restore pause and mirror-overlap decisions in its refined contract.
- Added hermetic notification settings/preview/receipt/retry types; actual-instant IANA quiet-hour
  evaluation; read-only Agent-to-user policy authorization that suppresses approval-required paths
  without creating approvals; and escaped, deterministic metadata-only templates with canonical
  private-gateway links or non-link guidance. No source diagnostics or source-supplied URLs enter
  the message. These helpers are not yet wired into a live dispatcher.
- Seven focused tests passed (`/tmp/baz038-foundation-tests.log`): overnight and DST quiet windows,
  invalid zones, policy/membership suppression, no approval recursion, all five templates and
  credential/loopback-link rejection. Root typecheck passed (`/tmp/baz038-foundation-types.log`),
  focused Biome checks and diff checks passed.
- Remaining BAZ-038 work: durable bounded storage and deduplication; live destination readiness;
  preview-bound management, authenticated API/client/CLI/web; paced dispatch and uncertainty;
  staged restore pause; full acceptance tests and desktop/narrow demos; documentation/changeset;
  integration gates, commit/push and final PR CI. The full goal remains active.

### BAZ-038 durable settings, receipt ownership and recovery

- Added canonical `notification_settings` and `notification_receipts` tables and bounded indexes to
  `0001_init.sql`; updated backup object validation and schema hash to
  `623be2fe7e0427ada3c7af7f6b6f74751c391c2f75ec13e79d537d0d2609b41b`.
  No compatibility migrations were added.
- The daemon repository supplies default-off settings with optimistic revisions, private captured
  destination binding, source/destination deduplication, bounded cursor pages and oldest-first
  pending dispatch. One sender can claim a receipt; settlements bind its attempt number so a late
  prior acknowledgement cannot overwrite a newer retry. Fixed diagnostic codes exclude source/API
  payloads. Public settings/receipts omit owner grant and credential digest internals.
- A 100,000-receipt cap rejects new admission without evicting confirmed deduplication keys.
  Uncertain/failed retries require an explicit possible-duplicate acknowledgement and exact current
  receipt version. Settings disablement/new destination/fresh cutoff suppress deferred receipts.
- Ordinary daemon startup changes sending receipts to uncertain, preserving confirmed deliveries.
  Offline staged restore always sets a notification pause (even without a prior settings row),
  makes sending receipts uncertain and suppresses deferred records. The source database remains
  unchanged. Live dispatch and management still need to enforce this state before sending.
- Twenty-six storage/question/approval regression tests passed
  (`/tmp/baz038-storage-regressions.log`), including capacity, claim ownership, explicit retries,
  old-snapshot restore, stable pagination and oldest-first selection. The actual CLI fresh-home
  backup/restore test passed (`/tmp/baz038-schema-backup-test.log`; 41 unrelated tests filtered).
  Root typecheck and focused Biome checks passed (`/tmp/baz038-storage-types.log`,
  `/tmp/baz038-storage-lint.log`); diff checks passed.
- BAZ-038 is local/uncommitted and incomplete. Next: destination readiness and service binding,
  preview-bound settings/API/client/CLI/web, paced dispatch with current-source checks, failure
  handling and complete restore reconciliation. Full integration gates and final PR CI remain.

### BAZ-038 Telegram binding, dispatch and explicit inclusion controls

- Added a transport bound to the current daemon, owner grant, bot credential digest, configured
  chat and service topic. The live bot verifies private supergroup/forum state, owner membership
  and bot topic-management rights with bounded calls. A binding change during verification rejects
  readiness; actual send checks the captured binding again. No external messages were sent in tests.
- Added a single-flight dispatcher consuming the existing open Attention projection. Admission and
  pending batches are bounded; source resolution, current Agent/Team, selected kinds, policy,
  destination and quiet hours are checked again after pacing and after asynchronous readiness.
  Metadata-only messages use the existing outbound queue and one structured 429 retry. Unknown
  errors are replaced before entering its text-based fallback, preventing ambiguous automatic resend.
  Settlement uses the owned attempt number; possible sends without confirmation remain uncertain.
- Added strict settings input parsing and a daemon control class. First enable/re-enable defaults to
  a current cutoff. Explicit old-item inclusion requires a bounded five-minute preview captured by
  the daemon, matching revision/destination/kinds; resolution during the preview is rechecked. Five
  live previews per controller bound memory. Restore/settings-suppressed pending items can be
  reconsidered only through that explicit preview; confirmed and uncertain receipts are not reset.
- Three transport tests, five dispatcher tests and four control tests passed
  (`/tmp/baz038-transport-tests.log`, `/tmp/baz038-dispatch-tests.log`,
  `/tmp/baz038-control-tests.log`). Root typechecks passed at each checkpoint, most recently
  `/tmp/baz038-control-types.log`. Fixtures cover rebind/credential change, repeat polling,
  quiet-hour source resolution, disablement during validation, ambiguous error no-retry, bounded
  429 retry, future cutoffs, stale/expired preview and settings races.
- These classes are not yet registered as a startup notification pump or exposed through management
  routes. BAZ-038 remains local/uncommitted. Next: runtime lifecycle, authenticated API and retry
  revalidation, typed client, CLI/web settings and receipts, complete fault/restore tests and demos,
  documentation/changeset, integration gates and final PR verification.

### BAZ-038 runtime, authenticated API and operator controls

- Registered a single daemon notification pump with explicit shutdown cancellation. Queued callbacks
  check shutdown before accessing the DB; a send interrupted during shutdown remains sending for
  startup uncertainty reconciliation, never a fabricated confirmed receipt.
- Added authenticated `/api/notifications` settings, preview, bounded receipt list/detail and explicit
  retry endpoints under existing middleware, with no-store responses and a 32 KiB body limit. Fixed
  the route error handler to preserve 413 rather than converting body-limit errors to generic 400.
  Retry revalidates enabled/restore state, original destination, selected kind, canonical source and
  captured membership/policy after asynchronous readiness before the revision-bound transition.
- Added typed client methods and `bazilion notification settings|preview|configure|list|show|retry`.
  Enabling requires an explicit destination ID; existing-open inclusion uses the preview ID;
  retries require `--acknowledge-possible-duplicate`. CLI help was exercised locally
  (`/tmp/baz038-cli-help.log`); end-to-end CLI acceptance remains pending.
- Added the web Attention notifications card to Telegram integration settings: explicit destination,
  kind checkboxes, IANA timezone and quiet window, default future-only save, preview confirmation,
  restore guidance, paginated receipt metadata and explicit duplicate-warning retry confirmation.
  This is implemented and typechecked, not yet browser-accepted.
- Fifteen API/control/dispatcher tests passed (`/tmp/baz038-api-tests.log`), covering auth, body size,
  invalid destination/settings, shutdown before/after possible send and retry disablement races.
  Root and web typechecks passed (`/tmp/baz038-api-final-types.log`, `/tmp/baz038-web-types.log`);
  focused Biome checks and diff checks passed. Formatted the new web component using repository
  formatter settings through stdin because the web tree is excluded from root Biome traversal.
- BAZ-038 remains local/uncommitted. Remaining: full source-kind and policy/rate-limit/pacing fault
  coverage, explicit restore reconciliation tests, real CLI and desktop/narrow browser demos,
  source eligibility/receipt retention audit, operator docs/Changeset and final integrated gates,
  commit/push, remote SHA equality and passing final PR CI.

### BAZ-038 audit: timestamp boundary, capacity and rate-limit shutdown

- Fixed the 429 retry callback to check shutdown before its claim reset touches SQLite. A regression
  spies on writes after shutdown and confirms no callback mutation or second send occurs.
- Future-only enablement now records already-open items at the cutoff boundary as suppressed
  `future_baseline` receipts, while dispatch permits a distinct source created later in the same
  millisecond. Explicit previews can reconsider that baseline. This closes the prior strict-time
  comparison gap without replaying already-open boundary sources.
- Receipt-capacity rejection now stops new admission while allowing existing pending receipts to
  dispatch, and exposes a fixed capacity diagnostic. Known 429 retry delay is capped at 30 seconds;
  longer/invalid delays fail visibly. Other 4xx descriptions cannot activate the queue's text-based
  retry fallback. Unknown transport errors continue to produce uncertainty without auto-retry.
- Fifteen focused control/dispatcher tests passed (`/tmp/baz038-boundary-tests.log`), including the
  new timestamp/shutdown/rate-limit cases. Root typecheck passed (`/tmp/baz038-boundary-types.log`),
  focused Biome and diff checks passed.
- **Open audit finding to fix next:** changing selected kinds currently resets the global cutoff
  and suppresses all deferred notices, including unchanged kinds. Introduce per-kind eligibility
  cutoffs (canonical schema/backup contract if persisted), preserve existing pending work for kinds
  that stay enabled, and give newly added kinds a fresh cutoff/boundary snapshot. Removed kinds must
  still suppress their pending notices. Test add/remove/re-add and unchanged-kind pending delivery.
- BAZ-038 remains incomplete/local. Full source-kind, restore reconciliation and fault acceptance,
  real CLI/browser demos, documentation/Changeset and final integration/PR checks remain required.

### BAZ-038 per-kind cutoffs and manual client acceptance

- Fixed the selected-kind audit finding: persisted `kind_cutoffs_json` preserves eligibility and
  admitted notices for unchanged kinds, starts newly added kinds at a fresh cutoff, and suppresses
  only removed kinds. Re-addition does not implicitly replay suppressed work. Canonical schema hash
  is now `94bdce93baa8ac939e0ddb11de5baf6821d60b1cf794a83eebe8d900d3bfe99e`.
- Twenty-four repository/control/dispatcher tests passed (`/tmp/baz038-kind-cutoff-tests.log`),
  including missed eligibility for an unchanged kind and add/remove/re-add. Root typecheck passed
  (`/tmp/baz038-kind-cutoff-types.log`). Actual fresh-home CLI backup/restore passed with the new
  schema (`/tmp/baz038-kind-cutoff-backup.log`; unrelated tests filtered).
- Full styled desktop/390px keyboard browser demo passed against a disposable live daemon and fake
  Telegram transport (`/tmp/baz038-demo/browser-verified.log`). It checks no historical sends after
  ordinary enablement, explicit two-item preview, one confirmed and one uncertain send, duplicate-
  warning keyboard retry, confirmed final receipts, persisted settings after reload, no horizontal
  overflow and no page errors. Inspected `desktop-enabled.png`, `narrow-preview.png` and
  `narrow-delivered.png` in that directory for readability and focus/confirmation layout.
- Browser troubleshooting identified an async predicate polling mistake in the demo; explicit
  awaited polling fixed the premature refresh. The early refresh-overwrite diagnosis was not proved
  as the cause. The UI now keeps inclusion/retry dialogs open until their refresh completes, which
  also prevents user interaction while those operations settle. Final acceptance uses a fresh home.
- Actual CLI demo passed settings, paginated receipt list/detail, quiet-hour mutation, deduplicated
  preview, disablement and explicit-destination re-enable (`/tmp/baz038-demo/cli-verified.log`).
  Harnesses are `/tmp/baz038-demo/{server.mts,browser.mjs,cli-check.py}`. Test credentials were kept
  in a mode-0600 file and never printed; neither the fake bot nor preflight sends external requests.
- Added the operator guide `docs/attention-notifications.md` and pending fixed-group minor Changeset.
  Remaining BAZ-038 work: full five-source and policy/pacing fault audit, explicit restore
  reconciliation/uncertainty tests, final criterion-by-criterion evidence and integrated gates,
  commit/push/PR update, remote SHA equality and final CI. Work is still local and the goal active.

### BAZ-038 complete source/recovery audit and integration gates

- All five canonical Attention sources now have dispatch acceptance coverage, unchanged source
  decisions, metadata-only output and repeated-tick deduplication. Fixed the existing projection's
  outgoing-approval attribution: empty target IDs now fall back to the source Agent consistently
  with its relation join. Expired approvals and deleted source relations are suppressed after waiting.
- Restored-history uncertainty is now persistent after re-enable, so later old-item previews still
  warn that Telegram may have newer receipts. Snapshot-before-send acceptance verifies pause,
  future-only reconciliation without replay, then explicit old-item inclusion. Canonical schema hash
  is `278a7649d6017011b97405306760af3fdd337f068693e24b18cab43421a0c723`.
- Added tests for source/policy/destination changes behind outbound pacing, owner revocation, private
  forum/public alias checks, restricted non-member owners and bot permissions. Final source and live
  destination rerun passed eight tests (`/tmp/baz038-last-acceptance.log`).
- The integrated suite passed **1,395 tests, 3 skipped** across 180 passing files before the final two
  acceptance additions (`/tmp/baz035-038-final-tests.log`). A fresh whole-tree run is in progress for
  the exact current implementation (`/tmp/baz035-038-current-tests.log`).
- All **60 required security acceptance cases** passed, including its production web build
  (`/tmp/baz035-038-final-security.log`); serialized package/release builds passed
  (`/tmp/baz035-038-final-build.log`). Root/web/mobile typechecks and lint passed
  (`/tmp/baz035-038-final-*-types.log`, `/tmp/baz035-038-final-lint.log`); lint retained 55 warnings
  and three informational diagnostics. Fixed public versions remain 0.14.2.
- Added checked-in `scripts/demo-notifications.mts` and reproduction instructions. Its smoke check
  bootstrapped a fresh home, printed only a loopback URL and owner-only credential file path, and
  stopped under the planned five-second timeout (`/tmp/baz038-checked-in-demo.log`, timeout exit 124).
  The demo simulates Telegram/preflight and blocks Telegram configuration mutations.
- All nine BAZ-038 acceptance criteria are reconciled in the story. Remaining work is final exact-tree
  test completion, commit/push and PR scope/check updates, final docs reconciliation and CI/remote-SHA
  verification. No release, versioning, merge or deployment is authorized by this goal.

- Exact current-tree integration rerun passed: **1,397 tests, 3 skipped**, 180 passing files
  (`/tmp/baz035-038-current-tests.log`). The checked-in demo's fresh home contains only the
  `0001_init` migration. BAZ-038 is ready to commit and push; final remote CI remains outstanding.

### Final implementation acceptance and PR reconciliation

- BAZ-038 was committed and pushed at `4f34efce254b3daa6744aae6b54209c5b683367d`.
  Local and remote SHA equality and a clean worktree were verified. CI run `34154111191`
  completed successfully at that exact implementation SHA.
- The exact final code tree passed 1,397 tests (3 skipped), all 60 required security acceptance
  cases, root/web/mobile typechecks, lint, web and package builds, and diff checks. Full-suite
  evidence is `/tmp/baz035-038-current-tests.log`; other final gate logs use the
  `/tmp/baz035-038-final-` prefix. Baseline lint warnings remain, with no lint errors.
- Desktop/narrow keyboard browser flows, actual CLI/PTY interactions, real-worker question
  consumption and fake Telegram notification delivery/retry were exercised in disposable homes.
  Repeatable checked-in fixtures are `scripts/check-question-flow.mts` and
  `scripts/demo-notifications.mts`. No personal data or live external messages were used.
- Story acceptance mappings and this chronological ledger cover targeting, stale selection,
  queue admission/approval/recovery, question correlation/consumption and notification
  policy/destination/deduplication/restore boundaries. BAZ-034 stays in the same draft PR.
- Final documentation reconciles the backlog table and distinguishes committed work from shipped
  work. The PR checklist is finalized only after CI passes on that documentation commit, with
  local/remote SHA equality and clean status checked again. No release or deployment is claimed.

### 2026-09-08 guided acceptance and UI follow-up

The operator completed the visible walkthrough in a disposable home with a loopback model simulator
and fake Telegram transport. Retained `Fruit report` stayed readable after a new active conversation;
a paused apples follow-up was replaced with pears, and resuming completed only the replacement.
The JSON question answer was accepted and canonically consumed in its originating conversation.
Notification enablement sent no old items; explicit inclusion produced one delivered and one uncertain
receipt. Explicit retry delivered the uncertain notice on attempt 2, while the confirmed notice
remained at attempt 1. No live external message was sent.

The walkthrough exposed presentation issues corrected in the five web components: aligned title and
composer controls, responsive conversation rows, spaced queue/edit cards with one queue scrollbar,
compact keyboard-selectable question choices, and clear notification receipt cards. IDs remain
available in expandable details; the destination label explains the paired group's service topic.
Existing request identities, answer settlement, authorization and dispatch behavior are unchanged.
Desktop and 390px browser checks covered alignment, wrapping, keyboard selection, Other input,
expanded receipt details and the duplicate warning without submitting additional work. Screenshots
and verification scripts are under `/tmp/baz-semi-auto/`. Web typechecking, the production web build and diff checks passed on the final local follow-up.
CI is checked at its pushed SHA before reporting PR delivery complete.

### 2026-09-08 release signoff

PR #44 merged after CI passed at `b213880`; PR #45 passed CI at `0f1b69d` before merging.
All public packages published as 0.15.0, with umbrella release `v0.15.0`. Fresh-home verification
found only `0001_init`. The website adds five feature guides and a 0.15.0 announcement, and
reconciles older web, Telegram, backup, mobile, operations and upgrade documentation.
Website validation passed 1,097 internal links/anchors and eight routes at desktop/390px.
Publication, final repository SHAs and live deployment are verified separately from these local gates.

Release commit: `9f8276a70f8047863dea7c486713989f18313e83`; successful publication run
[34207761525](https://github.com/rullopat/bazilion/actions/runs/34207761525). All three npm
latest tags and annotated package tags were independently checked. A fresh temporary npm install
reported CLI version `0.15.0`. Website commit: `a82948c1af9cda9224ddb46cf319d3aac24bce52`.
