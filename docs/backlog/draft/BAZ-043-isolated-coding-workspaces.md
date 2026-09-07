---
id: BAZ-043
title: Isolated coding workspaces for parallel assignments
status: draft
size: L
created: 2026-09-07
priority: medium
note: Later coding increment; establish workspace ownership and Git metadata boundaries before promoting parallel writes.
---

# BAZ-043 — Isolated coding workspaces for parallel assignments

## User stories

- **As an operator assigning two code changes**, I want separate checkouts and branches, so one
  assignment does not overwrite the other's files or mix their uncommitted changes.
- **As an operator already editing a repository**, I want Bazilion to prepare a separate workspace
  without stashing, resetting, or changing my current checkout.
- **As an operator finishing an assignment**, I want to retain its branch and review evidence and
  remove only the workspace I explicitly select, so cleanup does not discard unrelated work.

## Goal

Manage a coding checkout as the filesystem root of a canonical Team. Associate its branch/base,
ownership, and environment with that Team while keeping permanent Agent membership and shared
Team memory unchanged. Qualify the selected layout for both local and protected execution.

## Why and current baseline

Verified against Bazilion `13c3a63` (v0.14.2) on 2026-09-07:

- [Team registration](../../../apps/daemon/src/core/team/register.ts) supports a directory or an
  existing-directory link. It does not create branches, track checkout ownership, or arbitrate
  multiple coding assignments.
- [Session cwd](../../../apps/daemon/src/runtime/pi/session.ts) is the Team path. Permanent Agents
  have one Team membership; a conversation does not currently own a separate filesystem workspace.
- [Agent turn exclusion](../../../apps/daemon/src/lib/agent-cancel.ts) protects one Agent, not all
  writers targeting the same directory.
