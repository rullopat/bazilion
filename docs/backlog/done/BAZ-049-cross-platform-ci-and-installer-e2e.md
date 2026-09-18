---
id: BAZ-049
title: Cross-platform CI matrix and fresh-machine installer E2E
status: done
size: M (1 week), ran longer — three OSes and eleven CI iterations
created: 2026-09-17
refined: 2026-09-17
shipped: 2026-09-18
release: v0.21.0-beta.2
priority: high
note: Beta blocker. CI is ubuntu-only while the product ships win32/darwin branches, an install.ps1, and non-technical-user installers.
---

# BAZ-049 - Cross-platform CI matrix and fresh-machine installer E2E

## User stories

- **As a Windows operator installing Bazilion from the website**, I want the same
  first-run experience the Linux demo shows, so platform-specific breakage (paths,
  liveness, process handling) never reaches me.
- **As a maintainer**, I want the test suite and a fresh-install E2E running on
  macOS and Windows in CI, so a win32/darwin regression is caught in the PR that
  causes it, not by a beta user.
- **As an operator on macOS or Windows**, I want the docs to state plainly which
  features are validated on my platform, so a boundary like `safe_reads_unavailable`
  is a documented edge, not a surprise.

## Goal

Bazilion's cross-platform claims are executed, not just code-supported: CI runs the
suite on all three OSes, a fresh-machine install → bootstrap → first turn → uninstall
E2E passes per OS, and the supported-platform boundary (including the Linux-only
coding sequence) is stated in the product docs.

## Why

`ci.yml` runs `ubuntu-latest` only, but the codebase has Windows-specific branches
(`daemon-liveness.ts:262`, `browser/pool.ts:89`, `openai-oauth-prompt.ts:166`) and
the website ships `install.ps1` — the operator least able to diagnose a platform bug
is being onboarded. The v0.21 snapshot work added platform-sensitive SQLite paths
(`VACUUM INTO` targets, WAL files) that have never run off-Linux. CI currently proves
none of the cross-platform story, which is the same claim-vs-proof gap the alpha
clean-install contract had.

## Decisions locked in refinement (2026-09-17)

1. **Platform support matrix.** Linux is the fully validated platform, including the
   coding sequence: repository-context safe reads pin ancestry with directory
   descriptors + `/proc` and throw `safe_reads_unavailable` off-Linux *by design*
   (`apps/daemon/src/lib/repository-context/files.ts:69`; stance documented in
   `docs/repository-context.md` — no weaker path-based fallback). macOS/Windows are
   supported for daemon, web UI, chat, schedules, and backups; the coding sequence is
   Linux-only. This is a documented product boundary, not a bug to fix here. Making
   safe reads portable is security-sensitive enough to be its own story →
   [BAZ-057](draft/BAZ-057-portable-safe-reads.md) (draft, not a beta blocker).
2. **The E2E turn needs no LLM, no API key, no docker.** Reuse the deterministic fake
   provider (`scripts/fake-coding-provider.mjs`, OpenAI-compatible, selected via
   `LMSTUDIO_URL`) with `BAZILION_BASH_SANDBOX=off` (sandbox modes are `off`/`docker`).
   On Linux the E2E additionally drives one coding-command turn through the fake
   provider; on macOS/Windows a plain chat turn is the E2E boundary, because coding
   context preparation is Linux-only.
3. **Runners:** docker exists on ubuntu and windows runners, not on macos runners.
   Suites that require a real docker daemon (`verification-container.integration`)
   are gated to docker-capable runners or skip-if-unavailable with a named reason;
   suites that stub docker (`shell-docker.test.ts` fakes the invocation) run
   everywhere. Browser-live suites keep their existing gating; playwright browsers
   are installed via the standard setup step.
4. **Flake stabilization lands first, in this branch.** The matrix triples suite
   executions, so the two known flakes — `backup.test.ts` (SQLITE_BUSY) and
   `git-review-snapshot.test.ts` (seen twice, both green on rerun) — get fixed or
   properly gated *before* the matrix goes wide, or CI becomes a retry button.
5. **The `upgrade-matrix` job stays ubuntu-only** (heavy, platform-neutral by design).
6. **`fail-fast: false`** on the OS matrix so one OS's failure never masks another's.
7. **The E2E installs from a packed tarball** (`npm pack`/`pnpm pack` output), not
   from the public network, keeping CI hermetic. A release-time variant against the
   real npm artifact can follow later if wanted.

## Scope

- `ci.yml`: `strategy.matrix.os: [ubuntu-latest, macos-latest, windows-latest]` on the
  existing `ci` job — typecheck, test, build, daemon boot smoke — with `fail-fast: false`.
  Platform-gate the docker-required and repository-context/coding suites (Linux) with a
  comment naming the reason (Decision 1). Fix the two known flakes first (Decision 4).
- `scripts/installer-e2e.mjs`, modeled on `scripts/migration-upgrade-matrix.mjs`:
  fresh temp `BAZILION_HOME` → installer run against the packed tarball → bootstrap
  with the fake provider → create an Agent → one chat turn → transcript asserted →
  `uninstall --yes` → home gone per two-tier semantics. A separate CI job running on
  all three OSes.
- Whatever the matrix surfaces, fixed or explicitly gated with a reason (expected:
  path separators in snapshot naming, spawn/signal semantics, tsx loader differences,
  line endings).
