# BAZ-042 Git change review acceptance record

Audit date: 2026-09-14. Scope: local acceptance evidence for
[BAZ-042](in_progress/BAZ-042-git-change-review.md) against
[the progress record](BAZ-042-progress.md). No release, merge, push or deployment is included.

The run used a **disposable home** (`/tmp/baz042-home`) and a **disposable repository**
(`/tmp/baz042-repo`) registered to the Team with `--link`, so the realistic case — a Team pointing at
an existing tree with prior uncommitted work — is what was exercised. No personal runtime state was
involved.

## Fixture

One repository carrying every case the story names, committed base `70f3dcc6`:

| condition | fixture |
| --- | --- |
| dirty start retained as prior work | `README.md` staged modification, `src/app.txt` unstaged modification |
| rename | `docs/old-name.txt` → `docs/new-name.txt` |
| delete | `src/gone.txt` |
| binary | `src/blob.bin` (added) |
| large | `src/large.txt` (80 KB, untracked) |
| untracked | `notes.txt` |
| credential-shaped | `.env` |
| hostile names | `weird name; rm -rf.txt`, `naïve café.txt` |
| symlink | `src/link.txt` → `/etc/hostname` |
| repo-configured executables | `diff.external`, `core.fsmonitor`, `diff.evil.textconv` → a marker-touching script |

## Acceptance criteria

| Criterion | Observed evidence | Result |
| --- | --- | --- |
| 1. A dirty repository keeps its prior changes in the baseline, and base/prior/since are distinguishable | The Team was linked to a repository that was already dirty. The review showed `base HEAD (70f3dcc6…)` alongside the pre-existing staged *and* unstaged edits, so prior work appears as "since baseline" rather than being attributed to anything Bazilion did. | Observed |
| 2. Tracked, included untracked, renamed, deleted, binary and large files are truthful; an incomplete capture never claims to be exact | All ten changes listed with correct statuses: rename shown as `docs/old-name.txt -> docs/new-name.txt`, delete as `0+ 1-`, binary as `binary` with **no** line counts, untracked listed by name only (`untracked_not_selected`). `.env` was withheld and *counted* ("0 excluded and 1 untracked path(s) withheld"). A symlink made the snapshot `complete: false` with `unstable: … could not be fingerprinted`, i.e. no exact claim. | Observed |
| 3. Feedback references the reviewed snapshot; later edits cannot silently retarget it | Feedback composed against snapshot `8e920ce5…` reported `current` / `path_unchanged`. After editing `src/app.txt`, the same request reported `stale` / `path_changed` and the message body read `Source identity: CHANGED since this snapshot — the selected lines may have moved`. The message carries `review-feedback:<snapshotId>:<path>`. | Observed |
| 4. Receipts are linked to the tested snapshot and go stale when applicable code changes | A real turn (committed fake provider) produced a `coding_command` receipt with `sourceAfter` **complete**, and `sourceBefore` absent because the Agent captured none — absent rather than invented. The receipt's snapshot resolved through the review route, reported `identical` immediately after the run, and `changed` after editing `src/app.txt`. An `incomplete` snapshot returned `unknown`, never a verdict. The **coding card now surfaces this**: it names the tested version, offers "Check applicability", and reads **Not checked** when no source was captured (rendering covered by tests; not browser-observed). | Observed |
| 5. Inspection cannot execute helpers, mutate the repository, or escape the boundary | After review, single-file patch, capture and snapshot listing: the helper's marker file **did not exist**, and the repository was byte-identical (worktree status hash and `.git/index` hash unchanged). Base injection (`--upload-pack=…`) and unknown refs were refused with machine codes; a credential-shaped path was excluded rather than read; a symlink was refused rather than followed. | Observed |
| 6. API/CLI and the web view agree on revisions, scope, limits and unavailable states | `team review show repo --json` and `GET /api/teams/repo/review` produced **identical** change lists (10 entries), and the same base, identity and withheld counts. A non-repository Team returns 409 `not_repository` rather than an empty list. | Observed, after the CLI fix below |

## Findings (all fixed here unless noted)