- [Git worktrees](https://git-scm.com/docs/git-worktree) have separate checkouts but share repository
  metadata. Their `.git` reference can point outside a mounted Team tree. A worktree is not by
  itself a security boundary, and mounting the whole parent repository would broaden access.

## Scope

### Creation and canonical ownership

- Create a workspace from an explicitly registered repository and concrete base revision, with a
  validated new branch name. Preview the source, base, destination, and ownership before execution.
- Materialize a canonical Team rooted in the selected checkout, using the existing Team lifecycle
  and optional Team Template to create permanent members. Do not create a second roster, a detached
  live policy, or silently change an existing Agent's cwd or Team membership per conversation.
- Keep independent assignments in separate Teams/checkouts. Extend BAZ-040's coding-workspace
  coordination into a single-writer admission rule for Bazilion-managed coding turns across all Agent
  ingress paths. Instruction text telling Agents to avoid collisions is not enforcement.
- Key writer exclusion by canonical workspace identity, including aliases linking the same target.
  Existing per-Agent exclusion, lifecycle locks, protected posture, and Team Policy still apply.
- External editors/processes are outside this admission rule. Detect changed snapshots and mark
  test/review evidence stale; do not claim an OS-enforced lock on everything writing the directory.
- Record only workspace ownership and lifecycle metadata needed for recovery. Keep Pi sessions as
  transcripts and Teams as the collaboration owner; no generic runs/jobs table or new Project model.
- Provision dependencies through the selected BAZ-040 environment. The new checkout must not
  silently inherit credential files, arbitrary host caches, or another Team's memory.

### Git and protected execution

- Begin with supported ordinary repositories and managed checkouts. Resolve the base before
  creation and preserve the source checkout's staged, unstaged, untracked, and branch state.
- Choose and qualify a linked-worktree or self-contained checkout layout during refinement.
  Linked worktrees may share objects/refs, but protected commands cannot gain unrestricted write
  access to the source repository's common Git directory or other working trees.
- If a narrowly mediated Git operation boundary is needed, it must validate typed operations,
  repository ownership, branch/ref scope, hook behavior, and existing authorization. It is not a
  daemon-host shell available to the model. Unsupported layouts fail before task execution.
- Keep network fetch, authentication, commit, push, and merge outside the automatic creation path
  unless separately requested through an established authorized operation. Local base availability
  is checked explicitly; creation cannot silently change execution mode to make Git work.
- Freeze Team/workspace/environment identity at turn admission. Active turns, queued inputs,
  delayed approvals, and test processes must prevent unsafe reassignment or cleanup.

### Lifecycle and operator surfaces

- Add authenticated API/client and CLI create/list/show/cleanup parity. Web shows the Team, branch,
  base, path on the execution host, managed-versus-linked ownership, and live/busy/dirty state.
- Distinguish unregister/hide from deleting owned checkout files. Explain whether a branch will
  remain. Cleanup refuses dirty work or active references by default; no automatic force/prune.
- Permanent Team membership, including archived Agents, also blocks physical cleanup. Require an
  explicit existing membership/Team lifecycle transition before removing a Team's root; being idle
  is insufficient. Cleanup cannot strand Agents, delete their Team memory independently, or let
  subsequent session startup silently recreate an empty workspace in place of the removed checkout.
- Preserve external linked targets under existing [Team deletion](../../../apps/daemon/src/core/team/delete.ts)
  semantics. Deleting a Team must not acquire a new implicit right to remove an external checkout.
- Make create/cleanup interruption recoverable across filesystem, Git metadata, and DB boundaries.
  A failed operation must not abandon a usable branch without showing its retained location.
- Define backup/reset/restore treatment for managed checkouts versus external repositories. A
  restored metadata record must not point at unrelated live Git state or claim a missing external
  repository was backed up. Use `0001_init.sql` and canonical validation for any schema changes.
- Keep each Team's memory local to its workspace ownership. Show and handle Bazilion-created
  memory files explicitly so workspace cleanup and review do not accidentally commit or delete
  repository-authored content with the same path.

## Acceptance criteria

1. Two assignments use distinct Team checkouts and branches; edits in one do not change the
   other's work files or the source checkout's existing dirty state.
2. Bazilion-managed writers cannot overlap within one canonical workspace, including aliases,
   scheduler/Telegram/HTTP ingress, and approved dispatch. Other workspaces can run concurrently.
3. External mutation invalidates relevant evidence. No screen claims universal write isolation
   or attributes another actor's changes to the assigned Agent.
4. Protected commands work only in a qualified layout; unavailable Git metadata produces an
   explicit prerequisite failure, never broader mounts, extra credentials, or a host fallback.
5. Busy/dirty/referenced workspace cleanup is rejected without loss. Explicit removal affects
   only owned resources and preserves the agreed branches, outputs, transcripts, and external targets.
   A Team with permanent members cannot lose its root or memory through workspace cleanup.
6. Restart after partially completed creation/cleanup has a discoverable recovery outcome;
   backup/restore and reset follow the documented ownership policy.
7. API/CLI and web agree on identities, base revisions, ownership, lifecycle state, and consequences.

## Dependencies and sequencing

- Later increment after [BAZ-039](BAZ-039-repository-coding-context.md),
  [BAZ-040](BAZ-040-coding-environment-readiness.md), and
  [BAZ-042](BAZ-042-git-change-review.md) establish repository/environment/snapshot contracts.
- Coordinate queued targeting with [BAZ-035](BAZ-035-conversation-library.md) and
  [BAZ-036](BAZ-036-visible-follow-up-queue.md); retained requests must never follow a changed cwd.
- Refine layout and cleanup before moving to todo. If metadata mediation and lifecycle exceed L,
  split workspace admission/ownership from managed checkout creation into separate implementation
  stories. The initial coding milestone does not wait for this feature.

## Out of scope

Automatic merges/rebases/cherry-picks, push or PR publication, changing Agent membership per turn,
shared cross-Team memory, unconstrained filesystem isolation claims, cloud worker fleets,
arbitrary multi-repository tasks, and automatic deletion of unmerged branches or dirty worktrees.

## Tests

- Exercise separate assignments against a source with staged, unstaged, and untracked edits;
  validate retained source hashes/branch and distinct target work files.
- Race writer admission across Agents/ingress/aliases, external edits, queue claims, and cleanup.
- Qualify Git operations inside the real selected protected layout without access to sibling
  checkouts, host credentials, or executable repository hooks outside the allowed operations.
- Inject failures around Git create/remove, directory materialization, metadata writes, and restart;
  verify dirty/ref-busy cleanup rejection and existing linked-target deletion guarantees.
- Cover idle and archived Team members, canonical membership transitions, and session startup after
  attempted cleanup; no missing root may silently replace the assignment or orphan shared memory.
- Cover environment preparation, memory-path collisions, backup/reset/restore, and CLI/web parity.

## Open Questions

- **Checkout layout:** choose linked worktrees with narrowly mediated Git metadata, or independent
  checkouts. Recommended: qualify protected behavior first and favor independent metadata if the
  safe linked-worktree contract cannot remain bounded. Do not describe worktrees as sandboxes.
- **Writer lifetime:** should exclusion cover an Agent turn or an entire multi-turn assignment?
  Recommended: turn-level admission plus a visible assigned writer, with explicit transfer rules;
  decide how waiting questions and queued follow-ups interact before implementation.
- **Ownership and retention:** settle where managed checkouts live, which Git administrative data
  Bazilion owns, and whether cleanup retains branches and exported review evidence by default.
- **Memory and restore:** define behavior when the repository already owns `memory/`, and when a
  backup restores workspace metadata but its external Git common directory is missing or changed.
