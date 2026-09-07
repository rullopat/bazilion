---
id: BAZ-044
title: Revision-bound coding review and handoff
status: draft
size: L
created: 2026-09-07
priority: medium
note: Later coding increment; review a captured change and prepare an evidence-backed handoff without automatic publication.
---

# BAZ-044 — Revision-bound coding review and handoff

## User stories

- **As an operator receiving a code change**, I want the request, diff, checks, and unresolved issues
  together, so I can decide whether it is ready to integrate.
- **As an operator requesting a second opinion**, I want a reviewer to inspect the exact proposed
  revision, so feedback stays relevant even if the author continues working.
- **As an operator using my own editor and Git workflow**, I want to open the right files and export
  a patch and PR description, so I can complete the handoff with clear evidence and boundaries.

## Goal

Create a narrow review packet linking an existing coding conversation to an immutable change
snapshot, verification receipts, and review findings. Support operator review and explicitly
requested review by an existing Agent, then export a useful handoff through current clients.

## Why and current baseline

Verified against Bazilion `13c3a63` (v0.14.2) on 2026-09-07:

- [Messaging](../../../apps/daemon/src/runtime/tools/messaging.ts) and Team Policy already support
  Agent collaboration. A message asking another Agent to review does not itself freeze the code
  or prevent the reviewer from modifying a shared working directory.
- [Reviewed learning](../done/BAZ-003-hermes-self-learning.md) reviews transcript lessons. It is not
  a code review and must not become an alternative review/task workflow by relabelling its rows.
- Existing conversation, output, and coding drafts provide the necessary building blocks. This
  story adds a bounded review/handoff relationship rather than another transcript or general job log.
- Hermes's [release-tagged desktop guide](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/desktop.md#git-review--worktrees)
  connects source review to Git handoff. Bazilion should preserve the operator's requested completion
  boundary and distinguish review evidence from publication or production acceptance.

## Scope

### Captured review packet

- An authenticated operator selects the originating Team/conversation and a BAZ-042 snapshot.
  Show the request/acceptance summary, captured base and proposed change, existing dirty state,
  relevant BAZ-041 checks, known limitations, and unresolved findings.
- Source identifiers are immutable. Model-authored summaries are labelled commentary; commands,
  exit statuses, hashes, and publication state must come from execution evidence or verified facts.
- Preserve a review of an older snapshot after new edits, but mark it stale for the current code.
  New tests or review findings cannot silently overwrite the original packet's evidence.
- Use scoped metadata and references, not duplicated session content or runs/events tables. Bound
  retained packet content and honor deletion/expiry of linked artifacts with visible missing states.

### Operator and Agent review

- Let the operator inspect files/hunks, add findings with severity and snapshot/path/line context,
  and record a review conclusion. Resolving a finding requires an explicit decision or a linked
  subsequent revision; a changed line number alone cannot prove the issue was fixed.
- An explicitly selected existing reviewer Agent receives the exact approved packet through
  canonical messaging and Team Policy, preserving Agent membership, sender/recipient scope, and
  the existing approval and loop controls. Do not broadcast the private transcript by default.
- Bind reviewer input and results to the captured revision. Start with static review: scoped
  read-only snapshot/context access, no unrestricted host tools, no source-workspace edits, no
  installation or checks executed by the reviewer. Reuse BAZ-041 evidence for test results.
- Enforce the review capability at the daemon/runtime boundary; a prompt saying “read only” is
  insufficient. Selecting a different model does not change these limits or grant new credentials.
- Preserve a typed review request's snapshot, capability, and sole dispatch owner through inbox
  routing, busy queueing, and communication approval. The ordinary inbox-wake path currently starts
  normal protected coding turns with writable Bash; it must not also consume the review packet or
  reinterpret it as a general coding request. Late approvals cannot change or widen the review scope.
- Reviewer findings contain evidence and references; they do not automatically approve execution,
  apply changes, merge code, or substitute for human acceptance. Findings that cannot be correlated
  to the packet are marked unverified instead of attached to current lines by guesswork.
- Display blocked, approval-held, running, failed, cancelled, completed, and stale review states
  from their actual source operations. Do not add general retries, approver assignment, or stages.

### Handoff and operator surfaces

- Add authenticated packet/create/read/review/export operations with API/client and CLI parity.
  Web presents the captured change, checks, findings, and next action in one responsive view.