1. **`team review <slug>` did not work.** citty resolves the first positional as a subcommand, so the
   bare form I shipped in slice 5 failed with `Unknown command`. Restructured to the repository's own
   convention (`team policy`): `team review show <slug>` plus `capture|snapshots|snapshot`.
2. **citty string flags are last-wins, so "repeatable" was a lie.** `--include a --include b` yielded
   `"b"`. My `team review capture --include` silently dropped every path but the last, which the API
   route did not. The shipped `agent chat --image` / `--file` flags had the same defect — both made
   the `string | string[]` assumption (`asPaths(args.image as string | string[])`) and quietly
   reduced several attachments to one. Both are fixed by reading the raw argument list
   (`apps/cli/src/repeatable-args.ts`) instead of relying on citty, and deliberately **not** by
   comma-splitting, which would corrupt a path that legitimately contains a comma — verified with
   `odd, name.txt`. Verified live: two `--image` flags put **two** image blocks in the session, and
   repeated `--include` flags included `notes.txt` while excluding `.env`.
3. **Measuring "no helper ran" needs the measurement to be hardened too.** My first check ran a plain
   `git -C … status`, which honours the repository's `core.fsmonitor` — so *my own* command executed
   the helper, and fsmonitor also **rewrote `.git/index`**, changing its hash. Re-running with
   `GIT_CONFIG_GLOBAL=/dev/null` and `-c core.fsmonitor=false` showed Bazilion's inspection runs no
   helper and leaves the index untouched. Worth remembering for any future "prove nothing ran" check.

## Reproducible procedure

```sh
# disposable repository with the fixture above, then:
BAZILION_HOME=/tmp/baz042-home PORT=4398 BAZILION_BASH_SANDBOX=off \
  LMSTUDIO_URL=http://127.0.0.1:18099/v1 pnpm tsx apps/cli/src/index.ts serve &
export BAZILION_HOME=/tmp/baz042-home BAZILION_SERVER=http://127.0.0.1:4398
pnpm tsx apps/cli/src/index.ts provider enable lmstudio      # first-run gate
pnpm tsx apps/cli/src/index.ts provider models-set lmstudio baz042-stub
pnpm tsx apps/cli/src/index.ts team add repo --link /tmp/baz042-repo
pnpm tsx apps/cli/src/index.ts team review show repo
pnpm tsx apps/cli/src/index.ts team review capture repo --include notes.txt --include .env
node scripts/fake-coding-provider.mjs 18099 &                 # for criterion 4
```

Release-gate cases: nine BAZ-042 entries in `security/acceptance-manifest.json`
(`GIT-REVIEW-NO-REPO-TRUTHFUL`, `-BASE-INJECTION`, `-CROSS-TEAM`, `-STALE-FEEDBACK`, `-NO-MUTATION`,
`-HELPER-SUPPRESSION`, `-LAYOUT-REFUSAL`, `-SYMLINK-BOUNDARY`, `-SCOPE-WITHHOLD`); the gate total is
74 → 83.

## Caveats

1. **No browser observation.** Keyboard row selection, the narrow-screen stacking and the panel's
   reading order were not looked at. There is no scripted browser check for this panel, unlike
   BAZ-041's acceptance; the repository pattern to extend is
   `scripts/check-repository-context-ui.mjs`.
2. **The coding card's applicability is test-covered, not browser-observed.** The card renders the
   tested version, the verdict and **Not checked**; it was exercised through static markup in tests
   rather than looked at in a browser.
3. **Concurrent capture/write is stated, not checked.** An earlier "index coherence re-check" turned
   out to be dead code (both reads came from the frozen scratch copy) and was removed. The capture's
   refs and index are stable **by construction**; worktree content is read live and a file changing
   under the reader is reported `unstable`. A change landing between listing and reading is not
   detected, and the record says so instead of implying otherwise.
4. **Criterion 4 used the fake provider.** A real model was not run for this story (BAZ-041's
   acceptance did run one), so "a real model edits code, then the receipt goes stale" is untried.
5. **Large-file truncation was not exercised live.** The 80 KB file appeared as untracked-not-selected;
   a patch exceeding the patch cap was covered in unit tests, not by this run.
