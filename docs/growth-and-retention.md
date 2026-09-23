# Growth and retention: what grows in a Bazilion home, and what is safe to prune

Added in **v0.21.0-beta.4** (BAZ-052). An operator running Bazilion for months
eventually asks: how big should this home be, and is it normal? This page answers
per artifact — what makes it grow, how to inspect it, and what is safe to delete.
The short version: **the coding-evidence machinery is bounded by design; the
conversation history is not, because it is the product's record.**

## The layout

A home (`~/.bazilion` by default) contains:

| Path | What it is | Grows with |
|------|------------|------------|
| `bazilion.db` | The database: messages, agents, receipts, reviews, coding evidence | Usage (turns, coding commands) |
| `bazilion.pre-migration-*.db` | One verified snapshot per upgrade | Upgrades |
| `agents/<id>/sessions/*.jsonl` | Canonical conversation transcripts | Turns |
| `agents/<id>/uploads/` | User-attached files | Attachments |
| `profiles/`, `skills/`, `teams/` | Your configuration | You |
| `logs/` | *(empty — see below)* | Nothing |

Inspect sizes with `du -sh ~/.bazilion/* ~/.bazilion/agents/*` and, for the
database's table-level breakdown, any SQLite browser:
`sqlite3 ~/.bazilion/bazilion.db` → `SELECT * FROM dbstat ORDER BY pgsz DESC;` or
per-table `SELECT COUNT(*)` on the tables named below.

## The database: bounded evidence, unbounded history

**Bounded by design — the coding-evidence machinery prunes itself:**

- **Coding command logs** (`coding_command_logs`): every coding command's
  observable output is retained for **7 days** (`CODING_LOG_TTL_MS`) and, on top of
  the TTL, the whole table is evicted oldest-first under a **256 MB home-wide
  budget** (`CODING_LOG_HOME_BYTES`). Pruning runs whenever a coding command
  completes; a log belonging to a still-running command is never evicted. Expired
  logs keep their row (id, provenance, state `expired`) but drop the text —
  receipts stay meaningful while the bulk is reclaimed.
- **Source snapshots** (`source_snapshots`): bounded code evidence for review.
  Snapshots are **content-addressed** — capturing an identical tree state again
  collapses onto the existing row rather than extending retention — and expire
  after **7 days** (`SOURCE_SNAPSHOT_TTL_MS`). Manifests hold paths and digests
  only; file content is never stored in the database.

**Unbounded by design — this is your history, not a leak:**

- **Messages** (`messages`): every turn's messages, growing with usage. This is
  the conversation record the product exists to keep. Structural retention and
  cold-archiving are deliberately deferred (BAZ-048, post-1.0); today the honest
  guidance is: the database grows with use, and a full backup (`bazilion backup create`) is the way to snapshot it.
- **Image generation receipts** (`image_generations`, BAZ-059): at most four admissions per turn,
  with bounded identities, request digest, selected model and reported usage — never prompts or
  image bytes. No TTL: replay protection survives restart/restore; original Team deletion removes
  the rows. Generated image bytes use the existing **1 GiB/home Results** budget and deletion
  tombstones, not a second media store. These structural limits are not soak measurements.
- Audit rows (`trigger_dispatches`, `agent_loop_break_events`,
  `communication_approval_events`, …) grow slowly — single rows per event, no
  blob content.

## Sessions JSONL

Each agent's canonical transcript lives at
`agents/<agentId>/sessions/<conversationId>.jsonl` and grows with every turn. The
daemon appends transactionally (staging file + link) but never prunes: the
transcript is the source of truth a session replays from.

- **Safe:** archiving (moving/copying) the `sessions/` directory of an agent you
  have removed.
- **Not safe:** deleting or truncating a session file of a live agent — the next
  turn replays from it.

## Uploads

User-attached files are persisted under `agents/<agentId>/uploads/`, one file per
attachment, referenced by message metadata. They are not daemon-pruned; removing
an agent removes its uploads with it (uninstall offers a full wipe of the home —
see `bazilion uninstall`).

## Pre-migration snapshots

Every upgrade that applies a pending migration first writes a verified,
transactionally consistent copy of the database to
`bazilion.pre-migration-<timestamp>.db` beside `bazilion.db` — one file per
upgrade, never overwritten by a retry. These exist so a failed migration leaves a
restorable copy instead of a half-migrated home (see the upgrading guide in
`docs/upgrades.md`).

**Safe to delete once an upgrade is confirmed good** — the daemon is running and
your data is intact. They are also included in `bazilion backup` archives (the backup
tars the whole home), so a fresh backup supersedes the oldest snapshots.

## Why `logs/` is empty

The daemon **writes no log files**. The `logs/` directory is created at bootstrap
and wiped by uninstall, but nothing in the daemon writes into it — daemon
diagnostics go to stdout, so under systemd (or launchd on macOS) the service
manager's journal holds the log and its rotation is the service manager's job
(`journalctl -u bazilion`, size-capped by your distro's defaults). If `logs/` ever
starts growing, that is a bug, not a configuration problem.

## What is deliberately absent

- **No automatic retention on messages or sessions** — the conversation record is
  the product; structural retention/cold-archiving is post-1.0 work (BAZ-048).
- **No log shipping or telemetry, ever** — by product stance. The only things
  that leave your machine are the LLM API calls you configure.
