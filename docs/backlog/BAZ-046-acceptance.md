# BAZ-046 — acceptance record

Publishing an accepted change to a code host. Implemented, observed, and released in **v0.20.0**.

## The decisions, and what they cost

The seven open questions were answered before implementation (see the story file). The one that changed the
design is worth repeating: the draft imagined a **publication turn** — a restricted worker with a closed
capability — and that was wrong. Nothing about publishing is a judgement call, so there is no publication
worker, no publication tool and no capability for an Agent to be refused. The property is that **no model is
in this path at all**, which is stronger and much smaller than a capability a model must be denied.

The other decisions, as built:

| Question | Answer, as implemented |
| --- | --- |
| Which hosts | GitHub first, behind a one-operation interface (`remoteUrl`, `openPullRequest`). `local` is a second real adapter so a publication can be observed against a bare repository with no network. |
| What "acceptance" is | `POST /api/teams/:id/publications`. The `reported` states stay a record of what the operator did elsewhere. |
| Is a push ever automatic | No. Nothing an Agent does causes a publication. |
| Force push | Never. A head branch that exists on the remote is refused before the commit is built. |
| Signing | Unsigned, recorded as `signed: false`, and the schema will not store anything else. |
| Non-configured origins | Refused, naming what was found. The Team repository's own `origin` is never consulted. |
| What an Agent learns | Branch, commit, pull request (or refusal reason) — never the credential, the remote URL or a host path. |

## Observed

**A real push, end to end.** `apps/daemon/test/lib/publication-e2e.test.ts` publishes a reviewed revision to
a **real bare repository** and reads the result back with `git` itself: the branch exists at the commit the
record names, the tree holds the reviewed bytes (`export const answer = 42`, not the current 43), the commit
is based on the pinned base, and `%G?` reports **`N`** — no signature. The browser harness observes the same
thing through the operator's panel and asserts the panel's own text: `commit <sha> · unsigned`,
`no pull request was opened`, `Nothing was merged and nothing was deployed.`

**The refusal matrix, all before anything is sent.** No host configured, no credential, a protected head
branch (`main`, `nested/main`, `master`), a branch name that is not a ref this build will write
(`../evil`, `-x`, `a//b`, `trailing/`) — each refused with a reason, **zero publication rows**, and a host
with no branches at all. A refusal that can only be decided by asking the host (a branch that already exists)
is recorded as a `refused` row: the operator gets a reason instead of silence, and the row still says
`nothingSent`.

**Content honesty, arithmetic rather than caution.** Moving the tree after the review makes the publication
refuse with `revision_not_reproducible` and name the path. Building this found a defect of my own: the digest
comparison used a `sha256:` prefix while the capture stores bare hex, so **no path ever matched** — which
would have looked exactly like a reproducible revision that was not there.

**The GitHub path, against a stand-in API.** The remote is built from configuration (`owner/name` →
`https://github.com/<owner>/<name>.git`); `../escape` and `file:///…` are refused as repository names. A
pull request is reported only when the host returned one — a 201 without a URL records a number and no URL;
a 403 is a refusal; an unreachable host says whether a pull request exists is **unknown**, not that none does.

**Recovery that cannot lie.** An expired lease becomes `uncertain`, never `failed`, and a retry through the
operation is refused as `not_claimed`. Startup recovery and every scheduler tick do it.

**The wire form, field by field.** The first version of the route's projection returned the record cast to the
wire type, and the notification target went out with it. The test that caught it asserts the key list; the
projection is now written out.

## A pre-existing defect this story surfaced

**An operator could conclude a package and the packet stayed `open` forever.** The reviewer's path moved the
packet when its attempt settled; the operator's path recorded the conclusion and stopped. The report's
`facts.reviewed` was already `conclusions.length > 0`, so the *same report* said `open` and
`reviewed: true` at once — and an operator-concluded packet was refused by every consumer that asks whether a
packet was reviewed.

This is the class BAZ-045 was about, found by building the feature that first consumes the state. Fixed at
the source: recording a conclusion settles an `open` packet to `reviewed`, whoever recorded it. The existing
test that asserted the old behaviour was rewritten with the reason, and one trade-off is real and recorded
here: **after an operator conclusion the packet is settled**, so delegating a reviewer afterwards needs a new
packet — the same as after a completed reviewer attempt.

## Validation

- **1806 tests pass, 11 skipped** (234 files).
- Adversarial security acceptance gate: **153 required cases** (eight added for this story).
- `pnpm typecheck`, `pnpm lint`, `pnpm format` clean; web typecheck and build clean.
- A fresh `BAZILION_HOME` bootstraps on the new schema (`publications` present); the canonical schema
  fingerprint and `CANONICAL_OBJECTS` were updated together (128 objects,
  `469e6610e0f1030aa9e699bff1083a54305a77bc48f573eeae908d96a48d5396`), and the backup tests pass.
- Browser acceptance covers the panel: a real push to a bare repository, the unsigned commit, no invented
  pull request, a refusal that says nothing was sent, and no horizontal overflow on a narrow screen.

## Schema

`publications` plus three indexes. **0.19.x homes cannot be upgraded in place**; the alpha contract remains
clean-install only, with a `bazilion backup` / restore path for state.

## What this story does not do

- No merge, no deployment, no preview environments — and no claim of any.
- No branch mutation beyond creating the publication branch: no rebase, amend or force.
- No Git host other than GitHub and the local adapter; a second host needs a second implementation, not a
  wider interface.
- No signed commits. If a signature becomes required, the operator says so first (and says where the key
  comes from) rather than the code inventing one.
