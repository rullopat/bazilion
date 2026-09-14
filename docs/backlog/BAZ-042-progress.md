# BAZ-042 implementation progress

Started: 2026-09-14. Status: in progress — slices 1–3 landed. Branch
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
4. **Snapshot manifests.** Bounded before/after manifests (HEAD, index, dirty tracked bytes,
   explicitly included untracked content) with recorded exclusions and limits, plus the immutable
   snapshot reference shared with BAZ-041/BAZ-043 for applicability.
5. **Surfaces.** Team-scoped HTTP routes, `@bazilion/client`, CLI list/show/diff parity, then the web
   review panel beside chat (over the wire types promoted in slice 3).
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
- Whole-tree after slice 3: typecheck, format and lint clean; full suite 1590 passed / 7 skipped
  (204 files); security acceptance 74 cases passed (slices 1–2 measured 1556 / 1574).
