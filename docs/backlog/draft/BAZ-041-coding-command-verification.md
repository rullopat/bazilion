---
id: BAZ-041
title: Live coding command output and snapshot-bound verification
status: draft
size: L (1-2 weeks)
created: 2026-09-07
priority: high
note: Reuse Pi tool events and existing shell admission; retain bounded evidence without a general execution engine.
---

# BAZ-041 — Live coding command output and snapshot-bound verification

## User stories

- **As an operator watching a coding Agent**, I want to see a command's output while it runs,
  so a long build or test does not look like a silent, stalled conversation.
- **As an operator reviewing a change**, I want actual check outcomes tied to the code tested,
  so a claim that tests passed cannot refer to an older or different working tree.
- **As a coding Agent investigating a failure**, I want to retrieve the retained command output,
  so truncation does not hide the useful error or send me to an inaccessible temporary path.
- **As an operator returning after a disconnect**, I want to reopen available command evidence
  and distinguish failure, cancellation, and unknown outcomes, so interrupted work is not mistaken
  for a successful check.

## Goal

Expose bounded live tool output and retained logs through the existing Agent turn, and record
execution-owned check receipts for the command, environment, snapshot, and outcome. Distinguish
successful exit from evidence freshness; a passing command does not prove code correctness.

## Why and current baseline

- [Pi event translation](../../../apps/daemon/src/runtime/pi/events.ts) exposes final tool results,
  but discards `tool_execution_start`, `tool_execution_update`, and structured result details.
- The pinned Pi 0.85.1 shell tool streams output updates, truncates its displayed tail, and can
  report `details.fullOutputPath` for a temporary output file. Its operation boundary receives
  the process exit status; the public result does not provide a complete verification receipt.
- [Protected scratch](../../../apps/daemon/src/runtime/worker/runtime.ts) sets worker temporary
  paths; [worker cleanup](../../../apps/daemon/src/runtime/worker/spawn.ts) removes that scratch.
  A host temporary path is neither a durable log nor a readable protected-container file.
- [Shell tooling](../../../apps/daemon/src/runtime/shell/tooling.ts) and
  [Docker operations](../../../apps/daemon/src/runtime/shell/docker.ts) already own execution
  posture and cancellation. Verification must observe those operations, not add a host runner.
- Existing [file delivery](../../../apps/daemon/src/runtime/tools/deliver-file.ts) is explicit
  Agent publication; automatically retaining a diagnostic log is a different visibility decision.