- Docs: a platform-support statement — README, the website's getting-started install
  section, and a cross-reference from `docs/repository-context.md` — so the
  macOS/Windows boundary is stated where operators actually look.

## Out of scope

- Per-OS release packaging changes (release.yml matrix) — follow-up if the E2E finds gaps.
- Portable safe reads / making the coding sequence work off-Linux → BAZ-057 (draft).
- The mobile app — removed by BAZ-053.

## Flake watch (2026-09-17, during implementation)

Diagnosis before the matrix landed — CI logs from the earlier failures are expired:

- `backup.test.ts` (SQLITE_BUSY): no local reproduction (3× targeted runs plus a
  30-backup probe against a 4 000-transaction hammering writer — the test's own
  5s busy-timeout fix from an earlier flake covers both connections; the daemon
  opens with `timeout: 5_000` in `client.ts:113`). Watch in the matrix.
- `git-review-snapshot.test.ts`: no local reproduction (5× runs). Watch in the matrix.
- `browser-live.test.ts`: reproduced once in three full-suite runs (passes in
  isolation). Likeliest casualty: the 60s per-test timeouts under 8-fork load with
  daemons + chromium (local run: 10.6s). Hardened by raising the four test timeouts
  to 120s; not gated, so the matrix gives it real signal. If it flakes again, gate it
  behind an env flag like `BAZILION_TEST_DOCKER=1`.

## Decision (2026-09-18): claim identity portable, turns Linux-only until BAZ-057

Operator chose option A; implementing it surfaced the deeper layer: the workspace claim
was only the FIRST Linux-only site in the turn path. After it, `prepareAgentTurn`
resolves repository context for the team root on EVERY turn and requires it complete
(`requireCompleteRepositoryContext`) — and those content reads are exactly BAZ-057's
ancestry-pinned scope. Weakening them is what the design refuses, so the honest landing:

- **Kept (option A):** `workspaceIdentity` is portable — same identity semantics
  (sha256 of `dev:ino` of the canonical root), fd-pinned + re-stat-validated on Linux,
  plain stat off-Linux with the ancestry window documented. The off-Linux refusal now
  surfaces the RIGHT error (`Repository instructions incomplete (safe_reads_unavailable)`)
  instead of the claim's internal error.
- **Turns stay Linux-only** (option B at the content layer) until BAZ-057 lands. README
  states it; the E2E on macOS/Windows asserts the refusal is clean, explicit, and leaves
  the daemon healthy; the plain-turn suites stay gated.

Follow-up for the operator: the website ships `install.ps1` — decide whether Windows
install instructions stay up while turns are Linux-only.

Everything else in the story is done: matrix green on all three OSes (test suites),
Windows-specific product fixes (dir-fsync, fsync-on-read-only handle, ownership-record
retry, symlink rejection, fingerprint separators, build filters), installer E2E green on
ubuntu, windows E2E reaches the turn refusal in ~14 min (npm install dominates).

## As-built

- **Matrix:** `ci` + `installer-e2e` jobs on ubuntu/macos/windows (`fail-fast: false`); upgrade-matrix stayed ubuntu-only. All seven checks green at merge (PR #61).
- **Found and fixed in product:** Windows dir-fsync EPERM broke every conversation write; fsync-on-read-only-handle broke bootstrap rotation; Windows followed symlinked session files despite the no-follow boundary (now explicitly rejected); the root build's `'./packages/*'` pnpm filters matched nothing on Windows so `pnpm pack` silently shipped an empty tarball (a Windows release would publish an empty npm package — build filters made path-agnostic); symlinked `BAZILION_HOME` broke uninstall's keep-the-root semantics (detected from the requested spelling).
- **Platform boundary, landed as option A + B:** the workspace-claim identity is portable off-Linux (same dev/ino semantics, fd-pinned + re-stat-validated on Linux only); turns STILL require Linux because every turn resolves repository context and requires it complete — that content-read portability is BAZ-057, fail-closed until then. The off-Linux refusal is a structured 422 naming `safe_reads_unavailable` (was a plain-text 500); the E2E asserts the refusal is clean and leaves the daemon healthy.
- **E2E:** hermetic (no API key/egress/docker): npm install of the packed tarball (playwright browser download skipped), fresh-home bootstrap, provider + curated model via CLI, agent spawn, one-shot chat turn (linux: also a coding-command turn via the BAZ-041 fake provider in a second home), uninstall leaves db/auth.json gone. Windows spawns are shell-less (`cmd /c` mangles even `node -e`); npm keeps its own shim.
- **Known flake watch:** browser-live timed out once under load (timeouts raised to 120s); backup/git-review-snapshot did not reproduce since. One uninstall timeout seen once on macOS.
- **Follow-ups:** website `install.ps1` vs turns-Linux-only (operator decision); qmd memory on Windows (gated with named reason); graceful-shutdown RPC for Windows service managers (signal-based shutdown is TerminateProcess there).

## Tests

1. CI green on all three OSes for the current `main` (first run is the real test).
2. Fresh-machine installer E2E passes on all three OSes; on Linux it includes a
   coding-command turn through the fake provider.
3. A deliberately Windows-broken change (e.g. hardcoded `/` in a new path join) is
   caught by CI, not shipped.
4. The two known flakes no longer appear flaky across repeated runs (or are properly
   gated with a named reason).

## Open questions

*(none — resolved during refinement 2026-09-17; see Decisions)*
