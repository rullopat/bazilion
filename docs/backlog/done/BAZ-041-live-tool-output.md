---
id: BAZ-041
title: Live tool output
status: done
created: 2026-09-07
shipped: 2026-09-16
release: v0.17.0
---

# BAZ-041 — Live tool output

## Outcome

While an Agent runs a long command you see its output as it happens, in the web chat and in the
terminal, instead of waiting for the result. Known credentials never show up in it.

## Scope

- Pi's partial tool results become one `tool_progress` event per update: a cumulative tail of the
  output (at most 8 KiB), paced to at most one event every 250 ms. Any tool that reports progress
  takes part; in practice that is `bash`, on the host or in Docker.
- The final `tool_result` replaces the live tail.
- All tool output, live and in reloaded history, is redacted for stored secrets and the turn's
  provider credentials.

## As built

- Event: `tool_progress` in `packages/api-types/src/events.ts`, produced by
  `apps/daemon/src/runtime/pi/events.ts`.
- Web: a live tail under the tool call in the chat.
- CLI: `bazilion agent chat --message …` prints new output lines as they arrive.
- Guide: [change review and live tool output](../../change-review.md).

## Not built

- Command receipts, retained command logs and `coding_*` tools (removed): command output lives
  in the conversation transcript like every other tool result.
