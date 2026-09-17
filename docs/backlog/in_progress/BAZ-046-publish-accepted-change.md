---
id: BAZ-046
title: Publish an accepted change to a code host
status: in_progress
refined: 2026-09-16
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

## Decisions (2026-09-16, before refinement)

1. **Hosts: GitHub first, behind a narrow interface.** One `CodeHost` with one operation — open a pull
   request — and two implementations: GitHub (REST, credential from the `secrets` table) and a local
   adapter used only by tests. A generic "any Git host" interface with one implementation is the
   unexercised seam this project's reviews keep finding, so the interface exists only to make the local
   bare repository usable as a stand-in, not to promise other hosts.
2. **Acceptance is an explicit operator action**, not a reported-state edit. `POST /api/teams/:id/publications`
   is the decision; the `reported` states keep recording what the operator did *elsewhere* and do not become a
   control surface.
3. **Never automatic.** An Agent cannot publish, and no conclusion, verification result or approval causes a
   publication. The operator's action is the only trigger.
4. **Never a force push.** A source that would require one, or a non-fast-forward update of the head branch
   (including a head branch that already exists on the remote), refuses and says so.
5. **Unsigned, and said out loud.** Publication commits are unsigned and the record states `signed: false`. No
   code path may claim a signature. If signed commits are required, the operator says so first — with a key
   source — and until then the truth is recorded rather than manufactured.
6. **An origin that is not the configured host is refused, naming the origin.** No inference from a remote URL,
   and no attempting anyway because the credential happens to be there.
7. **An Agent learns the outcome and nothing else**: branch, commit SHA, pull-request URL or the refusal
   reason — delivered through the canonical messenger. Never the credential, never the remote URL, never
   anything about the host's API.

### Design decision that overrides the draft

The draft imagined a **publication turn** — a restricted worker, dispatched by the daemon, holding a closed
capability. On reflection that is wrong, and building it would have added a capability for no reason: nothing
about publishing is a judgement call. There is no content to read, no finding to record, no command to choose.
Publication is a **deterministic daemon-side operation** triggered by an operator action, like the verification
executor. So there is no publication worker, no publication tool and no new capability to leak — the security
property is that no model is ever in this path, which is stronger than a capability a model must be refused.

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

## As built (2026-09-16)

Implemented and observed; evidence in [BAZ-046-acceptance.md](BAZ-046-acceptance.md). Released in
**v0.20.0**. Three things are not what the draft assumed:

1. **No publication turn, no publication capability.** The draft's restricted worker would have added a
   capability for a deterministic operation. The daemon does the work in-process, so the property is that no
   model is in this path at all.
2. **A `local` host adapter is a second real implementation, not a test fake.** It makes a publication
   observable against a bare repository — a genuine commit, branch and ref, with no network and no
   credential — and it says it opens no pull request instead of inventing a URL.
3. **Building it surfaced a pre-existing defect in BAZ-043**: an operator conclusion recorded a verdict and
   left the packet `open`, while the report's own `facts.reviewed` already derived from the conclusions. One
   report, two answers. Fixed at the source; the trade-off (an operator conclusion settles the packet) is
   recorded in the acceptance record.
