# BAZ-043 — progress

Working branch: `feat/baz-043-review-handoff` (targeting **v0.19.0**, which also carries the BAZ-044 gap
closures). The story file stays in `todo/` until it ships; this log records what actually exists.

## Slice plan

| # | Slice | What it establishes | Status |
|---|-------|---------------------|--------|
| 1 | Packet + findings model | `review_packets`, `review_findings`, `review_conclusions`, `review_attempts`; immutable captured contract, append-only findings with an explicit resolution rule, seven-day retention, restore revalidation | done |
| 2 | Packet capture | Capture a packet from a BAZ-042 snapshot; validate the *actual* inputs (snapshot in-window and complete, reviewer a live same-Team member, requester a member and never the reviewer); a refusal writes zero rows | done |
| 3 | Staleness + applicability | A packet of an older snapshot survives later edits but reads stale for the current code; findings carry the revision they were made against | done |
| 4 | Operator findings + conclusion | API, CLI and web for opening a packet, adding findings with severity and line context, recording a conclusion, and resolving a finding only by explicit decision or a linked revision | done |
| 5 | Handoff export | Patch plus concise handoff/PR-description text; authenticated access, one revision, and open findings stated in the export itself | done (no Agent-delivery path yet — see below) |
| 6 | Reviewer capability | Restricted static-review invocation with bounded snapshot access and findings submission — no bash, edit/write, browser, MCP or check execution | done |
| 7 | Completion states | Change prepared / checks current / reviewed / committed / pushed / PR opened / merged / deployed / production accepted as separate facts, each shown only when its own evidence exists | done |
| 8 | Acceptance, gate, review, docs | Criterion-by-criterion record, adversarial cases, defect review, `AGENTS.md` invariants | done |

## Decisions taken

- **One model, two entry points.** Operator review and Agent review write the same packets, findings and
  conclusions. A second reviewer-facing record would be the "alternative review workflow" the story
  explicitly forbids.
- **Findings are append-only, with an explicit resolution.** `resolved` requires `resolution_kind`
  `explicit` or `linked_revision`; a changed line number alone cannot prove an issue was fixed, so
  `unverified` is a first-class state rather than a failure to match.
- **Snapshot identity, not line identity.** A finding references `(packet, path, snapshot)`; the line
  range is context. This is BAZ-042's feedback rule, kept because it is the one that survives editing.
- **Not `agent_reviews`.** That table is transcript review (BAZ-003). Relabelling its rows would turn a
  learning surface into a code-review workflow, which the story forbids.

## Complete (implemented and observed)

All eight slices are implemented. Records: [acceptance](BAZ-043-acceptance.md), and the live runs
`scripts/review-live-run.mjs` (scripted, and with a real model). The story file sits in `in_progress/`
until v0.19.0 ships, then moves to `done/` with its ship metadata, following BAZ-041/042.

## Deliberate deviations and remaining gaps

These are the things a reader should know are *not* done, or are done differently on purpose:

- **The reviewer has no messaging capability**, although the story's refinement note listed it. The result is
  delivered by the daemon through the canonical messenger, so there is one owner instead of two, and a
  restricted turn with messaging would be a wider surface for no gain. The route that would need it — an
  inbox wake — is exactly the path that must never execute a review.
- **An export cannot yet be delivered to an agent.** The story asks exports to go through BAZ-034's durable
  publication with the same approval holds; today the export is operator-facing HTTP. Criterion 4 is
  therefore only partly met.
- **The workspace is not reserved during a review.** Static review reads a captured revision, so it does not
  hold the Team's checkout — which is also what lets the coder keep working while its change is reviewed. The
  consequence is that a reviewer can read a tree that moves underneath it; the content rule above is what
  keeps that honest.
- **The web panel is not browser-observed** (typechecked and built only), and whether a viewer's browser is on
  the daemon host is stated in the file link rather than detected, because the daemon cannot know.
- **Slice 7, completion states.** Only the fields exist (`facts`); nothing records an operator-reported
  commit/PR/deployment yet, and the editor/file-link surface (criterion 5) is absent.
- **An Agent-delivery path for an export.** The export is produced over authenticated HTTP. When an
  Agent should *receive* one, it must go through BAZ-034's durable publication with the same approval
  holds — that wiring does not exist yet, which is why criterion 4 is not claimed.
- **Acceptance record, adversarial gate cases beyond three, defect review, `AGENTS.md` invariants.**

Until those land this story is **not** shippable and its acceptance record does not exist.
