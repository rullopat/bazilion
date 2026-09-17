---
id: BAZ-046
title: Publish an accepted change to a code host
status: draft
size: L
created: 2026-09-16
priority: high
note: The gap that caps the value of the whole coding sequence. Deliberately excluded by BAZ-043; needs operator decisions before implementation.
---

# BAZ-046 — Publish an accepted change to a code host

## User stories

- **As the operator**, when a change has been verified and reviewed and I accept the handoff, I want it
  committed to a branch and opened as a pull request, so that accepting a review is not followed by doing the
  Git work by hand.
- **As the operator**, I want publication to be a decision I make about a specific revision, so nothing an
  Agent does on its own can put code on a host.
- **As an Agent**, I want the publication outcome reported back to me as an outcome, so I stop guessing
  whether my change left the machine.

## Goal

Carry one captured, reviewed revision as far as a code host will take it — commit, branch, push, pull
request — as an **operator-approved** action, with the result recorded as an observed fact rather than a
claim.

## Why

Every story in the coding sequence ends with the same sentence: *this is not an approval to publish, merge or
deploy.* BAZ-043 tracks `committed`, `pushed`, `pullRequest`, `merged`, `deployed` and `productionAccepted` as
**operator-reported** fields precisely because nothing in Bazilion can make any of them true. The result is a
handoff that stops one step short of being useful: an agent writes code, a specialist verifies it, a reviewer
concludes, the operator reads the export — and then does the Git work in a terminal.

This is the last unbuilt piece of the coding sequence, and the largest security surface in it: the first thing
that would put bytes on another machine as a consequence of work rather than as an explicit operator action.

## Scope (proposed, pending the decisions below)

- **Publication is per revision and per operator decision.** The subject is a BAZ-042 snapshot plus the
  review packet that concluded about it. There is no "publish the workspace" operation.
- **Commit content comes from the reviewed revision**, not from whatever the working tree holds at approval
  time — the same content-honesty rule BAZ-043 uses for patches: if the tree no longer matches the capture,
  the operator is told, and publication either refuses or names what would differ.
- **One new capability, closed to one operation**, dispatched by the daemon like BAZ-044's verifier and
  BAZ-043's reviewer, so no ordinary writable turn can invoke it. It is a *publication* turn, not a coding
  turn.
- **Credentials live in the `secrets` table**, one row per host, never in the worker environment beyond the
  single credential the operation needs — reusing BAZ-031's protected-runtime discipline.
- **The outcome is observed, not asserted**: the host's answer (branch name, commit SHA, PR URL) is recorded
  from the response, and the packet's `reported` state is filled in only from that observation.
- **Nothing is merged or deployed.** Publication stops at an open pull request; merge and deployment stay
  operator-reported exactly as they are now.
- **Fail closed everywhere**: no credential, an unsupported host, a stale revision, a protected branch, or a
  signing requirement that cannot be met refuses the publication with a reason and publishes nothing.

## Open questions (operator decisions)

1. **Which hosts?** GitHub only (it is what the repository and the release workflow use), or a host-agnostic
   interface with GitHub as the first implementation? My recommendation: GitHub first, behind a narrow
   interface, because a generic "any Git host" abstraction with one implementation is the kind of unexercised
   seam this project's reviews keep finding.
2. **What is "acceptance"?** A new operator action on a reviewed packet (`publish`), or a state change
   (`reported.committed` set by the operator)? My recommendation: an explicit action, because the reported
   states exist to record what the operator did *elsewhere* and should not become a control surface.
3. **Is a push ever automatic?** The alternative — an agent that pushed after its own conclusion — would
   contradict every story so far. My recommendation: never.
4. **Protected branches and force-push.** No force-push, ever? My recommendation: refuse to publish to a
   branch whose remote would require a force update, and never force-push.
5. **Signing.** Does a publication need signed commits? If yes, what supplies the key, and what happens when
   it is unavailable (refuse, or publish unsigned and say so)? My recommendation: publish unsigned and record
   that fact, unless the operator says a signature is required, in which case refuse without one.
6. **Multiple remotes and non-GitHub origins.** Refuse, or support any reachable remote with no PR? My
   recommendation: refuse an origin that is not a configured host, and say which one was found.
7. **What may an Agent learn?** The publication outcome (branch, SHA, PR URL) — and nothing about the
   credential. My recommendation: yes, exactly that, delivered as a result message through the canonical
   messenger like BAZ-044's.

## Out of scope

- Merge, deployment and preview environments.
- Branch mutation beyond creating the publication branch (no rebase, no amend, no force).
- A general Git client, an IDE/LSP integration, or a second Git path alongside BAZ-039's hardened harness.
- Reviewing, verifying, or changing the code being published.

## Tests (proposed)

- A publication refuses without a credential, an unsupported host, a stale revision, a protected branch, and
  a force-update requirement — each naming the reason, each publishing nothing.
- A publication of a reviewed revision is observed against a **local bare repository standing in for a host**,
  so the commit content, branch name and outcome are real without touching a network.
- The capability is refused to every turn kind that is not a publication turn, including coding turns.
- The recorded outcome comes from the host's response, and a claim the host did not make is never recorded.
- A browser observation of the operator's decision surface, so a stopped publication is visible rather than
  silent.
