# Agent-led repository work

Decision date: 2026-09-09. Product design for revised
[BAZ-039](../in_progress/BAZ-039-repository-coding-context.md) and
[BAZ-040](../in_progress/BAZ-040-coding-environment-readiness.md).
The remake is implemented locally; see [acceptance evidence](../BAZ-039-040-agent-led-acceptance.md). Merge and release remain separate.

## The experience

The operator links a repository to a Team and asks an Agent to do work. Linking establishes the
workspace boundary; configuring a test checklist is not part of assigning the task.

Example: **“Fix the login bug and run the relevant test.”**

| Situation | Agent action | What the operator sees |
| --- | --- | --- |
| New repository/scope | Resolve instructions and source-backed commands | “The login code is under app; I found its test command.” |
| Existing usable tools/dependencies | Execute the relevant check and investigate the failure | Current command and expandable result |
| Missing dependency, available offline artifacts | Prepare dependencies inside the permitted workspace and try again | “Dependencies were missing; I installed them from the local store.” |
| Download required in a network-disabled turn | Stop that step and explain exactly what is missing | A concrete prerequisite/action, not a generic configuration form |
| Useful existing specialist | Send the scoped request, end this turn, let the peer work and reply | “Alex is checking the environment”; only after delivery is accepted |
| Check succeeds after the fix | Report the observed exit and scope | “The login test passed. I did not run the full suite.” |

The operator does not choose runtime probes, manage their order, save named checks, or repeatedly
click review/run. Agents make task-related choices through existing authority. Questions and
approvals appear only for ambiguity, unavailable resources or guarded actions.

## Responsibility split

| Owner | Responsibility |
| --- | --- |
| Pi | Model/tool loop, existing session transcript, normal Agent tool selection |
| BAZ-039 resolver | Applicable repository context, source identity, safe bounded inspection |
| Agent | Investigation, command choice, bounded repair, deciding whether a teammate is useful |
| BAZ-040 adapter | Actual environment description and bounded command receipts using the admitted shell |
| Existing daemon services | Policy, credentials, workspace ownership, process cleanup, IPC, messaging and continuation |
| Existing Team memory | Reusable recipes and lessons, explicitly labelled with scope/source and not treated as fresh proof |
| Operator | Task intent, optional durable defaults, decisions/resources that exceed current authority |

No new Project entity, preparation Agent type, planning service, job scheduler or general execution
engine. Profiles may describe expertise, but do not grant authority. Pi's ambient extension/skill
loaders stay disabled; the current Bazilion-managed instructions/skills contract remains intact.

## Tools and admission

The following names/shapes are the worker-facing contract. Runtime implementation must
use hermetic wire types and turn-bound IPC; the model never chooses a Team, provider or host root.

```ts
repository_context({ target: 'app/login.ts' })
coding_environment({ target: 'app' })
coding_command({
  command: 'pnpm test -- login',
  cwd: 'app',
  purpose: 'test',
  timeoutSeconds: 120,
})
```

- `repository_context` already exists. It resolves a bounded scope and replaces effective repository
  instruction inputs. Update its guidance so the normal coding task uses it without a UI visit.
- `coding_environment` is new and read-only. Return the admitted posture, canonical workspace
  identity, current virtual cwd, Docker image identity when applicable, relevant input identities,
  persistent/temporary locations and restrictions. Tools listed in documentation are expectations
  until actually measured. Status reads do not launch version checks or install anything.
- `coding_command` is a small adapter over the **same admitted shell backend and lifecycle as the
  worker**, including the approval wrapper, cwd validation, abort signal and lifecycle callbacks.
  It adds declared purpose and a bounded receipt; it must not call the old operator-probe HTTP route
  or acquire a second writer lease while its Agent already owns the workspace. Ordinary Bash stays
  available under existing policy; it never confers a typed verification receipt by model assertion.
- Resolve any new target's instruction chain before executing there. Command cwd may vary within
  the contained workspace; environment, ownership and image do not change midway through a turn.
- Each command requires a tool call, but normal permitted calls need no additional approval UI.
  Dangerous-command policy is unchanged. In a surface without an approval executor, return blocked.
- Use existing terminal reasons and finite limits. Parent cancellation reaches the command's
  subprocess/container. Cleanup completes before writer ownership is released; uncertain cleanup
  remains recovery-required rather than being papered over by a success message.

## How preparation works without prior Team setup