Primary references: [Pi SDK at v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md#events)
and [Pi shell implementation at v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/tools/bash.ts).

## Scope

### Live execution and retained output

- Carry tool start, bounded output updates, and terminal status through hermetic HTTP/IPC types,
  tied to the existing Agent/session/tool-call identity. Handle Pi's cumulative output snapshots
  explicitly: repeated updates must replace the displayed tail rather than append duplicate text.
- Show elapsed time and a bounded tail while running. Throttle updates, bound buffering and
  subscriber queues, and prevent a slow/disconnected client from blocking the command or worker.
- Retain validated output bytes in daemon-owned storage before protected scratch disappears.
  Use opaque log references, ordered chunks, and explicit completion/truncation metadata; never
  expose an arbitrary path supplied by the worker as a download or log-read capability.
- Enforce per-command byte limits, read-page limits, storage quotas, and retention. A limit hit
  must say that only part of the output was retained; do not call a capped log "full output".
  Handle non-UTF-8 bytes, terminal control sequences, huge single lines, and disk failure safely.
- Distinguish command completion from log persistence. Missing evidence or failed finalization
  cannot produce a verified-pass badge even if an observed process exited zero. Preserve any
  independently known execution outcome with an explicit log-unavailable state.
- Expose bounded read/search access to the producing Agent through daemon IPC, including in
  protected mode. Bind requests to the actual Agent/session/turn and retained log ownership;
  no host file reads, cross-Agent arbitrary IDs, raw secret values, or wider filesystem mounts.
  Later turns may retrieve eligible earlier logs through the same validated ownership path.

### Check receipts and snapshot validity

- Record structured facts from the execution boundary: exact command and cwd, Agent/session/tool
  identity, execution posture, toolchain/image identity where known, start/end time, observed exit
  code or termination reason, and log reference. Environment metadata names the execution context;
  it must not dump inherited environment variables, API keys, or provider credentials.
- A selected check has a name and command, with optional provenance from repository command
  suggestions. Ordinary shell commands can show execution receipts without being classified as
  tests. Agent prose, output saying "PASS", or a generic non-error tool result is not evidence.
- A manual **Run check** action uses existing authenticated Agent admission and shell policy,
  including busy-Agent handling, communication authorization, sandboxing, and command approvals.
  It cannot spawn an unsandboxed daemon command or inherit an expired approval for changed input.
- Observe explicit success, nonzero exit, timeout, cancellation, spawn/preflight failure, and
  interrupted/unknown outcomes. A killed worker or missing terminal acknowledgement is unknown,
  never success. Do not automatically replay commands after a daemon/worker interruption.
- Agree the code-snapshot contract with BAZ-042: include HEAD/index and dirty tracked content,
  plus explicitly included untracked files; record exclusions and coverage limits. Do not bind
  evidence only to the branch name or commit SHA while ignoring working-tree changes.
- Capture before/after snapshot identity and detect relevant changes while a check runs. Changes
  to included tracked or untracked content, or changed exclusion/coverage rules, invalidate its
  applicability. An incomplete or concurrently unstable snapshot yields unknown applicability.
- Preserve historical outcomes after later edits, but mark them stale for the current snapshot.
  A check that mutates relevant source may have exited zero without verifying the final tree.
  Shared-Team writers cannot silently make one Agent's passing result cover another Agent's edits.
- Current applicability also requires the captured check definition, environment revision, and
  known image/toolchain/dependency identity to match. Changed or unavailable execution context
  cannot leave a current-pass badge merely because source files are unchanged.
- Keep Pi JSONL authoritative for the conversation and link receipts/log references to existing
  source identities. Any durable metadata is narrowly scoped command/check evidence, not a second
  transcript, general runs/events table, workflow history, or background-process registry.

### Access, publication, and surfaces

- Separate privately retained diagnostics from operator-visible output. Reuse BAZ-034 storage,
  retention, access, and publication primitives where suitable, but log capture alone is not
  `deliver_file` and does not automatically publish logs into the Team results library.
- Agent-to-user live output, retained-log links, list/detail/read/download, transcript replay,
  and Telegram retrieval must honor the same source-owned egress decision. Denied or approval-held
  output cannot become readable through a new endpoint. Reuse the captured approval identity;
  approving output releases that snapshot, not freshly generated or reread bytes.
- Apply bounded redaction before retained or emitted output becomes accessible, including known
  runtime credentials split across chunks. New provider tokens acquired during a turn join the
  redaction set. Do not store a second unredacted operator-download version. Redaction is bounded
  protection against known values, not a promise to detect every secret a program may print.
- Provide web execution cards and a checks list showing command, current state, snapshot match,
  log availability, and explicit gaps. Links open paginated safe text; no terminal escape execution
  or active HTML. Keep history truthful after expiry/deletion and across reconnect/restart.
- Add CLI parity for check selection/execution and receipt/log inspection with machine-readable
  status. Telegram uses concise progress/outcome notices and an authenticated gateway log link or
  owner-validated retrieval, preserving egress checks and avoiding verbose streamed chat flooding.
- Existing mobile chat must preserve status and references with a supported gateway handoff;
  native command consoles and native checks-management screens remain outside this slice.

## Dependencies and sequencing

- [BAZ-039](BAZ-039-repository-coding-context.md) may supply command suggestions; manually selected
  checks do not require its full context UI. Command discovery never grants execution permission.
- [BAZ-040](BAZ-040-coding-environment-readiness.md) supplies readiness for protected repository
  checks; generic live output/receipt plumbing can land first with deterministic fixture commands.
- [BAZ-042](BAZ-042-git-change-review.md) shares snapshot identity, exclusions, and freshness
  semantics. Agree that contract first; neither story requires the other's full presentation UI.
- [BAZ-034](../in_progress/BAZ-034-durable-agent-deliverables.md) informs retained-byte lifecycle and access.
  Resolve log-specific expiry and internal Agent access without making every log a published result.
- Deliver bounded streaming and retention first, then snapshot-bound check execution and clients.
  Split implementation if both cannot fit L without weakening admission, evidence, or access rules.

## Acceptance criteria

1. A long-running command shows bounded changing output before completion in web and CLI, without
   repeated-tail duplication, unbounded buffering, or cancellation/reconnect races.
2. Retained output remains readable within its declared retention after worker scratch cleanup
   and daemon restart; the producing protected Agent can inspect it without host access.
3. Every check shows execution-derived metadata and separates a zero exit from evidence freshness.
   Failure, timeout, cancellation, lost worker, absent terminal result, and missing logs stay distinct.
4. Dirty tracked edits and included untracked additions/edits/deletions invalidate old evidence.
   Concurrent mutation or incomplete snapshot coverage cannot be labeled verified for the final tree.
5. Manual and Agent-requested checks obey the existing turn, shell, approval, and protected-runtime
   boundaries. Missing toolchains or sandbox prerequisites never trigger an alternate host runner.
6. Denied/held egress stays inaccessible through every new surface, including Telegram links and
   replay; approval releases only captured authorized output. Cross-Agent log access fails closed.
7. Quota, truncation, redaction, expiry, deletion, and storage failures produce truthful states;
   native clients retain a usable fallback rather than discarding unfamiliar receipt fields.

## Out of scope

General job scheduling, persistent terminals/dev-server management, CI hosting, automatic retries,
automatic dependency installation, changing sandbox/network policy, test-framework result parsers,
coverage dashboards, public log URLs, automatic publication, and claims of code correctness.

## Tests and verification

- Use deterministic commands for incremental output, nonzero exit, huge lines, binary/control
  bytes, timeouts, cancellation, killed workers, lost acknowledgements, and reconnect replay.
- Exercise log transfer/finalization and scratch cleanup under disk/quota failures and restart;
  verify bounded protected IPC retrieval, ownership, known-secret chunk splits, and token refresh.
- Verify snapshot coverage for staged/unstaged tracked files and included untracked files, stale
  evidence after edits, concurrent writers, changed exclusions, and checks that mutate source.
- Cover manual-check admission, protected-preflight denial, approval-held HTTP/Telegram egress,
  expiry/revocation, CLI JSON, mobile fallback, backup/retention, and narrow keyboard-accessible UI.
- Run relevant full repository checks and adversarial security acceptance before release.

## Open Questions

- **Retention:** recommend short explicit log expiry and a storage cap, with optional deliberate
  publication through BAZ-034 for longer retention. Agree backup inclusion and expiry tombstones.
- **Snapshot coverage:** recommend a visible shared BAZ-042 inclusion policy and conservative
  stale/unknown states; do not hash all ignored dependencies or imply excluded files were verified.
- **Check declarations:** recommend operator-selected exact commands first; defer parsing test
  frameworks and automatic check selection until actual coding use demonstrates a need.
- **No usable snapshot:** recommend show the command outcome with "code snapshot unavailable";
  allow useful execution diagnostics without awarding evidence for an unidentified code state.
