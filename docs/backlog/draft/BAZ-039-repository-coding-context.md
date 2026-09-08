---
id: BAZ-039
title: Repository context and coding onboarding within a Team
status: draft
size: M
created: 2026-09-07
priority: high
---

# BAZ-039 — Repository context and coding onboarding within a Team

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

## Open questions

- **Instructions:** recommend AGENTS.md only with targeted ancestry; define precedence before
  adding other filenames or includes.
- **Limits:** recommend 16 KiB per instruction file, 64 KiB total, and bounded target depth;
  refine using Bazilion's monorepo and representative larger repositories.
- **Incomplete instructions:** recommend inspect-only degraded reporting and an explicit failure to
  prepare the affected coding scope, rather than silently proceeding without required guidance.
- **Command sources:** recommend manifests and a small README/CONTRIBUTING allowlist; do not run
  repository parsers or guess a definitive command when sources disagree.

## Reference

The [Pi v0.85.1 SDK][pi-sdk] documents resource-loader control; retain Bazilion's discovery limits.

[pi-sdk]: https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md
