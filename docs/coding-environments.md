# Coding during an Agent task

Ask an Agent to do the work: **“Fix this bug and run the relevant test.”** There is no Team
checklist to fill out first.

The Agent receives root repository instructions when its turn starts. It can inspect a deeper
scope, discover source-backed commands, check the actual execution environment, prepare missing
prerequisites from available local artifacts, and run a finite command. Results appear alongside
that work in chat, with expandable output. A failed test is a result to investigate; it does not
send you to a configuration dashboard.

## What the Agent can do

| Tool | Purpose |
| --- | --- |
| `repository_context` | Resolve applicable instructions, Git state and suggested commands for a scope |
| `coding_environment` | Describe this turn's admitted host/Docker/native/protected posture, directory and restrictions |
| `coding_command` | Execute a task-selected runtime, dependency, preparation, build or test command |
| `coding_receipt` | Read retained command evidence and check whether its recorded inputs still apply |

Commands use the turn's admitted shell backend, approval policy, cancellation and resource cleanup.
They have a 1–300 second timeout. They do not start independent jobs or acquire another workspace
lease. No tool accepts a caller-selected Team or host execution override.

Pi owns the model/tool loop and canonical session transcript. Bazilion supplies bounded repository
context and the execution adapter. Existing Bazilion-managed skills remain available; this change
does not activate ambient Pi extensions or repository-provided executable plugins.

## Trusted Mac host execution and explicit Linux isolation (unreleased 0.25)

| Platform/posture | Current behavior |
| --- | --- |
| Mac operator work, `off` | Trusted **unisolated host execution**; commands use the OS user's filesystem/network permissions |
| Mac native/Docker selection | Refuses; generic native Mac isolation is deferred/unqualified and Mac Docker remains removed |
| Mac isolation-required protected coding or specialist checks | Unavailable; never downgraded to host execution |
| Linux `native` | Bubblewrap plus mandatory seccomp and per-turn owned admission |
| Linux `docker` | Independently selected retained backend; never a prerequisite/fallback for native |

Select `off` explicitly through Agent Shell Security / `bazilion config set BAZILION_BASH_SANDBOX off`
for trusted host work. Approvals and tool guards are not an OS sandbox. Stored native/Docker choices
are not rewritten as host execution. Team defaults alone do not select a backend; on Mac, optional
isolation defaults cannot be saved/activated and existing choices remain visible as unavailable.

Mac protected normal turns (including isolation-required schedules, inbox, Telegram and approval
delivery) and command-executing specialist verification refuse before execution. Existing closed
reviewer-only workers admit no shell/coding capability and retain their own provider-minimal and
fixed-tool contract; background invocation alone does not make a new shell-isolation requirement.
Ordinary MCP/browser and guarded Git keep their independent admission/ownership protections.

The native behavior below applies to supported **Linux** execution. The retained Seatbelt design is
[deferred development history](native-execution-design.md), not supported Mac containment. Missing
Linux mechanisms, toolchain drift or unsafe inputs refuse; arbitrary host tools or whole host library
trees are not implied.

Native `bash` and `coding_command` share one daemon-owned executor. Host-backed file tools are hidden;
Team memory, skills and admitted uploads are read-only to commands. Only closed Team environment
flags enter commands, never provider credentials or the Docker environment allowlist. TCP/UDP,
including localhost, are denied; explicitly admitted private job Unix IPC is not a localhost exception.
Native always uses dangerous-command approval: interactive turns may approve once, unattended turns
auto-deny. Ordinary separately admitted browser/MCP capabilities are not confined by the coding
sandbox; protected/restricted workers still deny them.

On Linux, health, doctor and Config report native selection as **Not checked** until real per-turn admission,
not an image or readiness badge. Unknown ownership/cleanup retains the resource and writer; persisted
receipts do not authorize signalling. Agent-requested native verification uses its bound producing
turn and the two-tool specialist. Operator capture through the existing HTTP/CLI/web verification
surface on Linux runs fixed readiness probes and positively retires them before storing native facts;
it does not execute the captured checks. JSON cannot supply environment facts or impersonate an Agent.
Capture is fenced/drained during shutdown. Backend changes refuse rather than substituting legacy
host/Docker execution; completed history is not rewritten. CLI/web distinguish captured native facts
from current readiness.

Native Bash failures retain bounded native retirement facts in the canonical transcript and error
text when available: phase, boolean observations and at most two census verdicts. These are
troubleshooting metadata, not process identity, cleanup authority or a successful check. An uncertain
attempt is never converted into success merely because later same-live-owner teardown retires its resources;
never replay its effects merely because a later capture is empty.

