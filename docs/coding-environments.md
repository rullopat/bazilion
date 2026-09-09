# Coding during an Agent task

Ask an Agent to do the work: **“Fix this bug and run the relevant test.”** There is no Team
checklist to fill out first. These BAZ-039/040 changes are implemented for this PR, not released.

The Agent receives root repository instructions when its turn starts. It can inspect a deeper
scope, discover source-backed commands, check the actual execution environment, prepare missing
prerequisites from available local artifacts, and run a finite command. Results appear alongside
that work in chat, with expandable output. A failed test is a result to investigate; it does not
send you to a configuration dashboard.

## What the Agent can do

| Tool | Purpose |
| --- | --- |
| `repository_context` | Resolve applicable instructions, Git state and suggested commands for a scope |
| `coding_environment` | Describe this turn's actual host/Docker/protected posture, directory and restrictions |
| `coding_command` | Execute a task-selected runtime, dependency, preparation, build or test command |
| `coding_receipt` | Read retained command evidence and check whether its recorded inputs still apply |

Commands use the turn's admitted shell backend, approval policy, cancellation and resource cleanup.
They have a 1–300 second timeout. They do not start independent jobs or acquire another workspace
lease. No tool accepts a caller-selected Team or host execution override.

Pi owns the model/tool loop and canonical session transcript. Bazilion supplies bounded repository
context and the execution adapter. Existing Bazilion-managed skills remain available; this change
does not activate ambient Pi extensions or repository-provided executable plugins.

## Missing prerequisites

In a protected or Docker turn, every command runs in a fresh network-disabled container. Workspace
files persist; temporary files do not. The root filesystem and Team memory are read-only to shell
commands. There are no ambient host credentials or package caches.

The Agent can install from workspace-local artifacts or an available offline package store under
its existing authority. If a package must be downloaded, a service is unavailable, or the image
lacks a required tool, it should name the missing prerequisite and yield. It cannot silently switch
to host execution. Network-enabled dependency provisioning is outside this feature.

A local toolchain image is an installation prerequisite for Docker execution, not a per-task
checklist. The supplied [Dockerfile](../examples/coding-environment/Dockerfile) contains Node and
pnpm. Build it explicitly from a source checkout:

```sh
docker build --pull=false -t bazilion-coding:node24-pnpm10 examples/coding-environment
```

The image build requires its base image and package-manager artifacts to be available. Set
`BAZILION_BASH_SANDBOX_IMAGE=bazilion-coding:node24-pnpm10` for the installation. Ordinary Agent
turns use Docker when `BAZILION_BASH_SANDBOX=docker`; protected turns always use their protected
runtime. Host execution remains host execution under its existing policy.

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
    "image": "bazilion-coding:node24-pnpm10",
    "cwd": ".",
    "env": { "CI": "true", "NO_COLOR": "1", "TZ": "UTC" }
  }
}
```

`GET/PUT /api/teams/:id/coding-environment` reads/saves these defaults. Later writes require the
current revision. Saving never executes commands. Allowed environment values are only
`CI=true|false`, `NO_COLOR=0|1` and `TZ=UTC`; arbitrary credentials/startup hooks are rejected.
Docker defaults do not change a host turn's cwd or environment.

## Ownership and recovery

Canonical workspace ownership covers aliases and overlapping roots, including Teams without
saved defaults. Commands keep their Agent turn's ownership until process/container cleanup is
confirmed. Cancellation is not proof of cleanup. Uncertain cleanup leaves the workspace blocked
for recovery and never records a fabricated success.

A lost host worker may leave separate process groups; restarting the daemon alone cannot prove
those commands stopped. The same-boot workspace remains blocked when cleanup is uncertain. A host
restart proves the old local processes are gone. Docker recovery uses recorded container identities.

Restore never adopts copied process/container records as permission to terminate the original
home's resources. A backup containing active work remains recovery-blocked after restore. Prefer
backups taken after all Agent turns finish. This PR uses the clean-install alpha schema: no legacy
probe tables, routes or data importers are retained.
