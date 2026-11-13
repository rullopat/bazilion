---
id: BAZ-003
title: Reviewed learning
status: done
created: 2026-05-23
shipped: 2026-08-03
release: v0.12.0
---

# BAZ-003 — Reviewed learning

## Outcome

A long-lived Agent can turn its recent conversations into lessons, but only the lessons you
approve change its behaviour. Learning is off by default, runs in the background at a cadence you
choose, and every lesson can be edited, rejected or revoked later.

## Scope

- Per Agent: on/off, every N completed turns (default 8, 1–100), an optional review model and a
  reasoning level (default `low`). Only turns you started (web, CLI, Telegram) count.
- When due, the scheduler runs a review in a restricted worker: a minimal environment, a redacted
  digest of the turns since the last review (about 42,000 characters at most) and one tool,
  `propose_lesson`. A review proposes at most five lessons.
- A lesson is `private` (added to the Agent's system prompt, up to 8,000 characters in total) or
  `shared` (written to the Team's memory as `lessons/<id>.md`).
- Proposals wait for you: approve, edit, reject, or later revoke an approved one.
- A review runs once; a failed one shows in Attention as `review_failure` until the next scheduled review;
  waiting proposals show as `lesson_proposal`.

## As built

- CLI: `bazilion agent review-config <id> [--enable|--disable] [--every N] [--model …]
  [--reasoning …]`, `agent review <id>` (run one now), `agent reviews <id>`, `agent lessons <id>
  [--status …]`, `agent lesson edit|approve|reject|revoke <proposal-id>`.
- Web: the Agent's **Learning** tab.
- HTTP: `GET|PATCH /api/agents/:id/review-config`, `GET|POST /api/agents/:id/reviews`,
  `GET /api/agents/:id/lesson-proposals`, `PATCH /api/agents/:id/lesson-proposals/:proposalId`.
- Tables: `agent_reviews`, `agent_lesson_proposals`; `review_*` columns on `agents`.
- Code: the daemon's review dispatcher (`apps/daemon/src/lib/review-dispatcher.ts`) and the
  `propose_lesson` tool.

## Known limits

- Reviews cost model calls; set a cheap review model for busy Agents.
- The reviewer sees a digest, not the whole history; lessons are only as good as that window.
- Skills are not edited or created by learning.
