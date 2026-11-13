---
id: BAZ-056
title: Remove the interactive CLI chat loop
status: done
created: 2026-09-17
shipped: 2026-09-17
release: v0.21.0-beta.1
---

# BAZ-056 — Remove the interactive CLI chat loop

## Outcome

The CLI no longer offers a chat loop that looked interactive but had no history, session
management or formatting. One-shot chat stays for scripting; the web UI is the conversational
surface.

## Decision

The owner judged the readline loop in `bazilion agent chat` (a `> ` prompt and `/exit`) not worth
completing. A real terminal client would need sessions, history, Markdown and slash commands, and
would be its own story if it is ever wanted.

## As built

- `bazilion agent chat <id> --message "…"` (or piped stdin) runs one turn and exits; `--image` and
  `--file` attach files. Without a message it is a usage error that points to `--message` and the
  web UI.
- In a terminal, one-shot chat still answers questions and dangerous-command approvals inline;
  without a terminal those approvals are denied.
- `chat-trim`, `chat-context` and `chat-compact` stay as management commands.
- The daemon's chat endpoint did not change.

## Not built

- An interactive terminal UI.
