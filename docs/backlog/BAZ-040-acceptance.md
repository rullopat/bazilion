# BAZ-040 historical operator-probe acceptance audit

Audit date: 2026-09-09. Scope: the [2026-09-08 operator-probe refinement](archive/BAZ-040-2026-09-08-operator-refinement.md)
and [durable goal](BAZ-040-progress.md). This records local implementation evidence, not a release,
deployment, merge or additional publication to PR #46. BAZ-039 remains preserved on the same branch.

The story was revised on 2026-09-09 to Agent-led preparation. This audit does **not** establish
acceptance of the [revised criteria](in_progress/BAZ-040-coding-environment-readiness.md).

## Acceptance criteria

| Criterion | Implementation and inspected evidence | Result |
| --- | --- | --- |
| 1. Independent Team images and protected precedence | `core/coding-environment/config.ts`, `core/repos/coding-environment.ts`, `lib/coding-environment/resolve.ts`; config tests select different images for two Teams and assert Team/global/default and disabled behavior. Real private-origin gateway acceptance configures host shell mode off but executes protected Docker using the Team image. | Proven locally |
| 2. Passive status, explicit commands, approval and exclusion | `management.ts` only reads Docker metadata/context; `probes.ts` admits explicit revision/ordered IDs and calls the shared approval classifier. Route/config tests verify no project execution on reads/writes; browser review retains empty history. Workspace tests cover aliases/equal/ancestor/descendant roots, disabled owners, enabling and deletion conflicts. Probe cancellation tests retain the lease through teardown. Lost host-worker recovery remains blocked without observed orderly exit or a different boot. | Proven locally |
| 3. Probe/Agent runtime equivalence | `turn-preparation.ts`, `protected-execution.ts`, `shell/docker.ts`, `shell/tooling.ts`, `pi/session.ts`. Real linked-repository fixture independently recreates evidence through protected probe, configured CLI/loopback gateway and protected Telegram/private-origin gateway. Mutable-tag unit test retains the admitted image ID. Missing-image/preflight failures never run host commands. | Proven locally |
| 4. Scoped readiness and staleness | `freshness.ts` and `management.ts`; tests change revision, image, instructions, provenance, lockfiles, root/alias target, time and daemon identity. Missing/unsafe/over-limit inputs become unknown. Route test keeps runtime readiness separate from historical failed tests. Restore tests preserve historical exits/times and invalidate every measurement. | Proven locally |
| 5. Prepared dependencies and actionable limits | Pinned Dockerfile plus real Node/pnpm fixture: dependency persists, temporary marker does not, memory is read-only, network has only loopback. Real limits test verifies missing executable/package, refused database connection, unavailable external network, read-only cache path and exhausted 64 MiB tmpfs; each failed check stops the set and blocks required readiness. | Proven locally |
| 6. Secrets, startup hooks and discovery | Closed CI/NO_COLOR/TZ validation rejects other keys and control characters; existing Docker environment/mount/provider gates remain. Config tests never execute command text. Probe diagnostic tests redact across every byte split, bound UTF-8 tails and escape control bytes; real 300 KB output is capped/redacted and HTML is rendered as React text. Real runtime excludes the host credential sentinel. Security acceptance: 60 adversarial cases passed. | Proven locally |
| 7. HTTP/CLI/web parity | Hermetic `api-types/coding-environment.ts`, client methods, Team routes, `team-environment.ts` CLI and `CodingEnvironmentCard.tsx`. Disposable CLI tests cover configuration/review/start/status/history/cancel/revision conflict. Browser checks cover device login, session/CSRF rejection, saved settings, explicit review/run, polling and safe history on desktop/mobile. | Proven locally |

## Detailed contract audit