- Export a patch plus concise handoff/PR-description text with the problem, resulting behavior,
  verification, and unresolved limitations. Use BAZ-034's durable publication/access contract;
  exports or Telegram notifications cannot bypass an approval-held Agent delivery.
- Provide file/line links and copyable locations. Opening an editor is an explicit operator action
  using a configured command/path mapping; repository names and filenames are not shell commands.
- Show which machine owns the workspace. A browser on another computer must not launch a local
  editor with a daemon-host path and claim that it opened the reviewed source. Offer copy/export
  or a configured remote-editor handoff with an explicit snapshot-versus-live-file distinction.
- Keep completion evidence distinct: change prepared, checks current, reviewed, committed, pushed,
  PR opened, merged, deployed, production accepted. Only display a state as verified when its
  specific evidence exists; a review conclusion does not imply any later state.
- This slice prepares handoff material and can record explicit operator-reported external state as
  such. It does not create a GitHub credential integration or execute publication automatically.

## Acceptance criteria

1. A review packet opens the exact captured base/change and associated check evidence after
   refresh/restart; later repository edits do not rewrite it and make its current-code status stale.
2. A reviewer Agent can inspect only the authorized captured scope and cannot modify the source
   checkout or use a hidden host-shell/network capability. Ordinary Team Policy still governs delivery.
   Inbox wake, queueing, and approval dispatch cannot execute the same review as an unrestricted turn.
3. Findings link to the reviewed snapshot; stale, unavailable, or uncorrelated evidence is explicit.
   A completed review is not displayed as passing tests or accepted production behavior.
4. Exports preserve the same reviewed change and truthful verification, with authenticated access
   and source egress holds. Missing/deleted evidence does not yield a silently complete handoff.
5. Editor/file links identify execution host, path mapping, and live versus snapshot content;
   hostile paths cannot become commands or open unrelated files without operator selection.
6. API/CLI and web share review status and exports. No automatic commit, push, PR, merge, deploy,
   or permission change occurs when a packet is created or a reviewer finishes.

## Dependencies and sequencing

- Depends on [BAZ-042](BAZ-042-git-change-review.md) snapshot identity and
  [BAZ-041](BAZ-041-coding-command-verification.md) executor-owned verification.
- Uses [BAZ-034](BAZ-034-durable-agent-deliverables.md) for durable exports and
  [BAZ-035](BAZ-035-conversation-library.md) for exact conversation references. No new chat store.
- [BAZ-043](BAZ-043-isolated-coding-workspaces.md) enables parallel assignment ownership later;
  static review of an immutable snapshot must remain possible without managed worktrees.
- Later than the initial coding milestone. If runtime-enforced Agent review and editor handoff
  exceed L together, split operator packet/export from the reviewer capability before moving to todo.

## Out of scope

Automatic commit/push/PR creation, code-host credentials, merge/deployment automation, branch
mutation, fixing findings without a new instruction, reviewer-run commands, an IDE/LSP client,
general approval workflows, and treating peer review as an execution authorization grant.

## Tests

- Capture a dirty repository, run checks, create a packet, and then change files/base/environment;
  verify immutable old evidence, stale-current status, and truthful missing-check states.
- Test reviewer tool allowlists, exact snapshot access, forged identities, cross-Team denial,
  approval holds, loop budgets, stale result correlation, and cancellation without source mutation.
- Race ordinary inbox wake against review admission, busy dispatch, and delayed approval; the
  captured review runs only through its restricted owner and never inherits writable coding tools.
- Validate export hashes, packet/artifact deletion and retention, backup/restore if metadata is
  persisted, web/CLI parity, narrow/keyboard review UI, and approved-versus-held publication.
- Exercise local and remote editor mappings, missing files, snapshot/live divergence, hostile
  filenames, and proof that review completion cannot trigger Git or deployment side effects.

## Open Questions

- **Review capability:** define the minimal read-only snapshot tools and policy delivery binding.
  Recommended: a selected runtime capability for static evidence inspection, never a global
  permission reduction on an Agent or reuse of the learning-review lifecycle.
- **Review conclusion:** choose a small vocabulary and rules for unresolved findings. Recommended:
  distinguish the reviewer's recommendation from the operator's acceptance, both scoped to revision.
- **Retention and external state:** decide packet retention and representation of user-reported
  commit/PR/deployment links. Keep reported and independently verified states visibly distinct.
- **Publication follow-up:** an explicit commit/push/draft-PR story can follow once exact change
  selection, credentials, and user authorization boundaries are defined; do not include it by stealth.
