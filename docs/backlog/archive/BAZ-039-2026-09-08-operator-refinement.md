---
id: BAZ-039
title: Repository context and coding onboarding within a Team
status: in_progress
size: M
created: 2026-09-07
refined: 2026-09-08
priority: high
---

# BAZ-039 — Repository context and coding onboarding within a Team

> Historical refinement, superseded on 2026-09-09 by the Agent-led stories.
> Frontmatter and completion statements below describe the former scope only.

## User stories

- **As an operator connecting an existing repository**, I want to see its branch, working-tree
  state, applicable instructions, and likely development commands before assigning coding work.
- **As an operator of coding Agents**, I want repository conventions included with clear scope
  and precedence, so an Agent does not rely solely on its private persona instructions.
- **As an operator working in a monorepo**, I want nested instructions applied to their own
  directories, so guidance for one application does not silently govern an unrelated application.

## Goal

Provide a bounded, inspectable repository-context snapshot inside the existing Team workspace.
Prepare root context for normal and protected coding turns, and resolve applicable nested
instructions when a specific subdirectory or file becomes relevant. Keep Team ownership,
execution authority, and Pi's canonical session transcript unchanged.

## Why and current baseline

[Team registration](../../../apps/daemon/src/core/team/register.ts) links an existing directory;
a Project entity would duplicate the Team's workspace ownership model.

The [Pi bridge](../../../apps/daemon/src/runtime/pi/session.ts) uses `noContextFiles: true`,
`noExtensions: true`, and `noSkills: true` in all loaders. Coding tools can still read files.

[buildSystemPrompt](../../../apps/daemon/src/runtime/session/prompt.ts) reads private Agent-home
`AGENTS.md`, `SOUL.md`, `TOOLS.md`, and `IDENTITY.md`, currently under a “Project Context” heading.
It also injects Skills, Team information, USER.md, and lessons, but not repository AGENTS.md.

[Protected execution](../../../apps/daemon/src/runtime/worker/runtime.ts) binds canonical Team paths
and snapshots private-home inputs. Repository context must preserve that boundary.

## Scope

### 1. Read-only repository orientation

- Inspect the Team root by default; allow a bounded Team-relative file/directory target for
  context inspection. A target refines the report and instructions, not the Team root or tool cwd.
- Report repository presence, its root relative to the Team, branch or detached/unborn HEAD,
  commit when available, and separate staged/unstaged/untracked/conflicted file counts.
- Git discovery cannot walk above the canonical Team root. A Team linked to a subfolder of a
  larger repository gets a bounded-directory report, not access to the ancestor repository.
- Read metadata using fixed, bounded operations that do not invoke repository hooks, fsmonitor,
  configured helper programs, credential helpers, or remote fetches. Do not execute project code.
- Inspect a small allowlist of applicable manifests and documentation for likely setup, dev,
  build, lint, and test commands. Display each candidate with source path and evidence location.
- Distinguish script entries from inferred conventions and conflicts. Suggestions are not permission
  to execute, an approved command, or a tested environment.

### 2. Repository instructions with provenance

- Load Team-root `AGENTS.md` when present. For a requested target, resolve only applicable
  AGENTS.md files along the contained root-to-target directory chain, in deterministic order.
- Nested instructions govern their subtree and override broader repository instructions only
  there. Do not merge sibling instructions or recursively scan every folder.
- Label source path, applicable scope, precedence, capture time, and content fingerprint for each
  included document. Separate **Agent instructions** from **Repository instructions** in the prompt
  and operator view; avoid presenting the private-home AGENTS.md as repository-authored content.
- Explicit current user instructions and platform/runtime policies take priority. Repository
  instructions govern repository work and may specialize general Agent preferences, but cannot
  change Team Policy, enable tools, expand filesystem access, or grant external side effects.
- Keep contradictory guidance visible. Ordinary project files and manifest scripts remain task data.
- Keep discovery disabled; do not follow includes or activate `.pi` extensions, Skills, or MCP
  or runtimes merely because the repository references them.
- Provide a narrow read-only context operation for new target paths during a turn, available in
  both normal and protected coding execution. Guide the Agent to resolve a new subtree before
  editing it; do not claim universal enforcement by parsing arbitrary shell command strings.

### 3. Bounded reads and refresh

- Resolve and pin the registered Team root using existing canonical ownership rules. Its deliberate
  root symlink is supported; changed root identity invalidates the snapshot before use.
- Reject target traversal, nested directory/file symlinks, special files, and external Git metadata
  links in this first slice. Never follow an instruction-file link or discover ancestor home files.
