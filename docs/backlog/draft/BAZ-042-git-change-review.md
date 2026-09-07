---
id: BAZ-042
title: Git changes and review beside coding conversations
status: draft
size: M
created: 2026-09-07
priority: high
note: Initial coding milestone; read-only change inspection with explicit baselines and truthful attribution.
---

# BAZ-042 — Git changes and review beside coding conversations

## User stories

- **As an operator assigning a code change**, I want to inspect changed files and their diffs beside
  the conversation, so I can review the actual result instead of relying on the Agent's summary.
- **As an operator with existing uncommitted work**, I want that starting state recorded separately,
  so Bazilion does not present my prior changes as newly produced work.
- **As an operator requesting a correction**, I want to send an exact file or hunk as context,
  so the Agent knows which version of the code my feedback refers to.

## Goal

Add a daemon-owned, read-only Git review surface for a Team's registered repository. Show the
working tree, a selected branch/base comparison, and changes since an explicit starting snapshot.
Preserve the source identity used by review comments and verification receipts.

## Why and current baseline

Verified against Bazilion `13c3a63` (v0.14.2) on 2026-09-07:

- A [Team can link to an existing directory](../../../apps/daemon/src/core/team/register.ts), but
  [Team routes](../../../apps/daemon/src/routes/teams.ts) expose no Git source-review contract.
  The existing policy diff compares Team Policy, not repository files.
- Pi's [SDK at v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)
  exposes edit-result patches, while Bazilion's
  [event adapter](../../../apps/daemon/src/runtime/pi/events.ts) flattens tool results. Individual
  edit patches alone cannot cover changes made through shell commands or an external editor.
- [Active-turn protection](../../../apps/daemon/src/lib/agent-cancel.ts) is keyed by Agent. Two
  Agents in one Team can touch the same working tree; a before/after comparison does not prove
  which actor authored each line.
- Hermes's [release-tagged Git review](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/desktop.md#git-review--worktrees)
  demonstrates the value of inspecting source changes alongside chat. Bazilion needs its own
  attribution and workspace rules for the shared Team model.

## Scope

### Repository and snapshot identity

- Resolve the repository through the registered Team workspace. Show branch/detached state, base
  revision, tracked changes, and untracked filenames, including an explicit non-Git/unavailable state.
- Offer working-tree and branch/base views. Resolve a movable branch to a concrete commit before
  comparison and display it; changing a branch tip must not silently rewrite an existing review.
- Capture a starting snapshot on an explicit coding request or operator action. Include the tracked
  content/index state and the agreed untracked-file scope, not only HEAD or modification timestamps.
- Preserve pre-existing changes in that baseline. Identify generated files and Bazilion-owned
  state through explicit exclusions; do not hide legitimate source merely because its name is
  `memory`, `dist`, or another common generated-directory label.
- Bound enumeration and content size. If concurrent writers or limits prevent a coherent capture,
  report an incomplete/unstable snapshot; do not call it exact or attach current verification to it.
- Define an immutable snapshot reference shared with BAZ-041 and BAZ-044. Snapshots are code
  evidence, not another conversation store or generic runs/events subsystem.

### Review and feedback

- Render changed-file lists and unified text diffs with added/deleted lines, rename/mode changes,
  binary indicators, and visible truncation for large files. Untracked content requires explicit
  selection under the agreed inclusion rules; ignored or potentially sensitive files are not
  automatically bundled into prompts or exported patches.
- Label aggregate output **Changes since baseline**. Show source-operation edit patches as such
  when available, without claiming they prove exclusive authorship of the full working tree.
- Selecting a file/hunk creates feedback carrying repository, snapshot, path, and original line
  context. Show the selected excerpt before sending it through normal authenticated chat ingress.
- Recheck source identity before submitting feedback. A stale hunk remains linked to its original
  snapshot and offers refresh; it cannot silently point at different current lines.
- Reuse BAZ-036 when feedback must queue during a busy turn. Before that feature ships, preserve
  the feedback draft and explain that the Agent is busy; do not create a hidden second queue.
- Display linked BAZ-041 checks when available. A change after testing marks those results stale
  for the current view; absence of checks is **Not checked**, never a passing indicator.

### Access and operator surfaces

