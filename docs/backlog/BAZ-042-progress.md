# BAZ-042 implementation progress

Started: 2026-09-14. Status: in progress — slices 1–4 landed. Branch
`feat/baz-041-042-coding-evidence`, continuing from the completed BAZ-041 work. Commits are batched
locally and pushed when the story is further along, not per slice.

Story: [BAZ-042](in_progress/BAZ-042-git-change-review.md).

## Architecture decision: reuse the BAZ-039 Git harness

BAZ-039's [`repository-context/git.ts`](../../apps/daemon/src/lib/repository-context/git.ts) already
performs a hardened, read-only Git read, and BAZ-042 needs the same protections for diffs and
snapshots. There must **not** be a second Git inspection path. That harness:

- copies bounded `.git` metadata into a private scratch directory and writes a **Bazilion-authored
  config**, so no repository `include`/`includeIf`, `filter`, `core.worktree`, `core.attributesFile`,
  `core.excludesFile`, credential helper or `extensions.*` reaches Git;
- refuses unsupported layouts outright — symlinked `.git`, `commondir`/`gitdir` (linked worktrees),
  `sparse-checkout`, `objects/info/alternates`, `sharedindex.*` (split index), unreadable or changed
  sources;
- runs every command with a fixed environment (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_ATTR_NOSYSTEM`, `GIT_TERMINAL_PROMPT=0`, `GIT_NO_LAZY_FETCH`, `GIT_OPTIONAL_LOCKS=0`,
  `PATH=/usr/bin:/bin`, `LC_ALL=C`) plus explicit `-c core.fsmonitor=false`,
  `core.untrackedCache=false`, `core.hooksPath=/dev/null`, `core.excludesFile=/dev/null`,
  `submodule.recurse=false`;
- exposes the worktree read-only through `/proc/<pid>/fd/<root.fd>` (fd-pinned, `O_NOFOLLOW`) rather
  than a path, and re-validates the directory identity afterwards;
- bounds bytes, entries, depth and wall-clock, and treats a changed source as `source_changed`.

So BAZ-042 adds **readers over that harness**, not another harness.

## Slices

1. **Shared capture (done here).** Extracted the scratch/config/env/bounds prologue into
   `apps/daemon/src/lib/git/capture.ts` (`findRepositoryRoot`, `captureRepositoryGit`) and rewrote
   `inspectGit` to use it. No behavior change intended; BAZ-039's tests are the proof.
2. **Repository identity and base resolution (done).** `lib/git-review/refs.ts` and
   `lib/git-review/identity.ts`:
   - `readRepositoryIdentity` distinguishes branch / detached / unborn (an unborn branch reports its
     name with a null head).
   - `resolveComparisonBase` validates a caller-supplied ref, then resolves it to a concrete commit
     with `--end-of-options` so it can never be read as an option. A base is refused (`invalid_base`)
     for anything option-like, whitespace-bearing, `..`/`@{`/`//`, trailing `/` or `.`, `.lock`,
     over-long or empty — and **no Git process starts** in that case. An unknown ref fails
     explicitly (`unknown_base`) rather than falling back to HEAD, which would silently review the
     wrong thing.
   - `PinnedBase` carries `requestedRef` (what the operator asked for) alongside `resolvedOid` (the
     only value a comparison may use), so a moved tip cannot rewrite an existing review.
   Discovered while testing: **one capture freezes the refs it read**, because `.git` metadata is
   copied into private scratch at capture time. A commit made while the capture is open does not
   change what that review sees, and a refresh needs a new capture. That is a stronger guarantee
   than pinning alone, but it means slice 4's snapshot must record the capture instant rather than
   assume it can re-read live refs later.
3. **Change inventory and bounded diffs (done).** `lib/git-review/changes.ts` plus `scope.ts`:
   - `listChanges` merges one `--raw -M -z` read (status letter, modes, rename source) with one
     `--numstat -M -z` read (line counts, binary markers) by destination path, then adds in-scope
     untracked names from `ls-files --others --exclude-standard`. Both diff reads compare the pinned
     commit against the **working tree**, so staged and unstaged edits appear together.
   - Statuses are A/M/D/R/C/T/U (plus `untracked`), with rename source, mode fields, binary markers
     and line counts. Parsing splits numbers on the first two tabs only, so a path containing a tab
     or non-ASCII bytes cannot shift the parse; both are covered by tests.
   - `readChangePatch` returns a bounded per-file diff and marks visible truncation instead of
     throwing. `attachPatches` walks the list under the total cap and marks the rest `total_limit`.
     Binary, excluded and untracked entries never receive content, each with a named reason.
   - `REVIEW_LIMITS` carries the refinement caps (1,000 files / 1 MiB per file / 16 MiB total /
     256 KiB per patch). Exceeding the file cap sets `truncated` and raises `file_limit` rather than
     returning a partial list that looks whole.
   - `scope.ts` decides what may be captured: Bazilion-owned state (the Team-root `memory/` store
     only — never a directory merely *named* `memory`, `dist` or similar) and credential-shaped
     paths (`.env*`, `*.pem`/`*.key`/…, `id_rsa*`, `credentials*`, `.ssh`/`.aws` segments). Tracked
     excluded files are still listed (the change is real) but never read; untracked excluded names
     are withheld entirely and only counted in `withheld`.
   Writing the tests caught a real bug: the first version omitted the base commit from `git diff`,
   which compares working tree to *index* and silently hid every staged change.
   The review types stay daemon-local for now; promote them to hermetic `api-types` in slice 4,
   where the snapshot fields they must carry are decided, to avoid committing the shape twice.
4. **Snapshot manifests and the immutable reference (done).** `lib/git-review/snapshot.ts`:
   - A snapshot covers four layers, because HEAD alone never identifies a dirty tree: the HEAD oid
     (all committed content), a digest over the **index** entries (blob ids are content-addressed,
     so the staged bytes are identified exactly without reading any file), sha256 of every path that
     differs from the pinned base, and sha256 of each **explicitly selected** untracked file. Nothing
     is included implicitly.
   - `id` is content-addressed over that state and deliberately excludes `capturedAt`, so an
     identical tree yields an identical id. `complete` *is* part of it, so an incomplete manifest can
     never collide with a complete one. Modification times are never consulted: a test reverts bytes
     and asserts the identity returns even though mtime moved on.
   - `snapshotReference()` is the small handoff BAZ-041 receipts and BAZ-043 carry, and
     `compareSnapshots()` is the applicability primitive: `identical` / `changed` / `unknown`, with
     `unknown` whenever either side is incomplete. An incomplete snapshot is never reported as
     unchanged.
   - Content problems never throw. Oversized files, non-regular paths (symlinks and special files,
     refused rather than followed), a changed file that moved under the reader, an oversized index
     and a missing included path each mark the snapshot incomplete and are recorded per entry, with
     `withheld` counts and named issue codes — an omission is never visible only in prose.
   - A coherence re-check re-reads the index after all content work, so another writer touching the
     repository mid-capture is detected. Stated limit: that detects a moved index, not a transient
     edit reverted before the check, and the doc comment says so rather than implying proof.
   - Scope refusals are recorded in `exclusions` (path + reason), so credential-shaped and
     Bazilion-owned paths are visibly withheld rather than silently absent.
4b. **Persist snapshots (store landed).** `source_snapshots` in the canonical schema (clean-install
   only, no ALTER), `core/repos/source-snapshots.ts`, and the backup contract:
   - Seven-day retention. The id is content-addressed, so an identical capture collides on the same
     row and writes nothing — the first capture's provenance and its original `expires_at` survive,
     because re-capturing the same state must not extend a retention window.
   - Team-scoped rows with `ON DELETE CASCADE`, so a reference is meaningless outside the Team that
     captured it. Expired rows read as **absent**, the same answer as never-captured, because both
     mean applicability cannot be established. No tombstone: unlike retained bytes, a manifest has
     nothing to disclose after its window.
   - `manifest_json` is bounded to 2 MiB by CHECK, and the row carries only paths and digests — never
     file content. An over-bound manifest is refused rather than truncated.
   - Provenance is explicit: `captured_by` is `agent` or `operator`, with agent/turn/tool-call ids
     nullable and a CHECK tying them to an agent capture. An operator capture has no turn, and says
     so rather than being faked with sentinel ids (this refined the table after its first cut, while
     everything is still unreleased and clean-install only).
   - Backup: the three new objects are listed in `CANONICAL_OBJECTS` and the canonical fingerprint
     was recomputed (`2d8a15dc…` → `8454a37b…`). Restore keeps snapshots at their **original**
     expiry and drops the ones already past it, so a restored copy never serves evidence whose
     window closed.
4c. **Turn-bound Agent capture and receipt linkage (done).**
   - New IPC action `snapshot` and a `source_snapshot` tool: the Agent calls it once before editing
     and quotes the reference in its summary. It returns a deliberately **compact** result — the
     reference, the entry count, what was included and what was excluded, plus issues — because a
     model needs an honest count, not the whole entry list. Untracked content stays opt-in per path,
     the list is bounded before anything is read, and the per-turn operation limit applies.
   - `CodingCommandReceipt` gains `sourceBefore` and `sourceAfter`. `sourceBefore` is the first
     snapshot this turn captured, so it is absent when the Agent never captured one — never invented.
     `sourceAfter` is captured at the command's **own execution boundary** when the receipt settles.
   - Capturing evidence can never fail a command: a failed capture leaves the reference null, so an
     absent reference reads as **unknown applicability** rather than as "unchanged". Tested against a
     non-repository Team, where the command still settles successfully.
   - History masking: `source_snapshot` results join the masked coding-evidence list in
     `runtime/pi/events.ts` and the web chat lists. Without that, a replay would render the result
     JSON — including the paths scope policy deliberately **withheld** — which would undo the
     withholding. The egress regression test now covers the tool name too.
5. **Surfaces.**
   - **Types promoted (done).** `packages/api-types/src/git-review.ts` now owns the review and
     snapshot wire shapes (identity, pinned base, change entries, limits and `REVIEW_LIMITS`,
     snapshot entries, `SourceSnapshot`, `SnapshotReference`, comparison, scope reason and the
     request/response envelopes). The daemon modules re-export what they previously declared, so
     callers keep one import path and this stayed a pure move.
   - **Daemon, routes, client and CLI done.** `lib/git-review/service.ts` resolves a Team, opens its
     workspace through an fd-pinned directory, captures Git and runs the review; `teamsRouter` adds
     `GET /:id/review[?base=&patches=1]`, `GET|POST /:id/review/snapshots` and
     `GET /:id/review/snapshots/:snapshotId`; `@bazilion/client` gains `repositoryReview(teamId)`;
     the CLI gains `team review <slug> [--base --patch --json]`, `team review capture|snapshots|snapshot`.
     Patches stay opt-in so a caller that wants the file list does not pay for content. Errors map to
     machine codes: `invalid_base`/`unknown_base` → 400, `not_repository`/`unsupported_layout` → 409,
     `team_not_found` → 404. Untracked selection is validated and bounded before anything is read.
5b. **Web review panel (done).** `/teams/:id/review` (a `Review` tab beside the other Team
   sections), backed by server functions in `apps/web/src/lib/git-review.ts` that follow the
   `lib/auth.ts` precedent so the client bundle never ships the daemon URL or cookie machinery:
   - Shows the pinned baseline (`branch · base HEAD (oid)`), the change list with status, counts,
     rename arrows and binary/withheld reasons, a bounded diff for one selected file, and the
     retained snapshots with an operator capture button.
   - Truthful states rather than empty ones: a non-repository or unsupported layout renders an
     explicit banner with its code, an incomplete snapshot is labelled *inapplicable* rather than
     exact, and a withheld path says what was withheld instead of showing a bare zero. Wording lives
     in `git-review-presentation.ts` as pure functions so it is unit-tested.
   - Keyboard and narrow-screen: every row is a real button (Tab/Enter), the diff is a scrollable
     `pre`, and controls stack at small widths.
   - Single-file diffs: `GET /review?patches=1&path=<p>` reads only the requested patch, so opening
     one file does not pull every patch; an empty or over-long `path` is refused.
   - Still to do: the file/hunk feedback flow with stale-hunk refresh and BAZ-036 queueing (slice 6).
6. **Feedback.** File/hunk selection carrying repository + snapshot + path + original line context,
   stale-hunk refresh, reuse of BAZ-036 for busy-turn queueing.

## Constraints to honor as this lands

- Read-only always: no staging, reverting, committing, pushing or branch mutation.
- The review panel cannot release BAZ-034 approval-held results, and grants Agents no new file access.
- Untracked **content** is never bundled automatically; never auto-capture Team memory, Bazilion
  private state, ignored files or credential-shaped names.
- A successful command never establishes whole-project correctness, and before/after equality never
  proves "no transient edits" — applicability must say so rather than imply proof.
- Unsupported layouts fail with guidance instead of broadening mounts or executing repository helpers.

## Validation

- Slice 1 regression gate: BAZ-039's Git coverage. `apps/daemon/test/core/repository-context.test.ts`,
  `apps/daemon/test/runtime/repository-context.test.ts` and `apps/cli/test/repository-context.test.ts`
  exercise dirty/staged/untracked/detached states, config and helper suppression, linked metadata
  refusal and unstable captures.
- Slice 1 additions: `apps/daemon/test/core/git-capture.test.ts` covers a second read-only invocation
  through the shared capture (diff/rev-parse/status), helper non-execution during a diff, an
  unchanged index/worktree fingerprint, a non-repository root and a refused `commondir` layout.
- Slice 2 additions: `apps/daemon/test/core/git-review-identity.test.ts` covers branch/detached/
  unborn identity, tag and raw-oid bases, a blob refused as a base, a tip that moves between two
  captures, the single-capture freeze, and twelve unsafe ref shapes that must be refused before Git
  runs (asserted with a recording wrapper, not inferred).
- Slice 3 additions: `apps/daemon/test/core/git-review-changes.test.ts` covers every change kind
  with counts, rename source, ignored files staying unlisted, bounded/truncated patches, binary and
  untracked entries never receiving content, tab and unicode paths surviving the NUL parse, the file
  limit reporting an incomplete list, and ten scope decisions including `src/memory/` staying
  included while Team-root `memory/` does not.
- Slice 4 additions: `apps/daemon/test/core/git-review-snapshot.test.ts` covers a clean tree,
  stable ids for identical state, ids changing on edit and returning on revert (mtimes ignored),
  staged state moving the index digest, untracked content included only on selection, a refused
  credential-shaped path recorded as an exclusion, a missing included path reporting incompleteness,
  an oversized file refused instead of truncated into a misleading digest, a symlinked path refused,
  a deleted path recorded as deleted, the file bound, and the emitted reference.
- Slice 4b additions: `apps/daemon/test/core/source-snapshots.test.ts` covers the round trip with
  provenance and window, a re-capture keeping the first provenance without extending retention,
  expiry reading as absent (and pruning), an out-of-Team reference being meaningless, an incomplete
  snapshot never widening what is treated as exact, an over-bound manifest refused, and newest-first
  Team-scoped listing. The backup recovery suite covers the restore clause.
- Slice 5 additions: `apps/daemon/test/routes/git-review.test.ts` covers the change list against a
  pinned baseline, opt-in patches, refused bases (option injection and unknown refs) with their
  codes, a non-repository Team returning 409 rather than an empty review, an unknown Team 404, an
  operator capture returning a reference plus its listing and single read, an unknown snapshot id
  404, a reference being meaningless in another Team, and five refused capture payloads.
- Slice 4c additions: five cases in `apps/daemon/test/lib/agent-coding.test.ts` cover the capture
  tool returning a compact result with agent provenance persisted and readable, the receipt recording
  `sourceBefore`/`sourceAfter` with the after-state resolved from the store, untracked opt-in with a
  refused credential-shaped path recorded rather than read, a non-repository capture neither failing
  the command nor claiming completeness, and repeated/malformed/over-long capture calls being
  rejected.
- Slice 5b additions: two route cases (a single-file diff not paying for the rest, and a refused
  `path` parameter) and five web cases for the panel's wording — counts never rendered as a bare
  zero, withheld and unselected files saying so, branch/detached/unborn labels, an unavailable review
  reading as not reviewable rather than empty, and an incomplete snapshot never labelled exact.
- Whole-tree after slice 5b: typecheck (root and web), format and lint clean; full suite 1633 passed
  / 7 skipped (208 files); security acceptance 74 cases passed (slice 4c measured 1626 / 207 files).
