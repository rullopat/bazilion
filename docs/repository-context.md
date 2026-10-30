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

Shipped in **0.24.0**, the shared daemon capture adapter uses public
`@openclaw/fs-safe@0.26.8` APIs. Linux retains `/proc/self/fd` directory-relative access. macOS uses
guarded rooted opens with exact retained-directory/registration checks around operations and final
acceptance. Both revalidate observed files, absence and captured listings, reject unwanted links
and special files, and enforce existing limits. macOS pathname observations remain best-effort under
hostile concurrent mutation; neither implementation is an atomic namespace snapshot or a sandbox.
A native-mode label does not establish these guarantees.

Ordinary CLI/API/browser turns with empty and instructed Teams passed on actual macOS 26.6.2 arm64 /
Node 24.22.0. See [BAZ-057](backlog/done/BAZ-057-portable-safe-reads.md) for code/CI identity and
limits. Historical 0.23.0 retains its Linux-only turn boundary. Windows remains refused with
`safe_reads_unavailable`; no Windows support is claimed.

In published **0.24.0**, hardened Git requires its Linux fd-pinned worktree. A macOS repository
therefore reports Git `unavailable` with `git_inspection_unavailable`, independently of complete
instructions. That released qualification does not cover the implementation below.

### Unreleased 0.25 work: private macOS Git worktree

[BAZ-072](backlog/in_progress/BAZ-072-apple-silicon-feature-parity.md) adds a private worktree backend
inside the existing hardened inspector. Linux retains its descriptor-pinned source. On macOS,
Git receives only a disposable private copy, never the live source pathname. Guarded reads copy
regular files and preserve executable bits. The captured index and ignore rules determine which
ignored subtrees can be skipped; tracked ignored files are still copied. Hooks, helpers, filters,
external configuration and metadata remain subject to the same neutral Git configuration.

The private worktree is limited to 64 MiB, 16,384 entries, 256 directories and 16 directory levels,
within the shared five-second inspection deadline. Oversized/unsafe captures refuse rather than
silently omit content. Unignored symlinks, hardlinks, special files and nested repositories refuse
this backend; this conservative layout restriction remains open parity work. Scratch is private,
contains transient file bytes (not just digests), and is removed on disposal/failure; it is not a
retained evidence store or a general sandbox.

Private worktree bytes stay fixed for subsequent Git invocations and source-snapshot file reads;
a fresh capture is required to observe edits. Final context validation rechecks original source
observations and the registered root binding. These are change detectors, not an atomic snapshot
of a concurrently hostile source tree. The source and private-copy observations are independent.

Historical initial Git qualification passed all 67 focused cases on actual macOS 26.6.2 arm64
with the then-supported Node 24.22.0 and 26.4.0 baselines in
[CI](https://github.com/rullopat/bazilion/actions/runs/39955676046). That Git-only increment did not
qualify MCP stdio, broader process parity or a latest-stable OS; its runner label was not evidence.

The current **0.25 alpha** uses **Node 26 only** (baseline **26.12.1**, range **`^26.12.1`**) and
accepts the observed **macOS 27.x major line**, with installed Git/CLI/API/web trials on **27.0.1 arm64**. Mac MCP stdio is independently
admitted through native ownership; it is no longer categorically Linux-only. Generic Mac command
isolation remains deferred, and Mac headed/desktop qualification is deferred to a later version,
not another alpha release gate. These are bounded support claims, not complete feature parity or
atomic source snapshots. See [release scope](releases.md) and
[BAZ-072](backlog/in_progress/BAZ-072-apple-silicon-feature-parity.md).

## Development and acceptance

The resolver is under `apps/daemon/src/lib/repository-context/`. Wire types are hermetic in
`packages/api-types/src/repository-context.ts`. Pi integration supplies `getAgentsFiles` from the
captured report and rebuilds the prompt through the SDK's public tool-selection API with the
unchanged admitted tool names. A worker can supply only a relative target to the turn-bound host.

Resolver, Pi-loader and API/CLI tests use disposable repositories and daemon homes. After a web
build, run `pnpm tsx scripts/check-repository-context-ui.mjs` for authenticated desktop/mobile
inspection, targeted refresh and inert-source rendering. Screenshots and its result JSON are
written to a temporary evidence directory. This script sends no real provider or Telegram messages.