There are two different prerequisites:

1. **Installation-level capability:** a working execution backend and a locally prepared base
   toolchain. Bazilion needs these just as it needs a configured model provider. Keep one global
   supported Node/pnpm image recipe; an operator may optionally override it for a Team. The normal
   task does not require that override or an environment `enabled` flag.
2. **Repository-specific preparation:** inspect the package manager/lock, determine whether required
   packages are usable, install from available offline artifacts when authorized, and run commands.
   The Agent performs this during the task in its actual environment.

Do not “solve” missing downloads by secretly switching to host execution. Under today's protected
runtime, downloads and network services remain unavailable. The Agent must name the smallest
missing prerequisite and ask for it once, then yield. A prepared runtime or offline dependency store
can be supplied, and the next turn re-admits the environment before continuing. A user answering
“Yes, download it” cannot make a nonexistent network provisioning service available.

Automatic network-enabled dependency provisioning would need its own reviewed executor contract
(package source/integrity, scripts, redirects/SSRF, credentials, network scope, cleanup). It is a
separate future increment, not hidden inside a shell toggle or required for the offline Agent-led
slice. This is an explicit limit: the revised feature reduces advance repository configuration; it
cannot guarantee unattended setup of every project under a network-disabled runtime.

For the first acceptance recipe, use a compatible Node/pnpm image and a workspace-local package
store. The Agent executes an explicit lock-preserving offline install with scripts disabled, then
uses the resulting dependencies from a fresh container. It must not assume temporary files,
installed system packages or background processes survive command completion.

## One or more Agents in the same Team

Cooperation is supported; simultaneous mutation of one checkout is not promised.

```mermaid
sequenceDiagram
  participant User
  participant Coder
  participant Daemon
  participant Helper
  User->>Coder: Fix the login bug
  Coder->>Daemon: Resolve scope and attempt relevant command
  Daemon-->>Coder: Missing dependency in admitted environment
  Coder->>Daemon: send_message(helper, scope + blocker + allowed evidence)
  Daemon-->>Coder: Accepted / pending approval / denied
  Note over Coder,Daemon: On accepted handoff, coder ends its turn; cleanup completes and lease releases
  Daemon->>Helper: Existing inbox dispatch admits helper turn
  Helper->>Daemon: Inspect and prepare using ordinary admitted tools
  Helper->>Daemon: Reply with findings and allowed receipt reference
  Note over Helper,Daemon: Helper ends turn; cleanup and lease release
  Daemon->>Coder: Existing reply dispatch admits continuation
  Coder->>Daemon: Revalidate inputs/environment and continue
  Coder-->>User: Scoped result through normal egress policy
```

A sender must not block in `wait_for_reply` while the receiver needs the sender's workspace lease.
Add a narrow guard to that existing tool for same-workspace pending work: explain that the Agent
must finish this turn and resume from the reply. Do not release ownership around a live Bash process,
paused approval or other active worker. The handoff uses existing message IDs/reply correlation;
there is no newly persisted “coding task” workflow. Denied/held communication retains its current
semantics, and scheduling retains its existing bounded deferral behavior.

Send only relevant scope, source references, command intent, observed blocker and authorized
receipt references. A peer performs its own context refresh. It cannot inherit a host permission,
credential, stale measurement or instruction snapshot simply because the sender had one.

## Shared findings, measurements and access

Three existing/constrained stores serve different purposes:

- **Pi transcript:** canonical sequence of tool calls and conversation. No second transcript.
- **Team memory:** deliberately shared recipe/lesson (“app uses pnpm; local store is …”). Include
  source identity and execution constraints. It is a hint, not an instruction override or proof.
- **Bounded receipts:** exact command/cwd/purpose, producing Agent/turn/tool call, actual posture and
  immutable Docker image when relevant, source identities, timestamps, observed exit/termination,
  redacted bounded tail. Keep the existing seven-day/20-terminal-record Team cap and truthful expiry.

Reuse the local receipt primitives after adding Agent ownership and access semantics. An operator
probe currently has a different principal from an Agent command; do not relabel old rows as Agent
output or expose future Agent rows through an unfiltered Team management endpoint. Producing-Agent
reads are turn-bound. Cross-Agent receipt reads must be bound to an authorized message/reference,
revalidate current membership and policy, and return only the captured allowed evidence. Operator
presentation/replay uses existing Agent-to-user egress and approval dispatch. A reference is not a
bearer credential. No raw private session access is introduced.