Queued operator input keeps its configured posture; approved deliveries and bound Telegram queue
input require their protected backend. They refuse on Mac when isolation is required; they do not
reuse ordinary host admission. Communication approval grants the captured input, not a shell
risk exemption: queued dangerous commands still auto-deny. Holds, pause and duplicate/denied decisions
cannot execute the input. Topic/owner/credential rebinding refuses delayed Telegram execution.
Cancellation reporting recognizes known abort messages only after an actual worker cancellation
signal; unconfirmed cleanup still requires recovery rather than a cancellation/success claim.

Historical native Mac source trials exercised configured workers, scheduled/inbox ticks and shutdown,
but did not qualify Mac isolation; failed CI and uncertain cleanup remain failed evidence. Current
Mac coverage exercises trusted host execution, protected refusal and retained independent boundaries.
Linux retains actual native execution checks. Installed Mac 27.0.1 arm64 / Node 26.12.1 and Linux
native/protected command and main-process lifecycle trials supply bounded actual evidence. The
0.25 alpha accepts the tested Mac 27.x major line; Mac headed/desktop qualification is deferred,
not a pass or an extra release gate. Synthetic loopback providers remain distinct from unobserved
live-provider/generated-image acceptance; public browser PNGs are not a substitute.

## Missing prerequisites

In a Docker-selected turn, every command runs in a fresh network-disabled container. Workspace
files persist; temporary files do not. The root filesystem and Team memory are read-only to shell
commands. There are no ambient host credentials or package caches.

The Agent can install from workspace-local artifacts or an available offline package store under
its existing authority. If a package must be downloaded, a service is unavailable, or the image
lacks a required tool, it should name the missing prerequisite and yield. It cannot silently switch
to host execution. Network-enabled dependency provisioning is outside this feature.

Docker execution is **Linux-only**. macOS isolation-required protected work is unavailable because
native Mac isolation is deferred/unqualified. Explicit/stored native or Docker selections refuse,
never silently convert to trusted host execution. No Docker Desktop, Colima or Linux VM is restored,
required or authorized for Mac support.

A local toolchain image is an installation prerequisite for Linux Docker execution, not a per-task
checklist. The supplied [Dockerfile](../examples/coding-environment/Dockerfile) contains Node and
pnpm. Build it explicitly from a source checkout:

```sh
docker build --pull=false -t bazilion-coding:node26-pnpm12 examples/coding-environment
```

The image build requires its base image and package-manager artifacts to be available. Set
`BAZILION_BASH_SANDBOX_IMAGE=bazilion-coding:node26-pnpm12` for the installation. Ordinary Agent
turns use Docker when `BAZILION_BASH_SANDBOX=docker`; protected turns always use their protected
runtime. Host execution remains host execution under its existing policy.

Historical 0.25 development trials recorded local ARM Docker coverage on **macOS 27.0.1 arm64**
with Node **24.22.0 / 26.4.0**, including approvals, scheduled/inbox workers, captured verification
and settlement. That is not native-backend or current Node 26.12.1 qualification. The approved
replacement and its integration limits are described in [native execution](native-execution-design.md).
Those Mac Docker trials remain historical only: the backend and its private qualification VM have
been removed from macOS support. Linux Docker still requires a responsive local Unix socket, admitted
local image and accessible mounts. Historical failures and unfinished installed/native acceptance
remain distinct in [BAZ-072](backlog/in_progress/BAZ-072-apple-silicon-feature-parity.md).

Docker admission gives each OCI **create** and isolated **probe-start** operation a fixed
**five-second** budget on every supported platform; metadata inspection keeps its separate
two-second bound. The probe runs only the fixed `true` command through the required shell/env
under the protected mount/network/environment policy, before any model invocation. Caller
cancellation interrupts create/start and still waits for exact-container cleanup; unconfirmed
cleanup retains ownership. Cleanup bounds/retries are unchanged. This admission budget neither
extends a coding command's declared timeout nor enables startup retries, host fallback or CI-only
overrides.

A known protected-runtime admission refusal returns HTTP **409** with
`code: "protected_execution_unavailable"` and daemon-authored remediation. CLI and web share this
response; a closed `engine`, `create`, `start` or `cleanup` phase may identify the failed Docker
boundary; a daemon timer may add `: timeout`. Neither label proves execution or settlement.
Raw Docker errors and credential material are
not forwarded. No model turn is started
and there is no host fallback. A required repository-context refusal instead returns **422** with
the actual guarded-read issue code, not a blanket Linux-only claim. Resolve the reported boundary;
do not bypass unsafe paths or uncertain workspace ownership.

