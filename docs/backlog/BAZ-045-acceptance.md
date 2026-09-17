# BAZ-045 — acceptance record

Boundary claims observed where they are claimed. Everything below was **observed**, and every observation
was probed by reverting the change it covers: a guard that passes its own test proves nothing until the test
fails without it.

## 1. A check's working directory is scoped where it is refused, not where it runs

**What was wrong.** `captureVerificationRequest` length-bounded `checks[].cwd` and validated the declared
writable paths, but never scoped the working directory. The escape guard lived in the executor, where
`codingRelativePath` throws on `..`, `.`, empty segments or `.git` — and the runner caught that as a generic
executor failure. So a request carrying `cwd: '../../etc'` was **accepted, had all its rows written, and was
only discovered when the check ran**, reported as a check that mysteriously did not execute.

**Fixed** by scoping the path at capture with the daemon's existing `codingRelativePath`, so the refusal names
the offending value before any row exists. The executor keeps its copy as the last line of defence.

**Observed.** `apps/daemon/test/lib/verification-capture.test.ts` — `../../..`, `/etc`, `src/../../outside`,
`.git` and `a\b` are each refused with `unsupported` and a detail naming the value; `verification_requests`
and `verification_checks` both hold **zero rows** afterwards; `packages/app` still captures, so the guard
cannot pass by refusing everything.

**Probed.** With the guard reverted, the same case returns `captured` for `cwd: '../../etc'` — the test fails.

## 2. An operator finding cannot be silently resolvable

**What was wrong.** The rule "an `unverified` finding cannot be resolved" was enforced in the reviewer's
capability host, which computes availability before recording. The operator's HTTP route never asked: it
passed `authorKind: 'operator'` and no state, and `addReviewFinding` defaults to `open`. So an operator could
record a finding about a revision whose content no longer existed, it was stored `open`, and **being `open` it
could be resolved** — the one rule the state exists to enforce held for agents and not for the operator.

**Fixed** by extracting `readRevisionContentAvailability` into `lib/review/revision.ts` and using it on both
entry points, so the answer to "can this revision's content still be reproduced?" has one implementation.

**Observed.** `apps/daemon/test/routes/reviews.test.ts` — a finding recorded after the working tree moved is
`unverified`, the resolve request is refused, and the finding recorded while the content was still there
remains `open` and resolvable. Also visible from the operator's seat: the browser harness reads the panel and
finds `UNVERIFIED — not correlated to this revision` on the uncorrelated finding, `Resolve explicitly`
**exactly once** (on the open one), and `applicability: changed since capture (never a pass)`.

**Probed.** With the route reverted to `state: 'open'`, the browser harness fails with "an uncorrelated
finding is not labelled" — the operator's finding is back to looking enforceable.

## 3. The limits are stated on the surface the operator actually reads

**What was wrong.** The result message handed to a requesting Agent ends with two facts: a non-zero exit is
not proof about later code and not an approval, and declared output paths are **not enforced**. The web panel
stated **neither**. On that panel, "Writes: build/out.txt — all inside the declared paths" reads as
confinement, and a completed request reads as an approval.

**Fixed** by moving the statement into `@bazilion/api-types` as `VERIFICATION_OUTCOME_LIMITS` — one
definition, rendered by the result message and by the panel — and rendering it on the panel **always**, not
only once something has run, because a request waiting to be verified is exactly when those assumptions get
made.

**Observed.** `apps/web/test/verification-limits.test.ts` asserts both limits are named and that both
surfaces are actually **wired** to the definition — the failure mode BAZ-044's review found, where the guard
and its tests existed and the production path never used them. The browser harness reads the pending request
panel and finds both sentences rendered. `apps/daemon/test/lib/verification-e2e.test.ts` asserts the delivered
message contains each sentence verbatim from the shared definition.

## 4. A review turn is observed to run nothing

**What was true and unobserved.** The claim was true by construction: `spawnWorker` clears the container,
coding, browser, MCP and messaging hosts for every restricted kind, and the review dispatch passes no
container host at all. Nothing observed it with isolation switched on, and verification had an integration
test for its own posture while review had none.

**Observed.** `apps/daemon/test/lib/review-e2e.test.ts` dispatches a review turn with
`BAZILION_BASH_SANDBOX=docker`: the attempt completes — which is the fixture's own assertion that every
capability a reviewer must not have, container and coding ones included, was refused by the daemon — and
**no container is registered against any workspace writer, with no active writer left behind**.

**Non-vacuous by control.** The same measurement is then pointed at a container that does exist, registered
through the production lifecycle: it is seen. Without that control, "no container" could be an assertion that
is always true. (The control covers the read only; it deletes its own rows rather than confirming cleanup of a
container that never existed, because confirming that needs real Docker.)

## Two corrections to earlier records

- **A published claim was false.** The v0.19.1 release notes said "Typecheck, lint, format and the web build
  are clean". `pnpm lint` was **not** clean: it reported one error (a `forEach` callback returning a value in
  `scripts/verification-live-run.mjs`, added by the same change). The release notes have been corrected. The
  same false claim was made in the 0.19.0 validation summary, where the same class of pre-existing warnings
  was mistaken for a passing check.
- **Lint's warnings are not its errors.** `biome check` reports 67 pre-existing warnings (mostly
  `noNonNullAssertion` in tests) and exits 0 while only warnings remain. Reading the warning count as a
  failure, or a truncated diagnostic list as the whole list, is how a "clean" claim gets made without one.

## Validation

- **1794 tests pass, 11 skipped** (231 files).
- Adversarial security acceptance gate: **145 required cases** (four added here:
  `VERIFICATION-CAPTURE-SCOPES-CHECK-CWD`, `REVIEW-OPERATOR-FINDING-CANNOT-BE-OPEN-WHEN-CONTENT-IS-GONE`,
  `VERIFICATION-LIMITS-STATED-ON-BOTH-SURFACES`, `REVIEW-TURN-RUNS-NOTHING-UNDER-ISOLATION`).
- `pnpm typecheck`, `pnpm lint`, `pnpm format` all clean; web typecheck and build clean.
- Browser acceptance (`scripts/check-git-review-ui.mjs`) extended and passing: four new observations, three
  new screenshots and two new text dumps in its evidence directory.

## What this story did not do

- **Enforcing** declared output paths. Confinement needs the container mount strategy (a read-only workspace
  with per-path writable mounts). The statement that they are not enforced remains true and is now stated
  where the operator reads it.
- Container posture for ordinary coding turns (BAZ-006 owns it), and code-host publication (BAZ-046).