- Add authenticated API/client contracts and CLI list/show/diff parity. The web review panel must
  work beside chat and as a narrow-screen view, with keyboard navigation and readable diff labels.
- Keep Git inspection read-only and bounded. Disable external diff/textconv/fsmonitor helpers and
  other repository-configured executable behavior; read-only inspection cannot run arbitrary code
  in the daemon or invoke credential helpers/network fetches.
- Validate filenames and repository identities without shell interpolation. Handle symlinks,
  submodules, linked-worktree Git directories, and paths outside the Team boundary explicitly;
  unsupported layouts fail with guidance until the BAZ-043 metadata contract supports them.
- Direct operator inspection uses the existing authenticated workspace-read boundary defined for
  this feature. Agent-initiated publication and Telegram mirrors retain shared egress authorization;
  the review panel cannot release BAZ-034 approval-held results or grant Agents new file access.
- Keep file content escaped and inert. No HTML execution, external resource loading, or fetching
  private paths from a browser-provided URL. Exported patches use authorized durable delivery once
  BAZ-034 is available; live inspection must not depend on the entire results-library UI.

## Acceptance criteria

1. A repository dirty before the request retains those changes in its baseline. The review clearly
   distinguishes the selected base, prior changes, and changes since that baseline.
2. Tracked, explicitly included untracked, renamed, deleted, binary, and large files have truthful
   output. An incomplete or changing capture never receives an exact-snapshot claim.
3. File/hunk feedback references the reviewed snapshot; branch movement or later edits cannot
   silently retarget it. Busy feedback stays recoverable through the agreed ingress behavior.
4. BAZ-041 receipts are linked to the tested snapshot and become stale when applicable code changes.
5. Inspection cannot execute repository helpers, mutate Git/workspace state, access unrelated host
   paths, or bypass source-owned egress holds. Concurrent edits do not yield false authorship.
6. API/CLI and responsive web views agree on revisions, file scope, limits, and unavailable states.

## Dependencies and sequencing

- Coordinate repository identity with [BAZ-039](BAZ-039-repository-coding-context.md) and the shared
  snapshot contract with [BAZ-041](BAZ-041-coding-command-verification.md) before implementation.
  Either presentation can ship first once the contract is settled.
- [BAZ-034](../in_progress/BAZ-034-durable-agent-deliverables.md) supplies persistent patch exports;
  [BAZ-035](../in_progress/BAZ-035-conversation-library.md) supplies exact historic conversation navigation;
  [BAZ-036](BAZ-036-visible-follow-up-queue.md) supplies busy-turn feedback queueing.
- [BAZ-043](BAZ-043-isolated-coding-workspaces.md) adds managed workspaces later. This first review
  slice works with an existing supported repository and makes shared-write limitations visible.

## Out of scope

Staging, reverting hunks, committing, pushing, branch mutation, PR creation, automatic merge,
an embedded editor, semantic code search, public sharing, and attributing every change to an Agent.

## Tests

- Use isolated Git fixtures for dirty starts, staged/unstaged mixtures, untracked inclusion,
  renames, deletes, binary/large files, detached HEAD, moving branches, and repository replacement.
- Exercise concurrent capture/write, stale feedback, incomplete snapshots, and check invalidation.
- Verify inert diffs and hostile filenames/configuration, external helper suppression, path and
  symlink boundaries, source egress holds, and zero Git/workspace mutation during inspection.
- Check API/CLI parity, keyboard feedback selection, narrow layouts, empty and truncated views.

## Open Questions

- **Snapshot format:** agree tracked/index/untracked capture and stable identity with BAZ-041.
  Recommended: a bounded content manifest and captured diff/base, with explicit exclusions and
  an incomplete state; never infer identity from HEAD alone in a dirty repository.
- **Sensitive and generated files:** choose inclusion defaults and the treatment of Team memory
  inside a linked repository. Recommended: list untracked names, require selection for their
  content, and never automatically include credential files or Bazilion-owned private state.
- **Capture trigger and retention:** recommend an explicit start-of-assignment baseline and a
  bounded retention policy. Decide how ordinary chats request capture without a new task engine.
- **Git metadata layouts:** define read-only access for linked worktrees/submodules before todo;
  do not grant general access to a parent checkout merely to make Git commands succeed.