| Refined requirement | Authoritative evidence |
| --- | --- |
| Daemon owns revisioned settings; no compatibility migrations | Four new canonical tables/two probe indexes in `0001_init.sql`; CLI backup schema allowlist/hash; CAS repository writes and stale-revision tests. No new ALTER migration. |
| Exact bounded configuration | Config validator: 16 checks/expectations/selections, stable unique IDs, supported kinds, 4 KiB commands, 1–300 s timeout, existing contained cwd, bounded provenance and runtime-backed expectations. Config/containment tests reject unknown keys, invalid values and unsafe paths. |
| Only CI, NO_COLOR, TZ; pinned PATH/HOME/etc | Config and Docker coding-selection validators plus existing shell environment builders. No new mount or arbitrary environment field. Prepared-image real tests verify closed values and absent host secret. |
| Same mount root; selected cwd; applicable instructions | `resolveCodingDirectory`, BAZ-039 `ContextDirectory`, shared prepared runtime and protected virtual-cwd adapter. Regression rejects an unrelated virtual cwd; linked-repository fixture uses `/workspace/app` with root/app AGENTS.md. Existing repository-context/security tests remain green. |
| Immutable local image, no automatic install/pull | Engine metadata admission snapshots image ID; commands use that ID. Local Unix socket/executable/mount/VOLUME preflight is retained. Fixture preparation explicitly builds/installs before runtime; no runtime image fetch or package installation path added. |
| Explicit authenticated probe identity and selection | Start request validates exact posture/revision/ordered IDs. Store binds Team/root/writer/daemon/operator credential digest. Routes require existing principals and no-store responses; no Agent/model/provider configuration is constructed. |
| Approval denied without bridge | Shared `requireBashApproval`; dangerous probe regression never invokes Docker command operations and records `approval_unavailable`. Initial known runtime preflight is separate from project commands. |
| Fresh containers, sequential stop and deadlines | Docker lifecycle registers before create, acknowledges before start and awaits cleanup. Probe service stops after the first non-success, records remaining `not_executed`, owns per-check abort timers and a ten-minute set deadline. Timeout, preflight cancellation and admission-shutdown tests passed. |
| Disconnect independence; no second queue | Service owns accepted asynchronous promises/controllers. HTTP only returns 202; history/cancel reconnect to the service. Scheduler/inbox/follow-up paths retain their existing queues and defer on workspace conflicts. No automatic probe scheduler or replay path. |
| All Agent owners, atomic overlap admission, full-turn lease | `WorkspaceCoordinator.claim` uses a transaction and canonical root identity; enabled/probe/mutation contenders serialize overlaps. `prepareAgentTurn` acquires before execution and `agent-turn` finally releases after worker teardown, including paused turn state. Scheduler/inbox/queue call sites were inspected. |
| Restart cleanup, unknown remains blocked | Docker recovery and inherited-output recovery are proven by real fixtures. Lost host workers additionally require observed orderly exit or a different boot: a real Pi detached Bash fixture survives worker SIGKILL and its workspace remains blocked after DB reopen. The normal host turn regression still releases ownership. |
| Restored resources cannot kill original-home workers | Restore marks receipts interrupted/stale and writers as restored; coordinator and resource teardown refuse copied kill authority. Real original fixture worker survives attempts from restored state. Quiescent-backup recovery guidance is documented. |
| Narrow receipts and bounded diagnostics | Dedicated probe records only; no general runs/events layer or second Agent transcript. Tests prove sequential transitions, observed-zero success, immutable terminals, 64 KiB/check and 256 KiB/attempt tails, 20 terminal records and seven-day expiry while active records remain. |
| Truthful freshness | Inputs include root, revision/check definitions, pinned image, applicable bounded context and pnpm/package/yarn lockfiles (4 MiB total). Explicit provenance outside cwd ancestry is included. No recursive dependency-tree scan. Tests verify 15-minute expiry and all specified invalidation classes; no measurement is an extra Agent admission gate. |
| Operator access and Team ownership | All six endpoint operations are under existing auth/CSRF management middleware; Team ID scopes receipt lookup/cancel. Review uses the same request/definition types in CLI/web. New endpoint/browser tests and unchanged security gate cover the access boundary. |
| Canonical backup and deletion | Backup schema validator covers every new object; restore conversion is inside staged DB transaction; 47 backup/restore/result tests passed. Team deletion is coordinated before cascades; unresolved writers cannot disappear via Team FK deletion. |
| Preparation recipe and runtime independence | Official Node 24.13.0 image digest and pnpm 10.28.2 pinned in `examples/coding-environment/Dockerfile`; documented explicit installation uses only workspace and temporary package store. Real linked fixture exercises all required invocation paths without host caches or runtime network. |
| Scope limits preserved | No managed worktrees, persistent service/container, network allowlist, probe approval UI, code-snapshot/diff model, BAZ-041/042 implementation or publication. Host external writers/hard-link/remote-filesystem coordination remains outside this contract. |