## Working with teammates

An Agent may send a scoped request to an existing teammate through `send_message`. If the teammate
needs the same workspace, the sender ends its turn so the workspace can be released. The existing
inbox scheduler then admits the teammate, which performs the work and replies. Waiting for that
reply while holding the same workspace is rejected with handoff guidance.

A producer can include `coding-receipt:<id>` in its message. The recipient supplies that message ID
when reading the evidence. Merely belonging to the same Team is insufficient: the producer message,
current communication policy and current Team membership must all permit access. Old recipes in
Team memory can help choose commands; they are not fresh evidence.

## Reading results

A command records its purpose, exact command, scope, admitted posture/image, observed exit, time
and bounded diagnostic output. Terminal states distinguish success, failure, block, timeout,
cancellation and interruption. Success means that command exited zero then; it does not certify
later edits or the whole repository.

Receipt applicability compares bounded instruction, manifest and lockfile identities, runtime
selection and workspace identity. It expires after fifteen minutes. It does not recursively hash
installed dependencies or code. Restart/restore invalidates input evidence; reads never rerun work.
Already-delivered cards stay visible in the open chat after the turn completes. Reloading the page
does not independently republish their private output; the Agent can retrieve retained evidence in
a new authorized turn. Canonical Pi transcripts retain the private result. Public history projections
do not bypass the
existing transport approval by independently republishing it.

Diagnostics retain a secret-redacted tail of at most 64 KiB per command. A Team retains at most
twenty terminal receipts for seven days; active commands are not evicted. A turn permits at most
64 command receipts. This is bounded execution evidence, not a new general runs/events system.

## Optional defaults and diagnostics

The Team page has collapsed **Advanced repository diagnostics** and optional runtime defaults.
Use these for troubleshooting or a repository-specific local image/directory override. There are
no named checks, readiness badges, probe history or review/run workflow.

The CLI and authenticated API expose the same optional settings:

```sh
bazilion team environment show default
bazilion team environment configure default --file environment.json
```

```json
{
  "expectedRevision": 0,
  "config": {
    "backend": "docker",
    "image": "bazilion-coding:node24-pnpm10",
    "cwd": ".",
    "env": { "CI": "true", "NO_COLOR": "1", "TZ": "UTC" }
  }
}
```

`GET/PUT /api/teams/:id/coding-environment` reads/saves these defaults. Later writes require the
current revision. Saving never executes commands. Allowed environment values are only
`CI=true|false`, `NO_COLOR=0|1` and `TZ=UTC`; arbitrary credentials/startup hooks are rejected.
Defaults do not change an explicitly unprotected host turn's cwd or environment.

The unreleased native configuration uses a distinct explicit choice, with no image:

```json
{
  "expectedRevision": 1,
  "config": {
    "backend": "native",
    "cwd": ".",
    "env": { "CI": "true", "NO_COLOR": "1", "TZ": "UTC" }
  }
}
```

CLI, API and web accept the same backend/directory/environment fields. A native config containing
`image` is refused, as is a Docker config consumed by native admission (and vice versa). Storing
native defaults is not runtime readiness and does not by itself select native execution;
turn preparation/captured verification remain under integration. There is no host or Docker
fallback from a native request. The alpha clean-install contract has no importer for earlier
image-only defaults: missing `backend` fails closed rather than reinterpreting an old image. Use a
clean current-schema bootstrap; no existing operator choice is rewritten automatically.

## Ownership and recovery

Canonical workspace ownership covers aliases and overlapping roots, including Teams without
saved defaults. Commands keep their Agent turn's ownership until process/container cleanup is
confirmed. Cancellation is not proof of cleanup. Uncertain cleanup leaves the workspace blocked
for recovery and never records a fabricated success. A readiness probe also retains its private
bind-source scratch when exact-container cleanup is unconfirmed; failed readiness is not proof
that its resources are absent.

A lost host worker may leave separate process groups; restarting the daemon alone cannot prove
those commands stopped. The same-boot workspace remains blocked when cleanup is uncertain. A host
restart proves the old local processes are gone. Docker recovery uses recorded container identities.

Restore never adopts copied process/container records as permission to terminate the original
home's resources. A backup containing active work remains recovery-blocked after restore. Prefer
backups taken after all Agent turns finish. This uses the canonical clean-install schema:
no legacy probe tables, routes or data importers are retained.
