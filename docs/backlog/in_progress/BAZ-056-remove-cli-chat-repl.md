---
id: BAZ-056
title: Remove the interactive chat REPL from the CLI; one-shot chat stays
status: in_progress
size: S (afternoon)
created: 2026-09-17
priority: medium
note: Operator decision 2026-09-17 — the bare readline REPL in `agent chat` is not worth completing; 1.0 keeps one-shot chat + dedicated question/approval/attention commands + web. A full TUI client is a possible post-1.0 project (would be its own BAZ, built properly or not at all).
---

# BAZ-056 - Remove the interactive chat REPL from the CLI; one-shot chat stays

## User stories

- **As an operator**, I want the CLI to stop offering a chat surface that looks
  interactive but supports no session management, no history, and no formatting, so
  the product doesn't advertise an experience it hasn't finished.
- **As a maintainer**, I want the least-polished surface removed rather than
  maintained, so the 1.0 CLI is only things done well.

## Goal

Delete the interactive REPL loop embedded in `bazilion agent chat` (the
"erroneously put into cli" mini-TUI) while keeping every other chat surface intact.

## Why

Found on 2026-09-17 during the 1.0 surface review: `apps/cli/src/commands/agent.ts`
contains a readline chat loop (`> ` prompt, `/exit`, streaming turns, inline
question/approval prompts, error-draft preservation). It is the least finished
surface in the product — no slash commands beyond exit, no session resume, no
markdown, no history recall — and redundant: the web UI is the conversational
surface, the dedicated `question`/`approval`/`attention` commands handle agent
requests, and one-shot chat covers scripting. Completing it into a real TUI is a
product decision for later (post-1.0), not a 1.0 obligation.

## Scope

- **Remove:** the interactive REPL branch of `chatCmd.run` — the `while (true)`
  loop, `/exit` handling, retry-draft logic, and the no-message entry into it.
  `bazilion agent chat <id>` without `--message` becomes a usage error pointing to
  one-shot mode and the web UI.
- **Keep:** one-shot mode (`--message`, `--image`, `--file`) — the scripting surface,
  exercised heavily by tests; `streamTurn` and the question/approval prompt plumbing
  (used by one-shot in TTY mode); `bashApprovalModeForTty` fail-closed `auto_deny`
  for non-TTY callers; `chat-trim` / `chat-context` / `chat-compact` (management
  commands, not chat UI).

## Out of scope

- A real TUI client (post-1.0 candidate — would need session management, history,
  markdown, slash commands; its own BAZ if ever proposed).
- Any daemon or web change; the `/api/agents/:id/chat` endpoint is unchanged.

## Tests

1. `bazilion agent chat <id>` without a message exits non-zero with guidance;
   `--message` still streams a turn and exits.
2. One-shot with a TTY still answers structured questions and bash approvals
   interactively; non-TTY callers still get fail-closed `auto_deny`.
3. Full suite green — `chat.test.ts` / `command-approval.test.ts` untouched in
   behavior.

## As-built

**Done on `feat/remove-cli-chat-repl`, 2026-09-17.**

- The interactive TTY REPL loop removed from `chatCmd.run` (~70 lines: the
  `while (true)` prompt loop, `/exit` handling for interactive use, retry-draft
  preservation, inline question/approval prompts — those plumbed only into the loop;
  one-shot mode keeps its own prompt plumbing for TTY approvals).
- `bazilion agent chat <id>` without `--message` now exits non-zero with usage
  guidance pointing at one-shot mode and the web UI.
- **Piped stdin kept, deliberately:** `echo msg | bazilion agent chat <id>` was never
  TUI — it is a scripting surface that runs each line as a turn under fail-closed
  `auto_deny` (no caller could answer an approval). `/exit` still terminates a piped
  stream.
- Verification: full suite 1,806 passed / 0 failed; typecheck clean; `chat.test.ts` /
  `command-approval.test.ts` (35 cases) untouched in behavior — they exercise
  one-shot mode only.
