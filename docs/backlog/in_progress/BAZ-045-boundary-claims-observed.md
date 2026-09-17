---
id: BAZ-045
title: Boundary claims observed where they are claimed
status: in_progress
refined: 2026-09-16
size: M
created: 2026-09-16
priority: high
note: Follows BAZ-044's review lesson — a guard that no test exercises is a claim, not a guarantee.
---

# BAZ-045 — Boundary claims observed where they are claimed

## User stories

- **As the operator of Agents that verify and review code**, I want each boundary the product claims
  to be *observed* in the configuration where it is claimed, so a guard that nobody exercises cannot
  pass for a guarantee.
- **As the operator reading a verification receipt**, I want a declaration I made to be a real
  constraint on the report, so "nothing appeared outside the declared paths" cannot be true because
  the declaration covered everything.
- **As the operator using the review and verification pages**, I want what I can see and click to be
  observed in a browser, so a panel that quietly stops showing a refusal fails a test instead of
  shipping.

## Goal

Close the gap between what the product asserts about its boundaries and what any test actually
observes, in the three places where BAZ-044's work left the assertion stronger than the evidence.

## Why

BAZ-044's own review found that **no high-severity finding was a missing guard**. The guards existed;
two were never wired into the production path, and "covered by tests" was true of the pieces and false
of the wiring. This story is the small, cheap counterpart: find the guards whose *only* evidence is an
adjacent test or no test at all, and make the evidence match the claim.

Every item below was confirmed by reading the code before this story was written, not assumed:

1. `captureVerificationRequest` refuses illegitimate declared writable paths (non-string, empty,
   over-bounded, absolute, `~`-prefixed, backslash, empty-after-normalisation, containing `..`, more
   than 16). **Exactly one of those branches has a test** — the count. The escape-hatch branches, which
   are the ones that matter, are unverified, and the operator HTTP producer has no test at all.
2. `checks[].cwd` is **length-bounded at capture but not scoped there**. The escape guard lives in the
   executor, where `codingRelativePath` throws on `..`, `.`, empty segments or `.git`, and the runner
   catches that as a generic executor failure — so a request carrying an out-of-workspace `cwd` is
   accepted, has rows written, and is only discovered when the check runs, reported as a failed
   execution rather than a refused input. Fails closed, but in the wrong place and for the wrong reason.
3. A restricted verification turn has `verification-container.integration.test.ts`, which observes its
   container, its memory posture and its cleanup. A restricted **review** turn has no equivalent: it
   is never observed with `BAZILION_BASH_SANDBOX=docker`, and nothing asserts it creates no container
   or leaves no scratch.
4. The review-packet panel and the verification panel have unit and presentation tests but no browser
   observation. The Git review panel has one (`scripts/check-git-review-ui.mjs`), so the harness,
   the disposable daemon and the narrow-screen pattern already exist.

## Scope

### 1. A declaration cannot be widened into silence

- Cover every refusal branch of the declared-writable-path contract with a test, on **both** producers
  (the agent `request_verification` tool and `POST /api/teams/:id/verifications`), asserting the
  blocker reason and that **no request row is written**.
- Include the adversarial case that matters: a declaration whose normalised form covers the workspace
  (`..`, `.`, `/`, `//`, `././`, an empty segment run) must be refused, never widened. A declaration
  that covers everything turns the receipt's "writes outside the declared output paths" line into a
  false negative, which is the whole point of the line existing.
- Keep the statement in the receipt that declared output paths are **advisory, not enforced**. This
  story does not confine writes; it makes the declaration trustworthy as a declaration.
- **Scope `checks[].cwd` at capture, using the existing `codingRelativePath` helper** rather than a
  second implementation of the same rule, so an out-of-workspace `cwd` is refused with a blocker that
  names the offending value — before any request row exists — instead of surfacing later as a check
  that mysteriously did not execute. The executor's guard stays: it is the last line, not the only one.

### 2. A review turn is observed to run nothing

