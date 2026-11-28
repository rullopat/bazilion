---
id: BAZ-103
title: "Reviewed learning removed"
status: done
created: 2026-11-28
shipped: 2026-11-28
release: v0.66.0
---

# BAZ-103 — Reviewed learning removed

## Outcome

Reviewed learning (from 0.12.0) was off unless switched on per Agent, and when on it saw little:
only the selected conversation, your messages and the Agent's replies, and each tool call as its
name with "completed", never what it did or how it failed. The owner asked on 2026-11-28 for it to
go in 0.66.0, and for a replacement later: skills Agents write for themselves (BAZ-104).
Agents keep learning as they always could, in the Team's memory, USER.md and their
own identity.

## As built

- Gone: the **Learning** row and sheet, `bazilion agent review-config|review|reviews|lessons|
  lesson`, the `/api/agents/:id/review-config`, `…/reviews` and `…/lesson-proposals` routes, the
  scheduler's reviews, the review worker (its own kind of worker input, minimal environment and
  scratch folder, and `propose_lesson`), the prompt's **Reviewed lessons**, the
  `lesson_proposal` and `review_failure` Attention items, and Google Vertex's explicit
  credentials JSON, which only reviews read.
- Migration `005-no-reviewed-learning.sql` drops `agent_reviews`, `agent_lesson_proposals` and the
  `review_*` columns of `agents`, and takes the two kinds out of the notification settings and of
  the records of acknowledged and notified items.
- `lib/approved-lessons.ts`: before that upgrade the daemon reads each Agent's approved private
  lessons, and once it has succeeded adds them to the Agent's `AGENTS.md` under **Lessons the
  human approved**, so they stay in its instructions on every turn. A failed upgrade writes no
  file; a lesson already in the file is not added again.
- Shared lessons were already notes in the Team's memory (`lessons/<id>.md`) and stay there.
- Tests: `test/lib/approved-lessons.test.ts` upgrades a 0.65 home with lessons in every state
  through the daemon's own start; the worker tests that ran on the review worker (an oversized
  frame, a consumer that stops early, a native module mismatch) run on a turn's worker.

## Limits

- Lessons waiting for a decision, rejected or revoked ones, and the history of reviews are
  dropped. The database copy the upgrade keeps in `upgrades/` still has them.
- A Google Vertex credentials JSON stored for reviews stays among the secrets, unused.
