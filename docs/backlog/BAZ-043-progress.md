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

- **Slice 6, the reviewer capability.** The story's criterion 2, and the largest remaining piece. It
  follows BAZ-044's shape exactly, which is now well-trodden — do not invent a second pattern:

  1. **Invocation.** A restricted invocation `restricted_change_review` on the existing
     `createTrustedReviewInvocation` family, with `authorization: { kind: 'packet', packetId, attemptId }`.
     The packet id *is* the attempt id, so policy, a held approval and dispatch all key on one identity
     and a released approval cannot be replayed onto another packet. It is dispatched directly like
     restricted review — **not** a `TrustedTurnInvocation` with a preclaimed claim, which is what BAZ-044
     slice 5d-1 had to undo.
  2. **Capability.** `reviewPacketRead` (bounded packet metadata, the changed paths of the captured
     revision, and the findings so far) + `reviewFinding` (append one finding) + `reviewConclusion`
     (record the reviewer's conclusion) over IPC, with a `bindReviewCapability` that re-checks the
     packet/attempt against the daemon's own binding before the host is reached — the daemon does not take
     the worker's word for its identity.
  3. **Tools.** Exactly those three, schemas closed with `additionalProperties: false`, and no path
     outside the captured revision's changed paths. Read-only: no bash, edit/write, browser, MCP,
     memory, result or check execution. The spawn guard already rejects
     `codingHost`/`containerHost`/`repositoryContextHost`/`resultHost`/`resourceLifecycle`/`messagingHost`
     for restricted kinds and must additionally reject `verificationRequestHost`.
  4. **Admission and lease.** `review_attempts` already exists. Admission revalidates membership and the
     directed edge on every attempt, claims the attempt, and leaves the workspace **unreserved**: static
     review reads a captured revision and must not hold the Team's checkout, which is also what keeps a
     coder working while its change is reviewed.
  5. **Result.** Reuse BAZ-044's delivery shape: the reviewer's conclusion and findings go back to the
     requester through the canonical messenger with an origin of its own, so a held delivery cannot
     bypass the approval posture.
  6. **The inbox-wake trap the story names.** The ordinary inbox-wake path starts a normal protected
     coding turn with writable Bash. A packet must therefore never ride a peer message as its payload;
     dispatch is owned by the packet state machine, and the adversarial case to write is "an inbox wake
     concurrent with a packet dispatch reviews nothing and executes nothing".
- **Slice 7, completion states.** Only the fields exist (`facts`); nothing records an operator-reported
  commit/PR/deployment yet, and the editor/file-link surface (criterion 5) is absent.
- **An Agent-delivery path for an export.** The export is produced over authenticated HTTP. When an
  Agent should *receive* one, it must go through BAZ-034's durable publication with the same approval
  holds — that wiring does not exist yet, which is why criterion 4 is not claimed.
- **Acceptance record, adversarial gate cases beyond three, defect review, `AGENTS.md` invariants.**

Until those land this story is **not** shippable and its acceptance record does not exist.