## Reproducible evidence

- Latest complete application suite: `/tmp/baz040-host-final-suite.log` — 1,524 passed, seven skipped.
- Security gate: `/tmp/baz040-host-security.log` — 60 required cases;
  `/tmp/bazilion-security-acceptance-505698.json` contains the report.
- Root typecheck, lint and package build: `/tmp/baz040-host-{typecheck,lint,build}.log`;
  web typecheck: `/tmp/baz040-final-web-typecheck.log`.
  Lint exits zero with existing warnings. Latest web build: `/tmp/baz040-final-web-build.log`.
- Final linked-repository transport fixture: `/tmp/baz040-prepared-mCoUYr/`,
  `/tmp/baz040-completion-equivalence.log`. Eight fake-provider requests; separate CLI, loopback gateway,
  Telegram and private-origin gateway commands recreated the probe's runtime evidence.
- Actual image: `sha256:40c693a749d9fefe0d206c2716375cc57eb44edd9bf37a29c883c7f9d4c24839`;
  Node v24.13.0, pnpm 10.28.2. Private-origin fixture communicates with the loopback listeners as
  the HTTPS terminator would; it tests the production origin/session/CSRF and protected invocation
  profile, not deployment of a real Tailscale endpoint.
- Actual daemon restart: `/tmp/baz040-daemon-probe-restart.log`.
- Actual unsupported runtime/output matrix: `/tmp/baz040-real-limits-final.log`.
- Final real Docker matrix including incompatible native modules: `/tmp/baz040-final-docker-matrix.log`
  — four tests in three files passed (limits test exercises seven distinct failures plus output bounds).
- Worker/restore recovery regressions: `/tmp/baz040-output-recovery-regression.log` (25 passed).
- Current desktop/mobile browser evidence: `/tmp/baz040-ui-lesrDO/`,
  `/tmp/baz040-final-browser.log`. Settings and result views visually inspected at both widths;
  no horizontal overflow or page errors. Probe review performs no execution; unauthenticated and
  missing-CSRF requests are rejected.

## Resolved host-recovery audit finding

Pi's `createLocalShellOperations` spawns host Bash with `detached: true` and tracks child PIDs inside
the worker. Those command groups are distinct from the daemon-recorded worker group and can survive
a worker SIGKILL. The runtime now records whether the actual worker can launch host commands before
delivering its input. Cleanup of such ownership requires an orderly exit observed by the owning
daemon, or proof that the recorded boot ended. A missing process/group alone is insufficient.
The real Pi regression kills its worker, observes detached Bash still alive, reopens the DB and
verifies competing work remains blocked. Even manually terminating the known shell is not treated
as proof of every possible descendant. Normal host turns still complete and release ownership.
Evidence: `/tmp/baz040-host-recovery-final-tests.log` — 28 tests passed. The conservative host-boot
recovery limitation is documented in the operator guide; it preserves the required unknown state.

All images, homes, credentials, repositories, providers and Telegram inputs used for these checks
were disposable fixtures. Prepared image and `/tmp` evidence remain available locally. No personal
runtime state or live provider/Telegram traffic was used. Final repository/status/diff review and
ledger reconciliation are complete. The full local implementation goal is satisfied; publication,
merge and release remain separate and have not occurred for these changes.
