---
id: BAZ-058
title: Content proposals with revision-bound editorial review
status: draft
size: L
created: 2026-09-19
---

# BAZ-058 — Content proposals with revision-bound editorial review

## User stories

- As an operator, I want a Team to propose source-backed text and images for specific social
  platforms, so that I can review the actual material rather than assemble it from chat messages.
- As an editor, I want to request changes and inspect the new revision, so that old approval cannot
  authorize a different caption, image or destination.
- As an operator without publishing API access, I want to export the proposal for manual posting.

## Goal

Deliver the first useful vertical slice: research/writing through existing Agents → durable content
proposal → preview → request rework → new revision → human decision/export. No live publishing needed.

## Why

Teams, file receipts and communication approvals exist; an editorial content contract does not.
Approving delivery of a file to the owner is not approval to post its contents publicly.

## Scope

- One Team-owned proposal with immutable, source-linked revisions and platform variants.
- Captured text, links, image references/hashes/order, alt text, rights/provenance notes and target
  account or explicitly unbound manual-export destination. Unbound approval cannot later authorize
  an arbitrary connected account; actual delivery requires BAZ-060's bound decision.
- Bounded Agent IPC submission and operator API/CLI/web review with revision conflict checks.
- Preview, request changes with feedback, reject, compare revisions, review/export history.
- Reuse durable result storage deliberately; define private disclosure, reference ownership,
  tombstone behavior and retention/pinning without a parallel unbounded file store.
- Source-owned Attention link for pending review; preserve existing Team communication policy.
- Follow-up rework uses existing messaging/queue mechanisms, not an orchestration/stages engine.
- Forward migration and hermetic wire types; backup/restore and deletion ownership rules.

## Out of scope

Image-provider integration, external accounts, upload/publishing, platform scheduling, native apps,
formal fact verification, multi-person approval chains and a general-purpose workflow builder.

## Tests

- Immutable revisions and bytes survive workspace edits/restart; missing/tombstoned assets do not substitute.
- Stale/duplicate decisions, two-tab review, unauthorized cross-Team reads and private result leaks fail closed.
- Rework produces a new linked revision and cannot reuse approval; feedback arrives once.
- Manual export matches approved captured content without performing any platform side effect.
- Dirty edits, accessible preview/rework controls, mobile layout, failure/retry and CLI/web parity.
- Backup/restore preserves history and references; actual source conversation remains authoritative.

## Open Questions

- Exact proposal/variant limits and retention/reference semantics for existing results.
- Which review fields are required in a manual-export-only proposal versus a connected destination?
- Operator scope mapping for editorial decisions versus destination/account administration.

See [scenario and architecture](../design/social-content-team.md). BAZ-060 adds deterministic
publication authorization; this story must not label a generic review decision as a completed post.
