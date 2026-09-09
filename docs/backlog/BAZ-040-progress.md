# BAZ-040 implementation goal

> Scope revised 2026-09-09: [Agent-led coding design](design/agent-led-coding.md).
> Prior completion and acceptance entries below describe the previous scope. Revised Agent-led
> acceptance is recorded in [the remake audit](BAZ-039-040-agent-led-acceptance.md); no new durable goal was created.


Started: 2026-09-08. Local implementation and acceptance completed: 2026-09-09.
Publication, merge and release remain pending. Final audit: [BAZ-040 acceptance](BAZ-040-acceptance.md).
Story: [BAZ-040](in_progress/BAZ-040-coding-environment-readiness.md).
Durable goal thread: `01a08060-5816-7022-9c28-934c27bbaf70`.
Starting commit: `0832ce9b2ddd78d9c30d9ad9195775d6ec0971a3` on
`feat/baz-039-coding-context`, published in [PR #46](https://github.com/rullopat/bazilion/pull/46).
BAZ-039 is implemented and its PR CI passed; it remains unmerged and unreleased.

## Objective and stopping condition

Implement the entire refined BAZ-040 contract with reviewable local changes and acceptance evidence.
Complete only after settings, shared execution resolution, writer admission/recovery, bounded probes,
freshness/backup, API/CLI/web parity and the prepared recipe are implemented and validated. Partial
resolver/UI work does not satisfy the goal. Preserve BAZ-039 and subsequent story refinements.
No token budget was requested. Further PR publication, merge, release and deployment are separate.

## Checkpoints

- [x] Create durable goal, move BAZ-040 to in_progress and initialize evidence ledger.
- [x] Audit shell, protected preparation, lifecycle, scheduler and backup integration boundaries.
- [x] Add revisioned clean-install settings and hermetic contracts; shared image/cwd/environment resolver.
- [x] Add canonical overlapping-workspace admission, coordinated mutations and restart recovery.
- [x] Implement explicit finite operator probes, cancellation/reaping, retention and safe diagnostics.
- [x] Implement passive status, freshness and restore semantics without automatic probing.
- [x] Deliver authenticated API/client/CLI/web management, progress and cancellation parity.
- [x] Document and exercise prepared Linux Node/pnpm recipe with real isolated Docker commands.
- [x] Complete adversarial, real-runtime and browser acceptance; required checks and final diff audit.

## Acceptance evidence

| Criterion | Required evidence | Status |
|---|---|---|
| Team settings and precedence | Different Team images, global fallback, revisions, enabled/disabled behavior | Proven; audit criterion 1 |
| Explicit execution and coordination | Passive reads; revision-bound selected probes; overlap/alias exclusion; approval denial | Proven; audit criterion 2 |
| Probe/Agent equivalence | Immutable image ID, contained cwd, closed environment, protected posture; no fallback | Proven; audit criterion 3 |
| Truthful freshness | Configuration/image/context/lockfile/root/age/restart/restore invalidation; historical test exits | Proven; audit criterion 4 |
| Prepared toolchain | Pinned Node/pnpm image, dependencies across fresh containers, absent services/temp/network limits | Proven; audit criterion 5 |
| Credential and lifecycle safety | Redaction, no startup hooks/cache/extra mounts; cancel/reap and interrupted-writer recovery | Proven; audit criterion 6 and host recovery finding |
| Operator parity | HTTP/CLI/web config, status, explicit checks, progress/history/cancel; desktop/mobile inspection | Proven; audit criterion 7 |

## Implementation boundaries

- Daemon owns settings, probe identity/evidence and canonical writer coordination. No probe Agent,
  model, Team Policy communication edge, general runs/events service, hidden queue or automatic retry.
- Resolve Team image before global/default; bind immutable image once per admitted operation.
  Docker environment additions are only CI, NO_COLOR and TZ within the closed story contract.
- All probes remain fresh-container, network-disabled, bounded protected-equivalent operations.
  Dangerous commands with no approval bridge are blocked. Saving/reviewing a command is not approval.
- Register mutating Agent turns even for disabled Teams so enabling/configuring/probing cannot race
  existing writers. Hold ownership through teardown/questions and prove recovery after restart.
- Reuse BAZ-039 contained paths and instructions. Readiness is scoped historical evidence and does
  not assert current code correctness or replace mandatory runtime preflight.
- Use the canonical clean-install schema and backup contract. No compatibility migrations.
- Use disposable homes/repos/test images and fake provider/Telegram traffic. No live messages or
  personal runtime data. Additional language recipes, persistent services and BAZ-041/042 remain out.

## Validation ledger

Required: meaningful targeted tests, full tests, root/web typechecks, lint, build, security acceptance,
`git diff --check`, actual Docker recipe/equivalence checks and desktop/mobile browser inspection.
Record exact commands/results, image ID/tool versions and evidence paths as they run. Distinguish
mocked unit tests, actual isolated execution, PR CI and live deployment. Dated results follow below;
the completion audit remains pending.

## Progress log

- 2026-09-08: Read the complete refined story, confirmed the prior durable goal is complete and the
  workspace clean, and created this active implementation goal. Moved the story and repaired current
  dependency links. Historical BAZ-039 ledger entries remain as dated records. Application code is
  unchanged by this goal initialization; acceptance remains pending.

### Configuration foundation (2026-09-08)

- Added hermetic Team configuration/check/provenance types, closed non-secret environment validation,
  bounded definitions and compare-and-swap storage in the canonical clean-install schema. Runtime
  expectations must name runtime checks; readiness selections cannot relabel full tests as readiness.
- Configuration remains internal: no execution endpoint is exposed before writer coordination exists.
  The repository write explicitly requires its future caller to hold workspace mutation ownership.
- Audited turn preparation and Docker execution: current exclusion is per-Agent; prepared Docker
  operations recheck mutable tags per command; cancellation cleanup has no durable workspace identity.
  The shared BAZ-040 path must bind image IDs per operation and integrate durable ownership through
  preflight, worker/container teardown and recovery. These requirements remain pending.
- Validation: `pnpm vitest run apps/daemon/test/core/coding-environment.test.ts` passed 22 tests
  (`/tmp/baz040-config-tests.log`). Root typecheck passed (`/tmp/baz040-initial-typecheck.log`).
  No real Docker acceptance or end-to-end environment flow has been exercised yet.

### Durable workspace ownership foundation (2026-09-08)

- Added canonical-root writer records and a synchronous transactional claim coordinator. Disabled
  Team Agent turns can coexist until an enabled Team, mutation or probe contends; equal roots,
  symlink aliases and ancestor/descendant roots conflict. Disjoint sibling roots remain independent.
- Ownership survives Team deletion and daemon identity changes. Failed teardown leaves recovery
  required, and asynchronous recovery keeps the root blocked until the execution host confirms
  teardown. Recorded resource references are persisted before execution starts.
- These are internal primitives, not completed recovery: actual process/container identity records,
  resource teardown host and turn/probe/configuration wiring remain required. No endpoints invoke
  the coordinator yet. The next integration must cover worker launch-before-stdin handoff and
  per-command Docker creation/cleanup without permitting a restart to clear a live writer.
- Configuration plus workspace suites passed 29 tests in two files,
  `/tmp/baz040-workspace-tests.log`; root typecheck passed,
  `/tmp/baz040-workspace-typecheck.log`. Checks exercise overlaps, aliases, disabled writers,
  mutation conflicts, interrupted teardown, asynchronous recovery and deletion retention. They do
  not yet establish real-process crash recovery or real Docker isolation.

### Docker selection and protected preparation (2026-09-08)

- Added passive Team/global/default image selection and a closed Docker coding selection containing
  environment revision, relative cwd and CI/NO_COLOR/TZ values. Disabled Teams retain fallback.
- Prepared Docker execution validates the optional selection, preserves the complete Team mount,
  maps the selected cwd beneath `/workspace`, and rejects symlinked cwd components before running.
  Enabled selections inspect/execute the immutable admitted image ID rather than following a moved
  tag. Legacy unset Teams retain their previous behavior. Worker wire validation allows only the
  closed optional selection; the pinned base container environment remains unchanged.
- Protected preparation now consumes the Team selection; admission resolves the selected cwd's
  BAZ-039 ancestry, and execution rechecks that same target. The Bash description names its actual
  default container cwd. Configured Docker turns and operator probes still need to consume the same
  prepared runtime; no configuration-management endpoint is exposed while this is incomplete.
- Validation: Docker/worker suites passed 47 tests in two files
  (`/tmp/baz040-docker-selection-tests.log`); configuration/protected/preparation/prompt suites passed
  44 tests in four files (`/tmp/baz040-protected-selection-tests.log`). Root typecheck passed
  (`/tmp/baz040-protected-selection-typecheck.log`). Docker tests here use fake sockets/executables;
  real-image acceptance is still required. No full-suite acceptance or goal completion is claimed.

### Configured/protected execution parity (2026-09-08)

- Extracted shared Agent Docker input/preflight preparation. Enabled configured Docker turns now
  carry those inspected inputs over a closed worker field and construct their Bash tool from the
  same prepared runtime as protected turns. Both use the selected immutable image/cwd/environment
  and preserve memory/skill/input mounts. Configured turns retain their configured approval mode;
  a prepared Docker runtime cannot silently execute through host mode.
- The prepared configured input is validated against canonical Agent/Team paths and the same
  exact Docker mount/environment contract. Host and disabled-Team behavior remain separate.
- Added equivalence and approval/no-host-fallback fixtures. Initial five-file regression ran 77
  tests with one test-fixture error (missing Pi session context); the affected Docker fixture was
  corrected and its entire 29-test file passed on rerun. Other four files passed 48 tests.
  Logs: `/tmp/baz040-configured-tests.log`, `/tmp/baz040-configured-docker-retest.log`.
  Root typecheck passed (`/tmp/baz040-configured-final-typecheck.log`).
- Durable resource teardown/recovery, active-turn writer integration, coordinated configuration,
  probe execution/evidence, management surfaces and real-image acceptance remain incomplete. No
  new endpoint exposes configuration execution, and no changes were pushed to PR #46.

### Concrete recovery identities (2026-09-08)

- Added durable workspace resource records for worker process identities and exact-name Docker
  containers. Worker identities bind PID, kernel start ticks and boot ID; cleanup checks the
  detached session/group before signalling and refuses mismatched identities. Container cleanup
  revalidates the captured Docker executable and local socket, then uses bounded exact-name removal.
- Resource teardown orders workers before containers and retains ownership on missing references or
  unconfirmed cleanup. These records must still be connected before worker stdin delivery and before
  container creation, including daemon-side preflight, and through all cancellation/restart paths.
- Real disposable-process tests passed worker+descendant group termination, repeated cleanup,
  mismatched-start refusal and boot-change handling. Combined with workspace coordination: 10 tests
  passed (`/tmp/baz040-process-recovery-tests.log`); root typecheck passed
  (`/tmp/baz040-resources-typecheck.log`). This is process-group evidence, not full daemon restart
  acceptance; live integration and escaped/background-process handling remain in the recovery audit.

### Live Agent workspace ownership (2026-09-08)

- Turn preparation now acquires a canonical workspace claim for every coding-capable Agent turn,
  including disabled Teams. Inbox wake claims before consuming unread messages and transfers the
  checked lease into preparation. Scheduled occurrences and ordinary queued work defer workspace
  contention through their existing state machines; interactive chat reports 409. Approved queued
  work waits for admission under its existing dispatcher and revalidates its policy before running.
- Real workers with an ownership host launch in detached process groups, register their process
  identity before receiving turn stdin, and clean up the recorded group on exit/finalization. Async
  turn release holds workspace ownership through teardown; queue release callsites/tests now await
  it. Unknown recovery stays durably blocking. Old release cannot unregister a replacement Agent.
- Integration evidence: a real CLI/daemon/worker/fake-provider round trip observed one writer and
  one process record before each provider request; both were removed after teardown. Two tests
  passed (`/tmp/baz040-live-worker-record-test.log`). Scheduler/queue/preparation/CLI regression
  passed 54 tests in five files (`/tmp/baz040-admission-retest.log`) after updating fixtures for
  asynchronous release. Root typecheck passed (`/tmp/baz040-live-worker-typecheck.log`).
- Still required: durable preflight/container registration via IPC, unconfirmed descriptor/escaped
  process handling, restart fixtures with real containers, mutation coordination, probes/evidence
  and all management surfaces. Full release/security acceptance has not been rerun for BAZ-040.

### Container lifecycle registration (2026-09-08)

- Docker preflight and command operations now support before-create registration and daemon-verified
  removal. Turn preparation and inbox preflight supply lifecycle hosts, so preflight containers are
  recorded under the same workspace claim as worker execution.
- Worker container operations round-trip only an exact container name over two scoped IPC methods.
  Names are bound to a daemon-issued per-writer namespace. The daemon supplies the admitted executable
  identity/local endpoint; callers cannot select another Team, Docker path or cleanup namespace.
  Restricted review receives no lifecycle host. Legacy configured Docker obtains a passive engine
  identity before spawning, while enabled coding Teams reuse their prepared runtime.
- Dedicated registration/namespace tests passed 39 tests in two files
  (`/tmp/baz040-container-registration-tests.log`). The initial five-file regression found the
  optional namespace mistakenly included in protected required keys; after correction, its worker
  suite passed on rerun (`/tmp/baz040-container-worker-retest.log`). Other four files had passed.
  Root typecheck passed (`/tmp/baz040-container-final-typecheck.log`).
- Recovery is not accepted yet: ambiguous create timeouts/late materialization need explicit creation
  acknowledgement handling, alongside real daemon-restart/container fixtures and escaped-process
  audits. Probes, passive freshness/evidence and management surfaces remain unimplemented. Nothing
  has been pushed to PR #46.

### Passive freshness foundation (2026-09-08)

- Added hermetic input/measurement/freshness contracts and a passive bounded snapshot resolver.
  It pins configured and selected-check cwd ancestry, hashes instruction/context sources plus
  manifests and the three supported lockfiles, and binds root identity, image ID, configuration,
  revision, selected check order and execution posture. Ordinary source and node_modules changes
  are deliberately outside this measurement; no project commands or dependency-tree traversal run.
- Reads reuse BAZ-039 directory containment and source limits, with an aggregate 4 MiB ceiling.
  Missing manifest/lockfile inputs, unsafe paths, unavailable images or limits produce unknown
  freshness. Absent optional ancestry files are recorded so newly added instructions invalidate
  the snapshot. A formerly present source disappearing also yields unknown evidence.
- Freshness distinguishes unmeasured, fresh, stale and unknown. Measurement age of 15 minutes,
  backwards clock movement, or a different daemon identity expires evidence; known captured-input
  changes mark it stale. This is a pure evidence comparison, never Agent admission authorization
  or a current-code test verdict.
- Targeted configuration/freshness tests passed 29 tests in two files
  (`/tmp/baz040-freshness-tests.log`); root typecheck and git diff check passed
  (`/tmp/baz040-freshness-typecheck.log`).
- This foundation is not yet wired to public status: probe persistence/execution, passive Docker
  metadata resolution, management endpoints/client/CLI/UI and restore integration remain pending.
  Container ambiguity/restart recovery work recorded above is still required. No BAZ-040 publication.

### Durable probe receipt foundation (2026-09-09)

- Added the canonical clean-install probe table and hermetic request/attempt/check contracts.
  Creation requires the reviewed current revision, enabled configuration, exact ordered check
  selection, hashed operator identity, and a matching active probe workspace writer. A unique
  active-Team index adds a separate bound on unfinished attempts.
- Repository operations enforce sequential execution and observed exit zero before success.
  Terminal attempts cannot be rewritten; pending checks become explicitly not executed on stop.
  Unconfirmed recorded resource cleanup overrides a would-be successful attempt with interrupted.
  The restart/restore reconciliation function interrupts old-daemon attempts without releasing
  separate writer/resource records. It still needs startup/restore integration.
- Diagnostics redact known secrets across byte/chunk boundaries before retention, preserve UTF-8,
  escape control bytes, and retain at most 64 KiB/check and a combined 256 KiB tail/attempt.
  Terminal history is bounded to twenty per Team and seven days; active attempts are never evicted.
  Browser rendering must still use inert text rendering when the management UI is implemented.
- Four-file targeted suite passed 43 tests (`/tmp/baz040-probe-store-final-tests.log`). Root
  typecheck passed (`/tmp/baz040-probe-store-typecheck.log`). Tests include failed/out-of-order
  transitions, foreign Team lookup, stale revision, ownership, unconfirmed cleanup, retention,
  restart interruption, multibyte/chunk-split secrets and diagnostic caps.
- The durable store is not yet connected to an asynchronous probe executor or public endpoints.
  Remaining scope includes actual Docker execution/recovery acceptance, management parity,
  startup/restore integration, prepared-image recipe and the full final validation gates.

### Coordinated management and passive HTTP status (2026-09-09)

- Added GET/PUT Team coding-environment routes and GET probe history/detail, plus typed client
  methods. Configuration validates every configured/check cwd under exclusive canonical workspace
  ownership, compares revisions, and never inspects Docker or executes commands while saving.
  The Team deletion route uses the same mutation claim, including alias/overlap conflicts.
- Passive status exposes configured host/Docker posture separately from protected probe evidence.
  Local engine/image metadata inspection does not create a container. Expectations alone remain
  unmeasured; runtime/dependency outcomes determine scoped readiness while test/build outcomes
  remain historical. Known configuration revision changes explicitly stale old evidence, including
  when previously measured check IDs no longer exist. Missing Docker/image metadata yields a bounded
  blocker without exposing its raw host error.
- Daemon bootstrap now interrupts old-daemon active probe records before scheduler startup. Writer
  resource ownership is retained for reconciliation. Restore-specific acceptance remains pending.
- Management and related Team route regression passed fifteen tests across three files
  (`/tmp/baz040-management-final-tests.log`); the four management tests passed again after the
  changed-check-ID freshness correction (`/tmp/baz040-management-status-retest.log`). Root typecheck
  passed (`/tmp/baz040-management-final-typecheck.log`), and git diff check passed.
- Probe POST/cancellation/execution and CLI/web management parity are still pending, as are complete
  authenticated/CSRF integration tests, immutable-image/recovery acceptance and final full gates.
  These routes alone do not constitute BAZ-040 completion. Nothing has been pushed.

### Asynchronous finite probe executor (2026-09-09)

- Added a process-lifetime per-DB probe service with explicit revision/check selection, operator
  identity, immutable admitted local image metadata, canonical workspace ownership and cancellation
  handles. Accepted attempts outlive request disconnects. Missing image metadata creates a bounded
  blocked receipt with no image ID rather than silently selecting a host runtime.
- The executor uses protected Docker preflight and the existing prepared Bash operations. A shared
  approval helper now serves both the Agent tool wrapper and probes: probes omit the approval host,
  so classified commands are blocked before command execution. Each selected check uses its saved
  cwd, closed values and timeout against the admitted image. Team memory is mounted read-only and
  context instructions are rechecked for each selected cwd. No Agent, provider or model is involved.
- Checks run sequentially, stop on failure/block/timeout/cancellation, and have a ten-minute set
  deadline. Cancellation waits for execution teardown before returning the terminal receipt and
  releasing ownership. The daemon shutdown path requests cancellation; restart records still retain
  recovery obligations. The admission-versus-shutdown race and real cleanup acceptance need audit.
- Added authenticated-principal-bound POST start (202) and POST cancel routes and client methods.
  Known encrypted/runtime secret values, including structured credential strings, feed the bounded
  diagnostic redactor and are not passed into command execution. Full real auth/CSRF and browser
  disconnect integration tests remain pending.
- Executor tests passed seven cases; combined executor/management/shell regression passed 88 tests
  in four files (`/tmp/baz040-probe-executor-regression.log`). Root typecheck passed
  (`/tmp/baz040-probe-http-typecheck.log`). These executor tests substitute Docker operations and do
  not prove real container isolation or late-creation/restart cleanup.
- Still required: resolve the recorded Docker creation-ambiguity and escaped-process recovery
  concerns; CLI/web parity; real Docker prepared-image/Agent/Telegram acceptance; backup/restore,
  authentication and boundary integration; full tests/security/build/browser gates. No publication.

### CLI and web management surfaces (2026-09-09)

- Added `team environment show|configure|check|history|cancel`, including JSON output. Configure
  consumes a reviewed revision/config JSON file; check prints exact ordered command/cwd/timeout
  definitions and requires `--run` to execute. JSON execution keeps the review on stderr and the
  accepted attempt on stdout. A real disposable-daemon CLI test proved review creates no attempt,
  explicit admission/history/cancel, and stale revision rejection with Docker deliberately denied.
  An initial subcommand placement mistake was corrected before the successful rerun
  (`/tmp/baz040-cli-environment-tests.log`).
- Added the Team coding-environment card: revisioned settings, closed value selectors, named checks,
  runtime expectations, readiness selection, exact-command review, async polling/cancellation and
  retained outcome details. Diagnostics render as React text. Draft changes cannot be run before
  saving/reloading, and passive refresh does not start probes.
- Added `scripts/check-coding-environment-ui.mjs`. Actual disposable daemon/gateway browser acceptance
  exercised authenticated configuration, unauthenticated 401, missing-CSRF 403, command review
  without execution and a blocked-image attempt. Desktop (1440x1100) and mobile (390x844) had no
  horizontal overflow or browser errors. Screenshots inspected, including mobile settings/history;
  wrapping and the no-check-executed stop reason were improved after the first inspection.
  Final evidence: `/tmp/baz040-ui-XHNXxc/` and `/tmp/baz040-web-environment-browser.log`.
- Root/web typechecks and web build passed (`/tmp/baz040-parity-final-typecheck.log`,
  `/tmp/baz040-parity-final-web-typecheck.log`, `/tmp/baz040-web-environment-build.log`). The six
  receipt tests passed after the stop-reason correction (`/tmp/baz040-probe-reason-retest.log`).
- These browser/CLI fixtures deliberately do not execute project code. Real prepared-image reuse,
  successful probe/Agent/Telegram equivalence, running cancellation/restart/restore and ambiguous
  Docker/process cleanup remain mandatory, as do complete docs and final full/security gates.

### Creation acknowledgement and real Docker recovery (2026-09-09)

- Coordinated commands now create a container, persist a daemon-owned creation acknowledgement,
  then start it. Protected preflight follows the same acknowledgement boundary. The worker IPC
  adds a namespace-bound after-create callback; missing acknowledgement prevents project execution.
  Recovery records now distinguish registered but unacknowledged creation from acknowledged creation.
- Unacknowledged recovery must observe the named container's immutable ID and remove that ID before
  releasing ownership. Missing containers remain recovery-required instead of relying on elapsed
  time or repeated name misses. Preflight delegates registered cleanup to the daemon resource host
  so a successful removal cannot lose its evidence before recovery sees it.
- Real Docker 29.7.2 exposed that `container rm --force` may silently exit zero for a nonexistent
  name. The first two real recovery attempts failed and drove the explicit inspect-ID requirement;
  final real tests passed both cases (`/tmp/baz040-real-create-recovery-tests.log`). They proved
  create/start preserves exit 7 and configured cwd/CI/NO_COLOR/TZ, and a restarted coordinator blocks
  an absent unacknowledged creation until its late materialization is observed and removed.
- Tests used disposable roots/DBs/containers with already-local `debian:bookworm-slim` (local short
  image ID `f06537653ac7`). They do not establish the required Node/pnpm prepared-image recipe.
  Fake-Docker/workspace/probe regression passed 48 tests in three files
  (`/tmp/baz040-create-ack-final-tests.log`), including denied creation acknowledgement before start.
  Root typecheck passed (`/tmp/baz040-create-ack-final-typecheck.log`).
- Remaining recovery work includes actual daemon/worker interruption, escaped-process/descriptor
  handling, cancellation during create/admission, and restore/unknown-recovery operator guidance.
  Broader recipe, runtime equivalence and final acceptance gates remain pending. Nothing published.

### Prepared Node/pnpm image and first full-suite pass (2026-09-09)

- Added the explicit operator [Dockerfile](../../examples/coding-environment/Dockerfile) and
  [preparation/readiness guide](../coding-environments.md), linked from README. The official base is
  pinned to Node 24.13.0 Bookworm slim digest
  `sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f`; the image installs
  pnpm 10.28.2. This explicit operator build used registry access; runtime execution never builds,
  installs or pulls automatically. Build log: `/tmp/baz040-prepared-image-build.log`.
- Added `scripts/check-coding-environment-docker.mjs`. It explicitly installs one fixture dependency
  into a disposable workspace using only that workspace mount and an ephemeral package store, then
  runs real protected probes and a configured Docker Agent driven by a local fake provider.
  Actual accepted image ID: `sha256:40c693a749d9fefe0d206c2716375cc57eb44edd9bf37a29c883c7f9d4c24839`.
- Real acceptance proved Node/pnpm versions, dependency reuse across fresh commands, absent prior
  `/tmp` files, cwd `/workspace/app`, closed CI/NO_COLOR/TZ values, loopback-only container networking,
  read-only Team memory and absence of the host API-key sentinel. The Agent independently recreated
  the runtime evidence file; its tool result was required to report a passing finite test before
  the fake provider could complete. The stricter fixture initially expected TAP from Node's default
  human reporter; making the test reporter explicit corrected that fixture failure.
  Final evidence: `/tmp/baz040-prepared-K5cKjF/`, `/tmp/baz040-prepared-acceptance.log`.
- The first full suite passed 1,495 tests and failed fifteen backup/schema cases (five skipped).
  All failures traced to the CLI's exact canonical schema allowlist/fingerprint missing the new
  tables. Updated that contract without relaxing validation. After regenerating its fingerprint,
  all 46 backup/result-snapshot tests passed (`/tmp/baz040-backup-schema-final-tests.log`). A complete
  single-pass full-suite rerun remains a final gate after the remaining implementation work.
- Root typecheck passed (`/tmp/baz040-prepared-final-typecheck.log`). Lint passed with warnings
  (`/tmp/baz040-lint-final.log`); its sole error was formatting in the existing BAZ-039 browser
  fixture, corrected without behavior changes. Git diff check passed.
- Outstanding: restore must not blindly adopt copied live resource identities as cleanup authority
  in another home; actual daemon/worker interruption and process escape/descriptor handling;
  creation/admission cancellation limits; real Telegram/gateway runtime equivalence and remaining
  matrix cases; final security/build/full-suite gates and completion audit. Nothing published.

### Restore ownership, admission shutdown and command deadlines (2026-09-09)

- Restored backups now invalidate every receipt's daemon identity while preserving historical
  terminal outcomes. Active receipts become interrupted. Copied workspace writers are marked
  `recovery_mode=restored`: neither automatic recovery nor direct resource cleanup may use their
  copied worker/container identities to kill resources belonging to the original home. Real Team
  paths are rebased to the target home; restored ownership also blocks the same Team after inode
  changes. Status/CLI/web expose the recovery blocker; the guide explains quiescent backups.
- The restore test keeps a real detached fixture worker alive in the original home, restores its
  database elsewhere and verifies the copy cannot kill it or admit competing work. Historical
  successful receipts retain their exits/timestamps but become stale. The canonical schema hash
  was updated. All 47 backup/restore/result-snapshot tests passed
  (`/tmp/baz040-restore-final-tests.log`); root and web typechecks passed.
- Probe shutdown now tracks pending admissions as well as accepted probes. A shutdown during
  Docker metadata resolution waits for admission to release its workspace and prevents subsequent
  receipt/runtime creation. Registered Docker commands accept cancellation during create and share
  their execution timeout across create, durable acknowledgement and start. Missing creation
  acknowledgement still requires observed-container cleanup or retains the recovery blocker.
  The focused shutdown/create suite passed 43 tests (`/tmp/baz040-shutdown-create-tests.log`).
- Each check also owns a deadline signal covering its context/preparation/execution interval.
  Expiry stops the set and waits for operation teardown before releasing workspace ownership.
  Added a regression that holds teardown after timeout and verifies competing work remains blocked.
- Freshness now captures an explicitly recorded command provenance file even outside cwd ancestry,
  with the existing no-follow and source/total limits. Modified sources become stale; missing or
  symlinked sources produce unknown evidence. Deadline/freshness tests passed 16 tests
  (`/tmp/baz040-deadline-provenance-tests.log`).
- Full suite passed 1,514 tests with five skipped (`/tmp/baz040-full-tests-second.log`), before the
  final deadline/provenance additions above. Security acceptance passed all 60 required adversarial
  cases (`/tmp/baz040-security-acceptance.log`, report
  `/tmp/bazilion-security-acceptance-421421.json`). These are local gates, not release evidence.
- After the deadline/provenance changes, root typecheck and package/CLI build passed
  (`/tmp/baz040-deadline-typecheck.log`, `/tmp/baz040-package-build.log`). Lint passed with 55
  warnings and two informational diagnostics (`/tmp/baz040-deadline-lint.log`).
- Remaining: escaped worker descendants/descriptor closure and actual daemon interruption recovery;
  cancellation during runtime preflight; real Telegram/gateway Agent equivalence; remaining acceptance
  matrix and final criterion audit. The goal remains active and no additional changes were published.

### Cancellation through runtime preflight (2026-09-09)

- Passed the probe's cancellation/deadline signal into protected runtime preflight. Both Docker
  create and the initial container start now stop their client processes on abort, retain bounded
  handoff to cleanup, and await registered exact-container removal before returning. Cancellation
  before create prevents creation; cancellation after creation cannot skip cleanup.
- The focused Docker/probe suite passed 46 tests (`/tmp/baz040-preflight-cancel-tests.log`), including
  disposable process/socket fixtures paused during create and start. A further service regression
  verifies that cancellation during preflight runs no selected checks and keeps competing workspace
  admission blocked until teardown resolves (`/tmp/baz040-preflight-service-tests.log`, 10 passed).
  Root typecheck and diff check passed (`/tmp/baz040-preflight-cancel-typecheck.log`).
- Worker recovery audit confirmed an outstanding issue: process-group termination alone does not
  prove closure of inherited output descriptors held by detached descendants. Closing those local
  descriptors must not silently certify workspace cleanup. This needs durable unavailable evidence
  and bounded transport termination, plus actual restart acceptance. No worker changes or completion
  claims were made in this increment; Telegram/gateway equivalence and final audit remain pending.

### Output descriptor recovery and actual daemon interruption (2026-09-09)

- Worker identities now retain their uid and output pipe/socket endpoint identities. After group
  termination, bounded inspection checks for surviving output holders among same-uid processes
  started no earlier than the worker. Older protected desktop processes and read-only pipe ends
  are not descendants/writers. Permission/inspection uncertainty and surviving holders remain
  unconfirmed; the existing cleanup window accommodates transient descriptor teardown.
- An unconfirmed worker exit now ends local output transports and reports failure instead of
  hanging on inherited descriptors. Closing the transport does not mark resource cleanup confirmed.
  Persisted endpoint evidence continues to block recovery; once the holder exits, recovery can
  confirm closure. This extends process-group lifecycle checks, not host execution isolation.
- A real detached-descendant fixture verifies the worker transport terminates, competing work
  remains blocked after the database is closed/reopened, and admission recovers only after the
  output holder exits. Worker/runtime/restore regression: 25 tests passed
  (`/tmp/baz040-output-recovery-regression.log`). Root typecheck passed.
- Initial descriptor tests exposed overbroad inspection of unrelated non-dumpable processes and
  transient dying processes; both were corrected. One sandbox PID-namespace run was explicitly
  stopped after inspecting its live fixture processes; final process tests ran in the host PID
  namespace matching the daemon. Four identity tests passed (`/tmp/baz040-output-holder-host-tests.log`).
- Added an opt-in real Docker/daemon restart acceptance test. A probe starts a long fixture command;
  SIGKILL leaves its acknowledged container running. A fresh daemon on the same home marks the
  receipt interrupted and reaps the old container before admitting a successful Node probe. The
  original command's completion marker never appears and its receipt is not replayed. Passed
  (`BAZILION_TEST_DOCKER=1 pnpm vitest run apps/cli/test/coding-probe-restart.test.ts`,
  `/tmp/baz040-daemon-probe-restart.log`). Prepared local Node image only; no pulls or live services.
- Remaining: real Telegram/gateway Agent equivalence, remaining acceptance-matrix evidence and
  final criterion-by-criterion audit/gates. Nothing published; goal remains active.

### Real gateway and Telegram execution equivalence (2026-09-09)

- Extended the prepared-image acceptance fixture through an authenticated browser session and real
  loopback web gateway, then through the production Telegram router and user-queue drain. Telegram
  uses a recording ReplyApi and fake owner/topic credentials in the disposable home; no Bot starts,
  no Telegram network connection or live message occurs. The normal daemon is stopped before the
  Telegram fixture opens its home, preserving one active daemon owner.
- This uncovered a real protected-path bug: Pi's tool context overrides the supplied Bash cwd with
  the model-facing path. Docker operations interpreted `/workspace` as a host path. Protected Bash
  now maps only the admitted virtual cwd to the preflighted host workspace, and the protected session
  uses the selected `/workspace/<cwd>`. Docker mount identity/containment checks remain mandatory.
- The first two Telegram fixtures failed with `Docker sandbox mount does not exist: /workspace`;
  retained fixture transcripts isolated the cause. After the fix all four paths passed: protected
  probe, configured CLI Agent, configured loopback-gateway Agent and protected Telegram Agent.
  Each Agent independently recreated runtime evidence under Node 24.13.0/pnpm 10.28.2, cwd
  `/workspace/app`, CI=true/NO_COLOR=1/TZ=UTC, loopback-only networking, read-only memory and no host
  secret sentinel. Six fake-provider requests each required a successful actual tool result.
- Final evidence: `/tmp/baz040-prepared-SXmLUb/acceptance.json`, gateway/Telegram receipts and session
  transcript in the same directory; `/tmp/baz040-transport-equivalence.log`. Pinned image remains
  `sha256:40c693a749d9fefe0d206c2716375cc57eb44edd9bf37a29c883c7f9d4c24839`.
- Added a focused protected-tool cwd regression, including rejection of an unrelated virtual cwd.
  Docker/worker/Telegram routing tests passed 90 tests (`/tmp/baz040-transport-regression.log`).
- The gateway case above uses the loopback configured posture. Explicit private-origin gateway
  acceptance, unsupported-service matrix cases and the final completion audit remain pending.
  Full-suite/security/build/typecheck checks have been launched after the runtime correction.
- Those gates completed: 1,522 full-suite tests passed with six skipped
  (`/tmp/baz040-full-tests-final.log`), all 60 security cases passed
  (`/tmp/baz040-security-final.log`), root/web typechecks and package/CLI build passed
  (`/tmp/baz040-final-{typecheck,web-typecheck,build}.log`). Lint passed with 55 warnings/two infos
  (`/tmp/baz040-final-lint.log`). A wrong approval-host method in the new test stub was caught by
  typecheck and corrected to `requestApproval`; the final root typecheck passed. Diff check passed.

### Private-origin profile, failure matrix and completion audit (2026-09-09)

- Private-origin gateway acceptance now runs the real gateway/daemon with a configured HTTPS origin,
  secure session/CSRF cookies and host shell mode `off`. It still selects protected Docker execution
  and independently recreates the probe's environment. The final fixture uses a disposable linked
  repository across every transport. Eight fake-provider calls succeeded; no live Telegram Bot or
  actual external HTTPS deployment is involved. Evidence: `/tmp/baz040-prepared-wTB6Aw/`,
  `/tmp/baz040-linked-equivalence.log`.
- Real failure matrix covers absent executable/package, incompatible native binary, unavailable
  database/network, read-only cache and exhausted tmpfs, plus capped/redacted 300 KB output.
  Each required failure blocks readiness and leaves the later check unexecuted. Four real Docker
  tests in three files passed (`/tmp/baz040-final-docker-matrix.log`), including daemon/container
  restart recovery. The output fixture was corrected to emit its fake secret from file content,
  avoiding conflation with deliberately retained operator-reviewed command text.
- Refreshed UI build and desktop/mobile settings/history screenshots passed and were visually
  inspected (`/tmp/baz040-ui-lesrDO/`, `/tmp/baz040-final-browser.log`). Root typecheck and lint pass;
  final full suite passed 1,522 tests with seven skipped (`/tmp/baz040-final-suite-audit.log`).
- Added a changeset, updated preparation/acceptance documentation and wrote the detailed
  [completion audit](BAZ-040-acceptance.md). During that audit, inspection of Pi's actual host Bash
  implementation revealed detached command process groups beyond the worker group. Current Docker
  and output-holder recovery tests do not prove cleanup of a lost host worker's detached Bash.
  Correct this before goal completion; retain unknown ownership instead of declaring cleanup from
  an empty worker group. This is an existing lifecycle requirement, not an expanded orchestration
  feature. The goal remains active and nothing was published.

### Host recovery correction and local completion (2026-09-09)

- The daemon now records whether the actual worker can execute host commands before delivering its
  input. Lost host workers cannot be certified from an empty worker group: cleanup requires an
  observed orderly exit or proof of a different boot. Unknown ownership persists across daemon/DB
  restart. Normal observed host completion still releases ownership; Docker recovery remains based
  on independently recorded containers. The operator guide documents the host-boot limitation.
- A real Pi `createLocalBashOperations` fixture demonstrates its detached Bash surviving worker
  SIGKILL. Competing work remains blocked after DB reopen and after only the known shell is killed.
  The normal host context round-trip still releases all owners/resources. Host/worker/context
  regressions passed 28 tests (`/tmp/baz040-host-recovery-final-tests.log`). An exit-event race in
  one test assertion was fixed before the passing run.
- Final full suite passed 1,524 tests with seven skipped (`/tmp/baz040-host-final-suite.log`).
  All 60 security cases passed (`/tmp/baz040-host-security.log`,
  `/tmp/bazilion-security-acceptance-505698.json`). Root typecheck, lint and package/CLI build passed
  (`/tmp/baz040-host-{typecheck,lint,build}.log`); lint retains 55 warnings/two informational notices.
  Web typecheck/build and inspected desktop/mobile artifacts remain current; no UI code changed.
- Repeated the complete linked-repository runtime fixture after the correction: all eight
  fake-provider requests succeeded across CLI, loopback gateway, private-origin gateway and
  Telegram. Evidence: `/tmp/baz040-prepared-mCoUYr/`, `/tmp/baz040-completion-equivalence.log`.
- Completed the requirement-by-requirement audit and final file/status/diff review. Branch remains
  `feat/baz-039-coding-context` at BAZ-039 commit `0832ce9b2ddd78d9c30d9ad9195775d6ec0971a3`.
  BAZ-040 is locally implemented and validated, with uncommitted changes and its own changeset.
  No additional PR publication, merge, release or deployment occurred. The story remains under
  `in_progress/` until publication/release reconciliation; this implementation goal is complete.

### 2026-09-09 — operator manual-semiauto acceptance

- Completed the visible-browser walkthrough in a fresh disposable home. Operator screenshots
  confirmed save/review without execution, Node v24.13.0, a passing pnpm test, test failure with
  the subsequent runtime check not executed, recovery after fixing the fixture, instruction-input
  staleness on passive refresh, cancellation, timeout, and a successful subsequent probe.
- The walkthrough exposed a web polling race: publishing terminal history first disposed the
  polling effect before readiness could update. Terminal history and status now update together
  after the status request completes. Web typecheck/build and diff checks passed; the operator
  rerun confirmed readiness updated to ready/fresh. The disposable fixture also needed its missing
  dependency-free pnpm lockfile, generated offline with the prepared image.
- Final read-only verification: probe `608d9e4b-eb4c-4c1c-8d0d-81e4742a4588` succeeded at
  revision 4; readiness ready/fresh, workspace recovery none. Eight retained attempts include
  failed, cancelled and timed-out receipts. Evidence: `/tmp/baz040-semi-auto/manual-results.json`
  and the operator screenshots in this conversation. The fixture browser remains available.
- BAZ-040 changes remain uncommitted and unpublished; manual acceptance does not imply release.

### 2026-09-09 — repository and coding UX redesign

- Replaced the two independent cards with one Repository & coding panel: Repository, Run checks,
  Environment and History. Repository inspection loads passively and suggested commands can be
  added to a retained draft with source provenance; duplicate command/directory pairs reopen
  their existing editor. Commands still require saved configuration and explicit execution review.
- Added compact check editors, Node/pnpm version shortcuts, selection controls and explicit order
  arrows, save-to-checks navigation, a focused latest result and optional logs/technical details.
  Drafts survive view changes. Historical runs no longer fill the execution view.
- Web typecheck/build passed. Updated isolated browser fixtures passed for repository context,
  nested instructions, unsafe paths, draft retention, save navigation, review without execution,
  CSRF and desktop/mobile overflow. Evidence: `/tmp/baz039-ui-84JmoE/`,
  `/tmp/baz040-ui-0VunQN/`. A real disposable Docker browser run additionally verified suggestion
  handoff/deduplication, draft discard, explicit ordering and automatic ready status; screenshots
  are `/tmp/baz040-semi-auto/redesign-{desktop,mobile}.png`. No publication occurred.

## Agent-led remake — 2026-09-09

The operator-probe scope above is superseded. The replacement is implemented and validated locally: [Agent-led acceptance](BAZ-039-040-agent-led-acceptance.md). No new goal, merge or release is claimed.