- A restricted review turn, dispatched with `BAZILION_BASH_SANDBOX=docker`, creates **no container**,
  registers no container lease, holds no execution capability, and leaves no scratch directory behind.
  Observed end to end the way verification's integration test observes its own posture, and asserted
  against the lifecycle the daemon actually holds — not against the worker spec's shape.
- The existing fixture already attempts forbidden IPC methods. Extend the assertion to the *container*
  dimension so "a reviewer cannot run anything" is observed under the configuration that turns
  execution on, not only under the default.

### 3. The two panels are observed in a browser

- Extend the existing browser acceptance harness to the review-packet panel and the verification
  panel: rendered findings with their resolution state, an `unverified` finding with **no resolve
  control**, the unresolved count, applicability, and the empty and unavailable states.
- Narrow-screen layout and the keyboard path, following the Git review harness rather than inventing
  a second pattern.
- The assertions are about what the operator can see and click. A panel that stops rendering a
  refusal, or starts offering a control the product refuses, must fail.

## Out of scope

- **Enforcing** declared output paths. Confinement needs the container mount strategy (a read-only
  workspace with per-path writable mounts), and that is a larger change than this story.
- Container posture for ordinary coding turns — BAZ-006 owns it.
- Code-host publication, commit/branch/PR automation — drafted separately as BAZ-046.
- Any new review or verification capability, and any change to the capability ceiling.

## Resolved before refining (read from the code, not assumed)

1. **A review turn gets no container host.** `spawnWorker` clears `containerHost`, `codingHost`,
   `messagingHost`, `browserHost` and `mcpHost` for every restricted kind, and the review dispatch
   passes no container host at all. So the claim is true by construction — and *unobserved*, which is
   what this story fixes. If observation shows a container is created, that becomes the defect.
2. **`checks[].cwd` is not scoped at capture** (see Why #2), and the executor's guard is untested from
   the capture side.
3. **Both producers already share `captureVerificationRequest`**, so validating there covers the agent
   tool and `POST /api/teams/:id/verifications` at once — which is also why the missing operator-route
   test is a test gap rather than a wiring gap.
4. **The browser harness is extended, not duplicated.** One disposable-daemon, Chromium-based pattern
   already exists for the Git review panel.

## Tests

- Blocked-declaration cases on both producers, each asserting the reason and zero rows written,
  including every escape shape that must never be widened into a declaration that covers the tree.
- A capture-time refusal for an out-of-workspace `checks[].cwd`, with the executor guard kept as the
  last line of defence.

## As built (2026-09-16)

Implemented and observed; acceptance evidence in [BAZ-045-acceptance.md](BAZ-045-acceptance.md). Four
things changed and are not what the story assumed when it was written:

1. **The declared-writable-path guards already existed and were mostly untested.** Six refusal branches,
   one test (the count). The fix was coverage on both producers, not a new guard.
2. **`checks[].cwd` was the real defect.** Length-bounded at capture, scoped only in the executor, so an
   out-of-workspace `cwd` was accepted, written, and then surfaced as a check that did not execute.
3. **The operator route recorded findings as `open` unconditionally** — the one rule the state exists to
   enforce (`unverified` cannot be resolved) held for Agents and not for the operator. Found by asking the
   operator path the same question the reviewer path asks, and now answered by one shared function.
4. **The web verification panel stated none of the limits the result message states.** "All inside the
   declared paths" read as confinement and a completed request as an approval. One shared definition now
   renders on both, and the panel states it always rather than only after a check has run.

Also corrected: the v0.19.1 release notes claimed a clean lint, which was false (one error in a live-run
harness script). The claim is corrected in the published notes. `biome check` reports pre-existing warnings
and exits 0 while only warnings remain — reading the warning count as a failure is how a false "clean" claim
gets made.
- A review turn's container/scratch/execution posture under Docker isolation.
- Browser observation of both panels, including a refusal that must remain visible.
- Gate cases for each new assertion, so a silently dropped check fails the release gate.
