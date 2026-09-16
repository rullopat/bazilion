# Coding evidence: progress, retained diagnostics and change review

Shipped in **v0.17.0**. Two stories landed together because they share one evidence model: BAZ-041
makes a command's execution observable and keeps its diagnostics, and BAZ-042 attaches source identity
to what was produced. Everything here is owned by the daemon; clients only ever talk to it over HTTP.

## Live progress

A running coding command streams a **cumulative** output tail — each update replaces the previous one
for that tool call, so a reconnect or a slow client can never see duplicated output. Updates are
bounded and throttled, and they never release anything.

## Retained diagnostics

Diagnostics are retained for **seven days** (2 MiB per command, 256 MiB per home, oldest-first
eviction) so a failing command can still be investigated after its container is gone. Retention states
are explicit and truthful: `available`, `truncated`, `expired`, `deleted`, `unavailable`. Truncation is
a stored fact, not a guess inferred from byte counts, because redaction can shorten or lengthen output.

**Disclosure is a separate decision from retention.** Captured bytes stay private until something
source-owned releases them: the operator's own terminal result, an authorized peer read, or an approved
communication. A held log reads as *not shared* — never as an empty result. Reading a released log is
bounded (64 KiB pages) and searchable:

```sh
bazilion team log <team> <commandId> [--offset N --limit N] [--search <query>]
```

## Change review

`bazilion team review` inspects a Team's registered repository read-only:

```sh
bazilion team review show <team> [--base <ref>] [--patch <path>] [--json]
bazilion team review capture <team> [--base <ref>] [--include <path>]... 
bazilion team review snapshots <team>
bazilion team review snapshot <team> <snapshotId>
```

The same data is on the authenticated API (`GET /api/teams/:id/review[?base=&patches=1&path=]`,
`…/review/snapshots`) and on the Team **Review** page beside the other Team sections.

- **Baselines are pinned.** A branch name is resolved to a concrete commit when the review loads, so a
  moving tip cannot silently rewrite what you are looking at.
- **Diffs are bounded** and say when they were cut. Patches are opt-in, and a single file can be
  requested without paying for the rest.
- **Untracked content is opt-in per path.** Names are listed; content is read only when named. Ignored
  files are never listed, and credential-shaped or Bazilion-owned paths are refused and *counted* rather
  than silently dropped.
- **A Team that is not a repository says so** — never an empty change list, which would read as "nothing
  changed".

## Source snapshots and applicability

A snapshot is bounded **code evidence**: HEAD, the index, sha256 of every path differing from the pinned
baseline, and sha256 of each explicitly selected untracked file. It stores paths and digests — **never
file content**. Its id is content-addressed over that state, so identical trees share an id, and an
incomplete capture can never collide with a complete one. Modification times are never used.

A command receipt records the source state at its own execution boundary (`sourceAfter`) and, when the
Agent captured one, the starting state (`sourceBefore`). The chat card reports whether that version
still applies, in three states and never as a pass:

| state | meaning |
| --- | --- |
| unchanged | the source is byte-identical to the tested version |
| changed | the source moved — relevance to what was tested is unknowable, so no claim is made |
| unknown | no snapshot, an incomplete one, or it expired |
| *(none)* | the receipt captured no source, shown as **Not checked** |

Feedback about a file carries the snapshot it was written against, so later edits make it **stale**
rather than silently re-pointing at different lines. Feedback is sent through the ordinary follow-up
queue — there is no second path.

## Requesting verification from a specialist (v0.18.0)

A coder — or the operator — can hand one captured change to an existing same-Team specialist:

```sh
bazilion team review capture my-team
bazilion team verify create my-team --agent tester --snapshot <id> \
  --check 'pnpm test :: unit suite :: . :: 120'
bazilion team verify show my-team <requestId>
```

The request binds a BAZ-042 snapshot, at most eight exact commands and the frozen admitted environment into
one immutable contract, and names one recipient. Requesting verification **runs nothing**: the daemon's
verification state machine claims it, revalidates membership, the evidence window and directed policy,
reserves the workspace exclusively, proves the reserved tree still matches the capture, and only then admits
the specialist.

**The specialist's capability is two tools.** `verification_request` reads the contract;
`verification_check` runs one declared ordinal, once. There is no command, cwd, timeout or environment
argument anywhere in the capability, so nothing can be widened, substituted or retried. The daemon
additionally re-checks the worker's request and attempt identity against its own binding, and a verification
turn is refused the coding, container, repository-context, result, messaging, USER.md, browser and MCP
surfaces rather than being trusted not to use them.

