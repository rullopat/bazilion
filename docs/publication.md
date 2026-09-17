# Publication to a code host

A **publication** carries one reviewed revision from a Team workspace to a code host: it commits the
reviewed change to a new branch and opens a pull request. It is the last step of the coding sequence —
repository context ([BAZ-039](repository-context.md)), environment readiness, live command evidence
([coding-evidence.md](coding-evidence.md)), review ([coding-review-packets.md](https://bazilion.com/docs/coding-review-packets/)),
and then this.

Everything below is a property of the implementation, not a convention.

## It is a decision, not a workflow

The operator publishes a **reviewed packet**, and only the operator can:

- There is no publication tool, no publication worker and therefore no publication capability for an Agent
  to be refused. Nothing about publishing is a judgement call — no content to read, no command to choose —
  so the daemon does the work itself, in-process. The security property is stronger than a restricted
  capability: no model is in this path at all.
- `POST /api/teams/:id/publications` is the decision. `bazilion team publish create <slug> --packet <id>`
  is the same decision from the CLI, and the Team review page carries the panel.
- Nothing an Agent does causes a publication: not a conclusion, not a verification result, not an approval.

## What it commits, and what it refuses to commit

A BAZ-042 snapshot stores paths and digests, **never bytes**, so the reviewed revision's content exists only
in the working tree — and only while that tree still matches the capture. Before anything is sent, every
path is read **and verified against the digest the capture recorded**:

- Content that no longer matches is a **refusal**, never a quiet substitution. Publishing current bytes
  because they were probably the reviewed ones is the claim this feature exists to make impossible.
- An incomplete capture is refused: committing it would publish a part of a change.
- A packet that is not reviewed, or has no conclusion, is refused.
- A packet that already has a published revision is refused rather than published twice.

## The rules the daemon enforces

| Rule | How |
| --- | --- |
| The remote comes from configured host + repository | Never from the Team repository's own `origin`; `../escape` and `file://` are not repository names |
| The credential is never an argument or a URL | It travels in the environment as a Git `http.extraheader`, so it cannot appear in a process listing, a `.git/config` or an error message |
| No force push, ever | Plain `git push` (a non-fast-forward is git's business to refuse), and a head branch that already exists on the remote is refused *before* the commit is built |
| Protected branches are never the head branch | `main`, `master`, `trunk`, `develop`, `release`, including `nested/main` |
| Commits are unsigned, and said out loud | `commit.gpgsign=false` explicitly, and the schema refuses to store anything but `signed = 0`. No code path may claim a signature |
| No ambient Git configuration | Private scratch clone, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, no credential helper, no template directory, `GIT_TERMINAL_PROMPT=0` so a missing credential fails instead of hanging |
| The commit is based on the pinned base | The scratch repository is built from the Team's objects, so the branch shares the reviewed change's history rather than replacing it |

## Refusals, failures and the unknown

The states are deliberately not two:

- **`refused`** — nothing was sent: no commit, no push, no pull request. The schema enforces that a refused
  row carries a reason and that no other state does. A refusal is an answer with a reason, not an error.
- **`published`** — the branch is on the host, and the pull request is reported **only if the host said so**.
  A push that succeeded with no pull request back is recorded as a published branch with a note, never as a
  pull request that exists.
- **`failed`** — the attempt ended with a reason and nothing is known to be on the host.
- **`uncertain`** — the attempt was interrupted. A push may already have landed, so this is **never replayed**
  and never recorded as failed. Recovery at startup and on every scheduler tick moves an expired lease here,
  and the operator is told to check the host first.

There is no merge and no deployment. `merged`, `deployed` and `productionAccepted` stay operator-reported
facts on the review packet, exactly as before: this feature has no code-host integration beyond one push and
one pull request, and it never claims otherwise.

## What an Agent learns

The requesting Agent is told the **outcome** — branch, commit, pull request or refusal reason — through the
canonical messenger. It is not told the credential, the remote URL, or the host path a local publication
used: those are the operator's, and a peer message is not the place for them.

## Configuration

The `/config` page, `bazilion config set`, or the API:

| Key | Kind | Meaning |
| --- | --- | --- |
| `PUBLICATION_HOST` | config | `github`, or `local` for a bare repository path (used by tests and by observation) |
| `PUBLICATION_REPOSITORY` | config | `owner/name` for GitHub, an absolute path for `local` |
| `PUBLICATION_BASE_BRANCH` | config | The branch a publication is based on and its pull request targets (default `main`) |
| `GITHUB_TOKEN` | secret | Needs `contents:write` and `pull_requests:write` on that repository. Encrypted in the `secrets` table |

A publication with no configured host, or no stored credential, refuses and sends nothing.
