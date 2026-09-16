# BAZ-043 — progress

Working branch: `feat/baz-043-review-handoff` (targeting **v0.19.0**, which also carries the BAZ-044 gap
closures). The story file stays in `todo/` until it ships; this log records what actually exists.

## Slice plan

| # | Slice | What it establishes | Status |
|---|-------|---------------------|--------|
| 1 | Packet + findings model | `review_packets`, `review_findings`, `review_conclusions`, `review_attempts`; immutable captured contract, append-only findings with an explicit resolution rule, seven-day retention, restore revalidation | done |
| 2 | Packet capture | Capture a packet from a BAZ-042 snapshot; validate the *actual* inputs (snapshot in-window and complete, reviewer a live same-Team member, requester a member and never the reviewer); a refusal writes zero rows | done |
| 3 | Staleness + applicability | A packet of an older snapshot survives later edits but reads stale for the current code; findings carry the revision they were made against | done |
| 4 | Operator findings + conclusion | API, CLI and web for opening a packet, adding findings with severity and line context, recording a conclusion, and resolving a finding only by explicit decision or a linked revision | pending |
| 5 | Handoff export | Patch plus concise handoff/PR-description text through BAZ-034's durable publication and access contract; a held Agent delivery cannot be bypassed by an export | pending |
| 6 | Reviewer capability | Restricted static-review invocation with bounded snapshot access, findings submission and messaging — no bash, edit/write, browser, MCP or check execution | pending |
| 7 | Completion states | Change prepared / checks current / reviewed / committed / pushed / PR opened / merged / deployed / production accepted as separate facts, each shown only when its own evidence exists | pending |
| 8 | Acceptance, gate, review, docs | Criterion-by-criterion record, adversarial cases, defect review, `AGENTS.md` invariants | pending |

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

## Not implemented yet

Everything from slice 4 onwards, including the reviewer capability, the export and the operator
surfaces. Until those land this story is **not** shippable and its acceptance record does not exist.