- Bound depth, file count/bytes, prompt/result size, and Git runtime. Exclude dependency trees,
  `.git` content, Team memory, and generated folders from manifest scans.
- Missing AGENTS.md is normal. Unreadable, oversized, changing, or unsafe applicable instructions
  produce an explicit incomplete-context state; do not inject truncated instructions as complete.
  Require the affected context to be resolved before presenting that scope as ready for coding.
- Prepare context through the same daemon-owned resolver at each admitted normal/protected turn;
  pass bounded snapshots through typed worker inputs. Protected workers do not rediscover the host.
- Refresh targeted context through the same resolver when requested during a turn. Detect changed
  source fingerprints and return a replacement with clear provenance; do not silently combine old
  and new versions. Other-file Git changes mean a snapshot is dated, not a workspace lock.
- Restricted learning-review workers keep their existing limited evidence contract and do not gain
  repository discovery or coding capabilities through this change.

### 4. Operator onboarding and inspection

- Add an authenticated repository-context view from the existing Team page, with a refresh action,
  optional contained target, instruction sources, Git summary, and command candidates.
- Provide daemon API and CLI parity, including JSON and a readable summary, using existing auth.
- Show unavailable context. Inspection never installs dependencies or starts an Agent.
- Use Team-relative metadata and protected `/workspace` paths; previews omit private Agent content.

## Acceptance criteria

- A linked repository can be inspected through web and CLI with matching branch/dirty state,
  instruction sources, and source-backed command suggestions; inspection has no project mutations.
- Root and nested AGENTS.md resolve predictably for a target. Sibling instructions and ancestor
  files outside the Team never enter its effective context; private Agent instructions are distinct.
- Normal and protected coding turns receive equivalent applicable instruction bytes and precedence
  for the same snapshot, with runtime-appropriate paths and unchanged capability restrictions.
- Plain folders, detached/unborn HEAD, conflicts, unsupported linked Git metadata, missing tools,
  large trees, and unsafe/incomplete instruction files produce truthful bounded outcomes.
- Source edits between preview/admission and between turns refresh context. Targeted refresh shows
  changed inputs, while stale snapshots never claim that later filesystem changes were observed.

## Out of scope

- A Project entity, second roster/session engine, repository cloning, or dependency setup.
- Executing/approving verification commands; Git staging, commits, pushes, or reviews.
- Creating/managing worktrees, resolving external Git common directories, or changing the Team cwd.
- Automatic trust of repository extensions, arbitrary instruction filenames, or multi-file includes.

## Tests

- Resolver fixtures cover root/nested/sibling scopes, precedence, provenance, root symlink changes,
  escaping paths, nested symlinks, special files, byte/depth/time limits, and concurrent file edits.
- Git fixtures cover dirty/conflicted, detached/unborn, plain-folder and ancestor-repository cases;
  verify inspection does not execute hooks/helpers or follow external Git metadata.
- Prompt/worker tests compare normal/protected snapshots, refresh and incomplete states,
  runtime path labels, unchanged disabled discovery, and restricted-review exclusion.
- API/CLI/web checks cover matching output, refresh, safe rendering of repository text,
  auth, degraded reports, source evidence, and no accidental command execution during onboarding.

## Dependencies and sequencing

- Builds on existing Team registration and protected execution; no new draft is a prerequisite.
- BAZ-040/041 can use environment/command suggestions while establishing execution and evidence
  separately. BAZ-044 can cite snapshot fingerprints; none treats the report as live state or proof.
- BAZ-042 Git review must capture its own state before comparison or feedback. BAZ-043 must define
  authorized worktree metadata roots before this resolver supports external `.git`/common-directory
  links.

Implementation checkpoints and acceptance evidence: [BAZ-039 progress](../BAZ-039-progress.md).

## Refinement decisions (2026-09-08)

### Instruction contract and limits

- Support `AGENTS.md` only. Apply platform/runtime policy first, explicit operator instructions
  next, then applicable repository guidance over general private Agent preferences for repository
  work. Within repository guidance, deeper directories specialize parent guidance for that subtree.
  Team Policy remains an independent authorization boundary. Preserve conflicting source text and
  provenance; the resolver orders documents, it does not claim to understand or resolve prose.
- Root context is prepared for every normal coding-capable turn. When BAZ-040 selects a command
  cwd, also prepare that directory's ancestry. Targeted `repository_context` calls resolve a new
  existing directory or a new file's existing parent; targets never change the registered Team root.
  Return the complete applicable ordered set as a replacement, with SHA-256 fingerprints, rather
  than append repeated copies. Old transcript entries remain historical.
