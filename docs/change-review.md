# Change review and live tool output

## Live tool output

While a tool runs, its output streams into the chat. The web chat shows a live tail under the
running step, and `bazilion agent chat --message` prints each new output line as it arrives. Any
tool that reports progress takes part; in practice that is `bash`, including the Docker-backed
`bash` when `BAZILION_BASH_SANDBOX=docker`. The tool's result replaces the live tail when it
finishes.

Known credential values (stored secrets and the turn's provider credentials) are redacted from tool
output before it reaches a client, both live and in reloaded history.

## Change review

**Changes** in the web workspace and `bazilion team review` show what changed in a Team's Git
repository since a base: `HEAD` by default, or any branch, tag, commit id or revision such as
`HEAD~1`. When a turn wrote files, **Review changes** under it opens the first of them. A Team
whose folder is not a Git repository has no **Changes** tab or tile: there is nothing to compare
against.

```sh
bazilion team review show <team> [--base <rev>] [--patch <path>] [--json]
bazilion team review feedback <team> --path <path> --agent <agent> [--line <n>] [--note <text>] [--base <rev>]
```

- The list names each changed file, how many lines it gained and lost, and the Agent whose turn
  last wrote it with `write` or `edit`. A file changed by a shell command has no author.
- Select a file (or pass `--patch`) to see its diff: in the side panel in one column, in the
  full-width view with the old and the new file side by side. A new, untracked file shows as an
  added file. Diffs are read only when asked for and are bounded.
- Click a line number to comment on that line, or **Comment on the file**. Comments gather into
  one review; **Send review** sends them to one Team member as one message, each with its file,
  its change, the diff around it and your note. The recipient offered first is the Agent that
  wrote the commented files. The message goes through the ordinary follow-up queue, so it runs as
  that Agent's next turn. From the CLI, `feedback` sends one comment.
- A review that is not sent yet lives in the page: reloading it, or leaving the workspace for
  another page, drops it.
- The Team's own `memory/` store and credential-shaped paths (`.env`, `*.pem`, `credentials.*`,
  `.ssh/`, …) never show content; untracked ones are only counted.
- A Team whose workspace is not a Git repository says so instead of showing an empty list (the
  review answers `200` with `unavailable`, not an error).

The API behind both is `GET /api/teams/:id/review[?base=&patches=1&path=&authors=1]` and
`POST /api/teams/:id/review/feedback` with
`{ agentId, comments: [{ path, line?, note? }], note?, base? }`: 1 to 20 comments, `line` being a
line of the file as it is now, and `note` (2,000 characters at most) about the review as a whole.

## How Git is read

Inspection never modifies the repository and never runs repository-configured helpers. It copies
the Git metadata into a scratch directory with a Bazilion-written config: hooks, external diff,
textconv and fsmonitor are not used, and only a short list of harmless settings and the
repository's local exclude file are carried over. The original index is not refreshed or written.
Git never searches for a repository above the Team directory.

Refused rather than followed: a config that uses includes, filters or `core.worktree`, alternates,
links that leave the Team (a Team registered with `--link` is fine), special files, linked worktree
and submodule metadata, and sparse or split-index layouts. One inspection has 5 seconds, each Git
command 1 MiB of output, and the metadata copy at most 64 MiB in 16,384 entries.
