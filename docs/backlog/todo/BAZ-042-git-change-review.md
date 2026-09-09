---
id: BAZ-042
title: Git changes and review beside coding conversations
status: todo
size: M
created: 2026-09-07
refined: 2026-09-09
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

Reviewed against the BAZ-039/040 remake at `81aaa31` on 2026-09-09:

- A [Team can link to an existing directory](../../../apps/daemon/src/core/team/register.ts), but
  [Team routes](../../../apps/daemon/src/routes/teams.ts) expose no Git source-review contract.
  The existing policy diff compares Team Policy, not repository files.
- Pi's [SDK at v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)
  exposes edit-result patches, while Bazilion's
  [event adapter](../../../apps/daemon/src/runtime/pi/events.ts) flattens tool results. Individual
  edit patches alone cannot cover changes made through shell commands or an external editor.
- BAZ-040 already serializes Bazilion writers by canonical overlapping workspace roots. External
  editors and changes between turns still exist; a baseline comparison cannot prove line authorship.
- Hermes's [release-tagged Git review](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/desktop.md#git-review--worktrees)
  demonstrates the value of inspecting source changes alongside chat. Bazilion needs its own
  attribution and workspace rules for the shared Team model.

## Scope

### Repository and snapshot identity

- Resolve the repository through the registered Team workspace. Show branch/detached state, base
  revision, tracked changes, and untracked filenames, including an explicit non-Git/unavailable state.
- Offer working-tree and branch/base views. Resolve a movable branch to a concrete commit before
  comparison and display it; changing a branch tip must not silently rewrite an existing review.
- Let the Agent capture a starting snapshot when beginning a coding request, before source edits.
  An optional operator capture uses the same capability; no separate task setup is required. Include
  the tracked content/index state and the agreed untracked-file scope, not only HEAD or modification
  timestamps.
- Preserve pre-existing changes in that baseline. Identify generated files and Bazilion-owned
  state through explicit exclusions; do not hide legitimate source merely because its name is
  `memory`, `dist`, or another common generated-directory label.
- Bound enumeration and content size. If concurrent writers or limits prevent a coherent capture,
  report an incomplete/unstable snapshot; do not call it exact or attach current verification to it.
- Define an immutable snapshot reference shared with BAZ-041 and BAZ-043. Snapshots are code
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
- Reuse BAZ-036 when feedback must queue during a busy turn. Preserve the captured feedback
  identity through that shipped queue; do not create a second queue.
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
  unsupported layouts fail with explicit guidance.
- Direct operator inspection uses the existing authenticated workspace-read boundary defined for
  this feature. Agent-initiated publication and Telegram mirrors retain shared egress authorization;
  the review panel cannot release BAZ-034 approval-held results or grant Agents new file access.
- Keep file content escaped and inert. No HTML execution, external resource loading, or fetching
  private paths from a browser-provided URL. Exported patches use authorized durable delivery through
  the existing BAZ-034 contract; live inspection must not depend on the entire results-library UI.

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

- Coordinate repository identity with
  [BAZ-039](../in_progress/BAZ-039-repository-coding-context.md) and the receipt extension with
  [BAZ-041](BAZ-041-coding-command-verification.md). This story owns snapshot identity and
  applicability; BAZ-041 progress can ship independently.
- [BAZ-034](../done/BAZ-034-durable-agent-deliverables.md) supplies persistent patch exports;
  [BAZ-035](../done/BAZ-035-conversation-library.md) supplies exact historic conversation navigation;
  [BAZ-036](../done/BAZ-036-visible-follow-up-queue.md) supplies busy-turn feedback queueing.
- This first review slice works with an existing supported repository and makes external-write and
  unsupported Git-layout limitations visible.

## Snapshot-bound verification added by this story

- Extend existing BAZ-040/041 receipts with bounded before/after source manifests, including HEAD,
  index, dirty tracked bytes and explicitly included untracked content. Record exclusions and limits.
- Capture checks at their actual execution boundary. Earlier receipts without source manifests stay
  historical outcomes with unknown code applicability; never backfill proof from the current tree.
- Match the command, cwd, actual admitted environment/image and known dependency identities as well
  as source coverage. Optional Team-default revision alone is not the execution environment identity.
- Relevant edits, changed coverage, source-mutating tests, incomplete captures or unstable external
  writes produce stale/unknown applicability. Before/after equality is not proof no transient edits
  occurred; state that limit. A successful command does not establish whole-project correctness.
- Present the result beside chat: “3 files changed; app test passed for this captured version,” with
  expandable diff and evidence. Agent capture and command execution require no operator checklist.

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

## Refinement decisions

- Use a bounded content manifest plus captured base/index/working-tree diff. Cap initial coverage at
  1,000 files, 1 MiB per text file and 16 MiB total captured content. Any exceeded limit produces an
  incomplete snapshot and unknown applicability; HEAD alone never identifies a dirty tree.
- Include tracked content by default. List untracked names, but require the Agent or operator to
  select their content explicitly. Never automatically capture Team memory, Bazilion private state,
  ignored files, credential-shaped filenames or repository content outside the selected paths.
- Add a turn-bound snapshot tool that the Agent invokes before editing; the operator may request the
  same capture through chat. Retain snapshots and review metadata for seven days. Deliberate patch
  exports use BAZ-034 retention instead of extending snapshot lifetime silently.
- Support ordinary repositories whose work tree and required Git metadata are safely reachable from
  the registered Team root. Reject submodules, linked-worktree common directories outside that
  boundary and other unsupported layouts with guidance in the first slice. Never broaden mounts or
  execute repository-configured helpers to make inspection work.