- Initial hard limits: 64 KiB per instruction file, 128 KiB total instruction bytes, 16 directory
  levels below the Team root, 32 command-source files at 64 KiB each / 256 KiB total, and 32 command
  candidates. Bound the serialized report to 256 KiB and Git inspection to 5 seconds / 1 MiB output.
  Report which limit was reached. Never truncate an applicable instruction into apparent completeness.
  At refinement, Bazilion's root AGENTS.md was 37,581 bytes; the draft's 16 KiB proposal would reject it.
- Read exact allowlisted source names only along the target ancestry: `package.json`,
  `pnpm-workspace.yaml`, `README.md`, and `CONTRIBUTING.md`. The initial structured command extractor
  supports Node package scripts and package-manager declarations. Markdown supplies labelled
  command excerpts only; YAML is bounded source evidence, never an executable loader. Other stacks
  still receive Git/instruction context and can use manually configured BAZ-040 commands.
  Do not recursively enumerate workspace globs or auto-select an ambiguous package manager.
- Distinguish instruction completeness from Git and command-discovery availability. Missing Git,
  unsupported Git metadata, no package scripts, or command-source truncation do not invalidate
  otherwise complete instructions. An unsafe/unreadable/oversized applicable instruction prevents
  preparation of that coding scope before model execution. A failed mid-turn target resolution
  returns a blocked scope with reasons and tells the Agent not to edit it; arbitrary Bash editing
  is not mechanically policed by this feature. Inspection and unrelated management stay available.
- Limit exclusions to actual Bazilion-owned paths and established dependency/generated locations
  for command discovery. Do not discard an applicable AGENTS.md merely because an ancestor has a
  common name such as `dist`. No ancestor-repository discovery, linked Git metadata, submodule
  traversal, recursive scanning, or includes in this release.

### API, ownership, and shared contract with BAZ-040

- Canonical operator surface: `GET /api/teams/:id/repository-context?target=...` and
  `bazilion team context <slug> [--target <relative-path>] [--json]`. Refresh is another bounded
  read. Web presents the same response from the existing Team page. Inspection requires existing
  management authentication and setup gates; it is not an Agent publication endpoint.
- Put hermetic report/request types in `@bazilion/api-types`; add `@bazilion/client` parity.
  The daemon owns resolution. The worker's `repository_context` tool uses a turn-bound IPC method
  whose Team/root is derived by the daemon, never selected by worker-supplied Team ids or host paths.
  Denied Agent egress cannot expose context tool results through replay or newly added surfaces.
- A report identifies Team, canonical root identity, Team-relative target, capture time, source
  hashes, ordered instruction scopes, command-source references, and separate availability reasons.
  Hashes identify the captured inputs; they do not assert an atomic full-repository snapshot.
  Do not persist another repository database or put host absolute paths into protected reports.
- BAZ-039 owns instruction resolution and passive command suggestions. BAZ-040 copies a selected
  suggestion into operator-reviewed configuration, retaining its source hash/path and cwd. A later
  source edit marks that provenance changed; it never silently edits or executes the saved command.
  Inspection alone cannot enable a coding environment or grant permission to run a probe.
- BAZ-040 reuses the canonical root and context resolver, but owns environment revision, execution
  identity, workspace coordination, and readiness evidence. BAZ-041/042 will separately define code
  snapshots: neither a context fingerprint nor readiness evidence is a verified code revision.

### Delivery and acceptance evidence

1. Deliver the bounded resolver and fixtures, then prompt/typed IPC integration for normal and
   protected turns, then matching API/CLI/Team inspection UI. No BAZ-040 dependency is needed to ship.
2. Exercise Bazilion's root AGENTS.md plus a disposable monorepo with nested and contradictory
   instructions. Show identical instruction bytes/scopes across CLI preview and both turn postures.
3. Prove hostile Git helpers never execute, inspection leaves project bytes unchanged, limits
   degrade the correct report section, and instruction failures block only the affected scope.
4. Run relevant resolver, prompt, IPC, API, CLI and web checks plus repository typecheck/lint and
   security acceptance before release. Record actual evidence; moving this story to todo is not
   implementation or release acceptance.

No unresolved product decisions remain for this slice. Limit changes require updating the contract
and boundary fixtures together; additional instruction filenames and language extractors are later work.

## Reference

The [Pi v0.85.1 SDK][pi-sdk] documents resource-loader control; retain Bazilion's discovery limits.

[pi-sdk]: https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md
