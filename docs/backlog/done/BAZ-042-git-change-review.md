---
id: BAZ-042
title: Change review
status: done
created: 2026-09-07
shipped: 2026-09-16
release: v0.17.0
---

# BAZ-042 — Change review

## Outcome

After asking an Agent for a code change, you review the actual files and diffs beside the
conversation, and send feedback about a specific file straight back to an Agent.

## Scope

- List what changed in the Team's Git repository since a base (`HEAD` by default, or a branch,
  tag, commit or revision such as `HEAD~1`), with untracked files shown as added.
- Show one file's bounded diff on request.
- Feedback about a file goes to a Team member as an ordinary queued message with the path, the
  change, a diff excerpt and your note; it runs as that Agent's next turn.
- Inspection is read-only: Git runs on a scratch copy of the metadata with a Bazilion-written
  config, so no hook, filter, external diff or fsmonitor runs and the index is never written.
  Unsupported layouts (alternates, linked worktrees, submodule or sparse metadata, includes,
  filters) are refused.
- The Team's `memory/` store and credential-shaped paths never show content.

## As built

- CLI: `bazilion team review show <team> [--base <rev>] [--patch <path>] [--json]`,
  `team review feedback <team> --path <path> --agent <agent> [--note …] [--base …]`.
- Web: the Team's **Review** tab.
- HTTP: `GET /api/teams/:id/review[?base=&patches=1&path=]`, `POST /api/teams/:id/review/feedback`.
- Code: `apps/daemon/src/lib/git/capture.ts` (the one Git reader) and `lib/git-review/`.
- Guide: [change review](../../change-review.md).

## Not built

- Source snapshots, review packets, specialist verification and publishing to a code host
  (removed). Feedback is file-level; there are no line comments.
- Limits: 5 seconds per inspection, 1 MiB of output per Git command.
