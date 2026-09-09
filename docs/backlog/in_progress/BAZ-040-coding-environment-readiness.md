---
id: BAZ-040
title: Agents prepare and check their environment during a task
status: in_progress
size: L
created: 2026-09-07
refined: 2026-09-09
priority: high
note: Agent-led remake implemented and validated locally; PR review, merge and release remain pending.
---

# BAZ-040 — Agents prepare and check their environment during a task

## User stories

- **As an operator**, I want an Agent to discover and resolve routine environment needs while doing
  my coding task, so I do not have to define its runtime/dependency/test checklist in advance.
- **As a coding Agent**, I want to run a relevant command in my actual environment, prepare what is
  permitted, and distinguish a missing prerequisite from a failing test, so I can keep progressing.
- **As an Agent handing work to an existing teammate**, I want to share the operation, environment
  facts and blocker, release the workspace, and resume from the reply without repeating setup.
- **As an operator**, I want a precise request only when preparation needs authority or resources
  the Team lacks, and actual command results when it finishes.

## Goal

Make environment investigation and bounded preparation part of an ordinary Agent turn. An Agent
may choose ad hoc commands and prepare compatible workspace dependencies within its existing
permissions. An operator-created environment configuration, named check or explicit probe request
is not a prerequisite. The normal user experience is a coding conversation, not Team configuration.

Full design and implementation mapping: [Agent-led coding](../design/agent-led-coding.md).

## Primary workflow

1. Use BAZ-039 to discover the relevant scope and commands; obtain the **actual admitted execution
   environment** through a read-only `coding_environment` tool. Inspection runs no project code.
2. Call `coding_command` with an exact command, Team-relative cwd, purpose and finite timeout.
   Examples are checking Node, resolving a package, preparing dependencies from available local
   artifacts, and executing the project's test command. No saved list or arbitrary readiness
   selection is required. The tool delegates to the existing admitted shell executor.
3. On failure, inspect the result and relevant sources. Make bounded, task-related repairs when
   permitted and retry explicitly. A failed test is not automatically classified as a setup issue.
   No hidden installation loop or framework-managed retry queue.
4. If downloads, another runtime, credentials or services are unavailable, report the exact blocker
   and the smallest next action. Reuse questions/approvals where supported. A question answer does
   not itself change network policy, grant credentials or approve unrelated commands.
5. Optionally hand the preparation to an existing teammate through normal policy-checked messaging.
   End the current turn, finish child cleanup and release workspace ownership before that teammate
   can execute. The teammate replies through existing inbox dispatch; the next turn revalidates
   environment/input identities. One Agent must be able to do the entire workflow without delegation.
6. Report what was executed, what was prepared, and the relevant outcome in the existing conversation.
   Team memory can retain a source-backed recipe; measured evidence remains a bounded tool receipt.

## Execution and preparation contract

- Existing invocation policy chooses host or Docker/protected execution. `coding_environment` reports
  that actual posture, cwd, restrictions and (for Docker) immutable image identity. Never run a
  separate Docker “readiness probe” and imply it describes a host Agent, or vice versa.
- Freeze effective runtime and workspace identity at turn admission. Use the global prepared
  toolchain by default, with optional operator Team overrides. Agents do not need to edit Team
  configuration and cannot write durable image, mount, network or credential policy.
- A supported global Node/pnpm runtime can be provisioned once for the installation. Repositories
  then need no per-Team setup. If that runtime is absent, report it honestly and request the narrow
  operator provision step; this story does not silently build or download images.
- `coding_command` is a typed adapter over the admitted shell, not a privileged daemon shell or
  second executor. Worker-supplied Team ids, host paths, image ids and posture switches are rejected.
  Protect private home, skills, Team memory and other mounted inputs exactly as ordinary Bash does.
- Purposes: `runtime`, `dependency`, `prepare`, `build`, `test`. These describe intent and receipts,
  not new permission categories. Bounds: command 4 KiB, timeout 1–300 seconds, 64 KiB retained tail
  per operation, known-secret redaction and inert control/HTML rendering. Existing turn limits apply.
- Normal authorized commands do not require a new operator review click. Existing dangerous-command
  approval remains exact and independent. Missing approval support yields a concrete blocked result.
  A task request is not authorization for unrelated deletion, publication or policy changes.
- Safe offline preparation is in scope: use available toolchains/artifacts, writable workspace
  dependency directories and ordinary project tooling. Explain changed files; do not delete/reset
  unrelated work. Observe repository instructions and current user constraints before changing locks
  or invoking dependency lifecycle scripts. For the supported recipe prefer lock-preserving offline
  installation with lifecycle scripts disabled; missing artifacts are a blocker, not success.
- Protected Docker commands retain fresh containers, read-only root, no network, bounded temporary
  storage and no ambient credentials/caches. Installing a system package into a discarded container
  is not durable preparation. Workspace dependencies can persist if compatible with the next image.
- A globally configured host turn uses host behavior under its existing policy; do not label it
  isolated. Host network availability does not license a protected teammate to use host execution.
- Online dependency provisioning is **not implemented by this slice**. If an operation requires
  network that the admitted runtime lacks, the Agent gives the exact missing prerequisite and
  operator action, then yields. Download approval without a capable executor cannot resume it.

## Shared-Team coordination and evidence

- Reuse canonical workspace writer ownership across every ingress. No overlapping mutating turns
  in the same/aliased root. Different existing workspaces can proceed independently; managed
  parallel checkout lifecycle remains outside scope. No claim of concurrent editing inside one Team root.
