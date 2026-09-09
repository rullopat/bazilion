# Repository context

BAZ-039 gives an Agent applicable repository instructions and source-backed command discovery
while it works. Ask for the task in chat; no repository setup form is required. The Agent receives
root instructions automatically and uses `repository_context` for deeper scopes. See
[coding during an Agent task](coding-environments.md) for preparation, checks and teammate handoff.

The Team page retains passive inspection under **Advanced repository diagnostics**. Inspection
itself never runs project commands. These changes are implemented in this PR and not released.

```sh
bazilion team context my-team
bazilion team context my-team --target apps/web/src/example.ts --json
```

The authenticated API is `GET /api/teams/:id/repository-context?target=...`. The client exposes
`repositoryContext(teamId, { target })`. Refresh captures a new report; responses are not cached.

## What the report means

- **Repository instructions** lists root and applicable nested `AGENTS.md` files, their exact
  contents, scope, precedence and SHA-256 fingerprints. A missing instruction file is normal.
- **Git** shows the contained repository's branch/commit or unborn/detached state, plus staged,
  unstaged, untracked and conflicted counts. It does not attribute changes to any particular Agent.
- **Command suggestions** contains package script bodies and selected shell excerpts with source
  locations and fingerprints. A package manager is named only when that manifest declares one.
  Conflicting or ambiguous suggestions stay visible. They are not approved or tested commands.

Every report has a capture time and fingerprint. Files may change afterward. A context fingerprint
is not a full code snapshot, environment-readiness result or test receipt. BAZ-040 owns prepared
coding environments; BAZ-041 will own live/retained diagnostics and BAZ-042 will own
source-bound verification and review.

## Agent behavior

The daemon prepares context before a coding turn and rechecks it before worker execution. Normal
and protected workers receive the captured report; protected workers do not rediscover host files.
Pi consumes these instructions through its resource-loader interface, and the `repository_context`
custom tool can request another contained target during a turn. Each response replaces the active
applicable repository guidance; earlier transcript entries remain historical.

Platform/runtime policy and explicit operator instructions take priority. Repository instructions
specialize general private Agent preferences for repository work; deeper files govern only their
own subtree. Private Agent documents are labelled **Agent instructions** separately. Repository
text cannot grant execution authority or change Team Policy. Automatic Pi extension, skill,
context-file and prompt-template discovery remains disabled. No repository includes are followed.
Restricted learning-review workers receive neither this context nor its tool.

Live HTTP context-tool results use the existing Agent-to-user frame authorization and approval
tuple; Telegram mirrors retain their transport-owned gate. Public transcript and done-frame views
show a placeholder for the private context snapshot, because the transcript alone cannot prove its
transport was authorized. Approved transport delivery releases its captured frame. Team inspection
is a separate authenticated operator read of the current workspace, not publication of Agent output.

If an applicable instruction is unsafe, unreadable, oversized or changing during capture, the
scope is incomplete. Initial preparation fails with inspection guidance. A targeted mid-turn
failure removes the previous scope from the active context and tells the Agent not to edit the
blocked scope. This guidance does not mechanically police arbitrary Bash commands. Missing Git
or unavailable command suggestions do not invalidate otherwise complete instructions.

## Bounds and supported layouts

Instruction reads are limited to 64 KiB per file, 128 KiB total and 16 nested directories. Command
sources are limited to 32 files, 64 KiB per file / 256 KiB total and 32 candidates. The report is
limited to 256 KiB. Limits produce explicit incomplete states; partial instruction bytes are never
presented as complete guidance.

Command discovery reads only `package.json`, `pnpm-workspace.yaml`, `README.md` and `CONTRIBUTING.md`
on the target ancestry. It does not scan workspace globs, dependency trees or generated folders.
Applicable instructions still govern a subtree even if its directory has a generated-folder name.
Team memory is excluded from command discovery.

The registered Team-root symlink is supported. Nested links, instruction-file links, special files,
traversal and external Git metadata links are rejected. Git never discovers an ancestor repository
outside the Team. Linked worktree/submodule metadata and unsupported sparse/split layouts report
unavailable rather than following external roots.

Git inspection uses a disposable, bounded copy of Git metadata with a Bazilion-authored config;
only a closed set of non-executable Git settings and the contained local exclude file are carried
into that copy. Hooks, filters, includes and alternates are not activated. Configurations requiring
external includes, clean filters or external attributes/exclude files report unavailable, so the
inspector never presents guessed dirty counts as authoritative. The fixed
status command is limited to five seconds and 1 MiB of output. Metadata copying is limited to
64 MiB and 16,384 entries, with a shorter preparation deadline. The original index is not refreshed
or written. Git metadata beyond these limits is unavailable; instructions can still be complete.

Current implementation uses Linux directory descriptors and `/proc` to pin ancestry during safe
reads. Other platforms report `safe_reads_unavailable` and cannot prepare coding context through this
resolver. Linux is the validated safe-read platform; no weaker path-based fallback is used.

## Development and acceptance

The resolver is under `apps/daemon/src/lib/repository-context/`. Wire types are hermetic in
`packages/api-types/src/repository-context.ts`. Pi integration supplies `getAgentsFiles` from the
captured report and rebuilds the prompt through the SDK's public tool-selection API with the
unchanged admitted tool names. A worker can supply only a relative target to the turn-bound host.

Resolver, Pi-loader and API/CLI tests use disposable repositories and daemon homes. After a web
build, run `pnpm tsx scripts/check-repository-context-ui.mjs` for authenticated desktop/mobile
inspection, targeted refresh and inert-source rendering. Screenshots and its result JSON are
written to a temporary evidence directory. This script sends no real provider or Telegram messages.
