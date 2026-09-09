# Coding stories after the Agent-led remake

Reviewed 2026-09-09 against PR #46 commit `81aaa31`. This is a backlog revision, not implementation
or release evidence for the successor stories. BAZ-039/040 acceptance and CI are recorded separately.

## Product rule

The operator assigns work in chat. Agents discover instructions, choose commands, prepare available
prerequisites and cooperate through existing authority. New features should explain the actual
work and make its evidence useful. They must not require setting up Team checks before a task.

## Retained stories

| Story | Finding | Revised increment |
| --- | --- | --- |
| [041](../todo/BAZ-041-coding-command-verification.md) | Basic execution receipts, redaction, cancellation and peer reads already exist; old scope mixed streaming, storage, snapshotting and a check console. | Live command progress and bounded retained diagnostics in chat. Extend existing receipts and authorized output access; no saved checks or new runner. |
| [042](../todo/BAZ-042-git-change-review.md) | Genuine missing user value, but manual baseline setup and split snapshot ownership could recreate the old UX. | Agent captures before edits; show the resulting changes and evidence beside chat. Own source manifests and command applicability here. |
| [043](../todo/BAZ-043-coding-review-handoff.md) | Operator-created packets were the primary entry point; ordinary delegation already exists. | Agent-requested review of an immutable change with enforced read-only capability. Chat findings first, packet/export details second. |
| [044](../todo/BAZ-044-specialist-verification-handoff.md) | Named operator-reviewed checks and new peer access duplicated or contradicted 040. | Capture task-selected commands and actual environment; restrict specialist execution to that request and bind results to code. Reuse peer access and yield/resume. |

## Recommended order

1. **041 next:** ask “Run the app test and investigate failures.” See progress immediately and reopen
   authorized diagnostics after navigation. This is independently useful without snapshot UI.
2. **042:** ask “Fix the bug.” Inspect changes since the Agent's baseline, prior dirty work and checks
   for the captured source version. Earlier receipts without source capture remain historical only.
3. **043 or 044:** choose static review when a second opinion is useful, or formal tester execution
   when finite checks need precise scope. Basic teammate help remains available without either.

## Decisions still required before implementation

- 041: finite log quotas/expiry/backup treatment and captured live-output/reconnect authorization.
- 042: bounded snapshot coverage, untracked inclusion, retention and supported Git metadata layouts.
  Before/after equality cannot prove the absence of transient external edits; state coverage limits.
- 043/044: one typed dispatch owner and restricted capability preserved through inbox, queue and
  approval routing. No ordinary writable turn may accidentally consume the same restricted request.

The four retained stories are refined and ready in `todo`. The parallel-workspace and controlled
deployment drafts were removed; either can receive a new ID if a concrete need returns. No new
stories are needed for already-implemented receipts, locks or ordinary handoffs. The stories retain
existing policy, protected execution and clean-install schema boundaries.