- A blocked peer handoff must not use `wait_for_reply` while retaining the lease the peer needs.
  Add a clear tool guard/guidance for this condition. Existing message delivery/pending approvals
  and inbox dispatch own continuation; denied delivery is not a successful handoff.
- Release only after processes/containers are confirmed stopped. Keep cancellation, timeouts,
  restart recovery, restored identities and unknown cleanup conservative. Never replay a lost command.
- Receipts bind producing Agent/turn/tool call, Team/root, cwd, command/purpose, actual runtime,
  relevant instruction/manifest/lock fingerprints, timestamps, exit and terminal reason. Execution
  sets these fields; model prose cannot manufacture success or change receipt identity.
- Reuse/refactor the narrow local receipt storage and retention (20 terminal records/Team, seven
  days; active entries bounded separately), keeping Pi JSONL as the canonical conversation. No
  general runs/events table and no code-snapshot claim. Expired evidence remains unavailable.
- Reuse is advisory: “Node was available for this command under these inputs at this time.” Changed
  scope, source, workspace, image, posture, restore/restart or age (15 minutes) invalidates reuse.
  Missing required dependency inputs yields unknown applicability; non-Node projects do not get
  blocked from all commands merely because they have no package.json or lockfile.
- Preparation success and environment capability are separate from code correctness. A test exit
  describes the command at that time. Snapshot-bound verification and retained full logs are BAZ-041.
- Producing Agent can inspect its bounded receipts. Another Agent must receive a policy-authorized
  handoff reference; same-Team membership alone grants no access to private transcripts or logs.
  Receipts must not become an unauthenticated or policy-bypassing Team-page publication channel.
  Current egress/replay/approval authorizers govern operator-visible command details.

## Product surfaces

- Primary: Agent chat and existing CLI/Telegram conversation surfaces. Show concise task activity,
  the current blocker/required decision, and expandable results via Pi tool events. No new setup
  wizard, saved-check editor, per-command review screen or generic Team “ready” badge in this journey.
- Secondary: advanced Team defaults and read-only repository/runtime diagnostics with API/client/CLI
  parity. They help troubleshooting; they do not gate starting a coding task.
- Preserve transport truthfulness: background/Telegram/private-gateway tasks still use protected
  execution and existing approval/egress paths. No Telegram-only execution protocol is needed.

## Acceptance criteria

1. On a disposable linked repo with only installation-level runtime prerequisites, an ordinary
   “fix the bug and run the relevant test” message reaches discovery, checks, edit and test result
   without visiting Team settings, saving commands or launching an operator probe.
2. The Agent's ad hoc command and environment inspection bind to its admitted posture/image/cwd.
   Host and protected fixtures cannot reuse each other's capability evidence. Unsupported runtime
   or unsafe paths cannot cause host fallback, broader mounts or new credentials.
3. A fixture with a compatible workspace-local offline package store starts with missing installed
   dependencies. The Agent discovers the need, installs using a lock-preserving offline command,
   then uses those dependencies in a later fresh container and runs the test. No setup checklist.
4. With the same fixture but missing downloadable artifacts, the Agent reports the precise blocker
   and necessary operator action, without a network/policy bypass or claiming readiness. The task
   can continue in a new admitted turn after that prerequisite is actually supplied.
5. A single Agent succeeds independently. In a separate two-Agent fixture, a permitted handoff
   releases ownership before the peer starts, the peer replies with scoped findings/evidence, and
   the original Agent resumes through existing messaging without deadlock or concurrent writes.
6. Denied/approval-held peer messages, unknown cleanup and stale evidence produce visible truthful
   outcomes. No background retry storm, second task queue or read access to another private session.
7. Failure, cancellation, timeout and interruption remain distinct. Later work can run only after
   confirmed teardown. Input/image/posture changes and restore make previous reuse stale/unknown.
8. Agent-to-user egress denial/approval applies to tool results, receipts, replay and new diagnostics;
   source and command output render safely with bounded redacted retention.
9. Operator sees relevant discoveries, preparation and test results in the conversation, including
   what remains untested. Actual command failure cannot be replaced with a model-written success.

## Delivery and completion

Implement the shared design in order: Agent context/capabilities, admitted command adapter and
receipts, offline preparation, policy-checked yield/handoff, conversation presentation, then removal
of mandatory operator-probe UX. Preserve safety infrastructure and original regression coverage.

The [old acceptance audit](../BAZ-040-acceptance.md) and [progress](../BAZ-040-progress.md) cover the
previous operator-probe scope. The [2026-09-08 refinement](../archive/BAZ-040-2026-09-08-operator-refinement.md)
is archived. The revised criteria are covered by [remake acceptance](../BAZ-039-040-agent-led-acceptance.md). The story remains in progress until PR delivery and release.
No implementation goal is created or reopened merely by this refinement.

## Dependencies and exclusions

BAZ-039 supplies context and source provenance. Existing Pi turns, shell approval, messaging, Team
memory and workspace admission supply execution/continuation. BAZ-041 adds stronger command-log and
code-verification evidence; BAZ-044 adds a formal tester contract, not basic teammate cooperation.
Managed parallel checkouts remain outside scope. None is required to demonstrate this story's
same-Team sequential handoff. Exclude automatic images/downloads, new network brokers, service supervision,
new agent roles/rosters, dependency-update bots, Git publication and arbitrary devcontainer hooks.