Measurements are operation-specific. “Node ran here” does not mean a database exists or all tests
pass. Input/runtime/ownership changes, restart/restore and the 15-minute reuse horizon yield stale
or unknown applicability. Do not gate all command execution on a generic readiness score or on
Node-specific manifest presence. Code-snapshot binding and full command logs belong to BAZ-041.

## UI and client changes

Primary presentation belongs to the existing conversation:

- Short findings in the Agent's response, normal tool activity while working, expandable receipt
  details for completed commands, and the existing question/approval interaction for blockers.
- A concise handoff summary only when authorized; never show a fictional helper as working while
  the message is denied or waiting for approval.
- The result distinguishes preparation performed, actual tests run and work left unverified.

Remove the new mandatory-feeling Repository & coding command-management workflow from the Team
page. Keep useful passive inspection and optional image/cwd defaults under advanced diagnostics or
settings. No default global “ready” badge, named-check checklist or repeated per-command review
screen. Read-only diagnostics and optional configuration retain HTTP/client/CLI parity. Web/CLI
chat consume the same tool receipt vocabulary; Telegram uses existing output/approval boundaries.
Manual advanced diagnostics may remain useful, but must not bypass Agent receipt access rules.

## Adapt the existing implementation

| Existing piece | Decision |
| --- | --- |
| Repository resolver, scope limits, Pi context replacement, IPC | Keep; change prompts and acceptance to real task discovery |
| Protected Docker executor, immutable image binding, cwd mapping, secret scrubbing | Keep; use the identical admitted executor for Agent commands |
| Writer admission, child/container recovery, cancel/timeout handling | Keep; make Agent-command participation independent of the old environment enable toggle |
| Optional Team image/cwd/env defaults | Keep as advanced overrides, never a requirement for ad hoc commands |
| Named check configuration and operator-only probe dispatch | Retire from primary flow; do not reuse operator identity to execute Agent work |
| Bounded receipt/freshness primitives | Refactor for Agent ownership and policy-checked evidence access; no generic readiness verdict |
| Repository/coding tabs and standalone history UX | Replace primary placement with conversation activity/results and optional diagnostics |
| Pi tools/events, existing messages/inbox, questions/approvals, Team memory | Reuse; add the smallest adapters/guard rather than a new workflow engine |

The alpha schema is clean-install only. Edit the canonical schema and backup validation where
ownership changes require it; do not add legacy importers, compatibility aliases or ALTER migrations.
Preserve original implementation evidence as historical evidence. PR publication, release and
production acceptance remain separate from this revised design.

## Delivery checkpoints and validation

1. **Agent discovery:** update root/target context guidance and build a deterministic fake-provider
   conversation against an unconfigured linked Team. Verify nested instructions and provenance,
   and that passive discovery executes nothing.
2. **Actual environment and command adapter:** expose admitted capabilities and bounded ad hoc
   operations, without a saved check list or second lease. Test host/protected separation, cwd,
   immutable image identity, exact shell approval, cancellation, output limits and receipt access.
3. **Preparation and blockers:** reproduce missing dependencies, have the Agent install from an
   offline store, then run the test in a fresh container. Repeat without available artifacts and
   verify one concrete blocker, no network fallback and honest resume after actual provision.
4. **Same-Team cooperation:** exercise authorized, denied and held peer requests, sender turn exit,
   receiver admission, reply and continuation. Assert no overlapping writers and no lease-held wait.
   Repeat with changed input/runtime to prove no stale measurement is trusted.
5. **Operator journey:** use the usual manual-semiauto fixture. Start with a coding request in chat,
   observe discovery, preparation and actual results; repeat with an existing helper and a blocker.
   The operator must never need to open environment settings for the successful offline fixture.
6. **Regression:** retain resolver/isolation/auth tests, add adversarial receipt/peer-access coverage,
   run appropriate root/web checks and the security acceptance gate. Reconcile docs/schema backup
   validation. Record the new criteria separately from the old operator-probe acceptance.

Completion means the Agent-driven task and cooperative variation are demonstrated, not merely
that the previous dashboard can still run commands. The
[successor review](coding-successors-review.md) narrows BAZ-041 to live progress and retained
diagnostics; BAZ-042 owns source snapshots and applicability; BAZ-043 adds static review; and
BAZ-044 is formal snapshot-bound tester delegation rather than a dependency for basic help.