**Refusals, not substitutions.** Drift between the capture and execution is blocked with a fresh capture
named as the remedy; a request captured against a container is refused when shell isolation is off; a check
needing an approval an unattended turn cannot obtain is blocked rather than auto-approved; a command carrying
protected credential material is refused outright. A refused capture returns a reason, and nothing is written.

**Evidence says what it is.** Each executed check records a BAZ-041 receipt naming the snapshot it was
verified against, and checks run through the same shell posture and redaction as a coding turn — never with
the daemon's ambient environment. A non-zero exit is a *result* about the commands that ran, reported per
check; settling reports evidence availability rather than a verdict, so a failing test and a verification
that could not run stay distinct. An interrupted attempt is `uncertain` and is never replayed, and an
executed check whose receipt was pruned reports `receiptUnavailable` rather than silence.

**The result returns to the requester** through the canonical messenger, carrying `coding-receipt:`
references — exactly what grants that peer read access to those receipts and nothing more. Team Policy
applies to that message like any other peer message.

**Declared output paths are advisory.** They are validated as Team-relative and inside the workspace, and
recorded on the receipt as not confining writes: real confinement needs the container mount strategy.

**Deliberately not implemented:** cross-Team verification, managed test databases/services/browser
environments, framework parsers, automatic retries, source changes to fix failures, and any automatic
commit, push, PR or deployment. A verification result is never an approval to publish.

## Reviewing a captured change (v0.19.0)

A packet binds one captured revision, and either side of the review is an operator or an agent:

```sh
bazilion team review packet create my-team --snapshot <id> --reviewer tester --summary "the crash fix"
bazilion team review packet list my-team
bazilion team review packet show my-team <packetId>
bazilion team review packet finding my-team <packetId> --path app.ts --severity major --note "no test" --lines 12-20
bazilion team review packet conclude my-team <packetId> --conclusion changes_requested
bazilion team review packet export my-team <packetId>
```

A coder can ask for the same thing from inside its own turn with `request_review`, naming a teammate by name
or id. **Requesting a review runs nothing**: the daemon captures the revision, and the reviewer's capability
is four read-only tools — read the packet, read a changed path's patch, record a finding, record a
conclusion. There is no shell, no editor, no browser, no network and no publication verb, and the reviewer
is refused every one of them at the daemon boundary rather than by instruction.

Two limits are worth knowing before trusting a result:

- **Content is only the reviewed revision's while the tree still matches the capture.** A snapshot stores
  paths and digests, never bytes, so once the tree moves there is no patch to show for the old revision — the
  reviewer is told that and must not describe lines it could not read. A finding recorded at that point is
  `unverified` and cannot be resolved.
- **A conclusion is a reviewer's statement**, not a pass, not acceptance and not permission to publish.
  Committed / pushed / pull request / merged / deployed / production accepted are whatever you report them to
  be: Bazilion has no code-host integration, so those states are labelled reported rather than verified.

## Read-only guarantees and limits

Inspection never stages, commits, checks out or reverts anything, and it never executes
repository-configured behaviour: `diff.external`, `core.fsmonitor`, textconv and filters cannot run,
metadata is read from a private copy with a Bazilion-authored config, and the work tree is reached
through a pinned directory descriptor rather than a path. Unsupported layouts (linked worktrees, split
indexes, object alternates, sparse checkouts) are refused with guidance rather than worked around.

Stated limits, so nothing here reads as more than it is:

- A snapshot fingerprints the bytes it read. A change landing between listing and reading is not
  detected; a file that changes *while* being read is reported `unstable`.
- A snapshot enumerates what git reports as changed. Git decides dirtiness from recorded stat data
  (size, mtime, ctime) plus its racy-git rules, so an edit that keeps a file the same byte length and
  lands in the same filesystem timestamp tick as git's recorded stat can be reported clean, and the
  capture honestly lists no changed path. Applicability compares two captures, so such an edit can
  still compare `identical`. Bazilion does not re-hash the whole tree to second-guess the repository's
  own view: evidence that disagrees with git would be worse, not better. This is why the review test
  fixtures change file length when they simulate a modification.
- Comparing source states shows that code changed, never that the change was relevant to a given result.
- A successful command never establishes whole-project correctness, and an exit code is never coverage.
