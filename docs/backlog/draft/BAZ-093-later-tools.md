---
id: BAZ-093
title: "The rest of OpenClaw's tool list"
status: draft
created: 2026-11-27
release: v0.65.0 and later
---

# BAZ-093 — The rest of OpenClaw's tool list

## Outcome

When OpenClaw's tools were compared with ours (2026-11-26), these were judged not worth doing
yet. They stay here for later releases. Each one gets its own story when it is picked. The ones
marked **needs your word** go against a standing decision in `AGENTS.md`.

## The list, in a suggested order

1. **Video and music generation** (0.65.0): model functions like the image model, with the
   results saved, for providers that offer them (Google, OpenAI, fal, MiniMax and others).
2. **`x_search`** (0.65.0): searching posts on X through xAI, with an xAI key on the Web search
   card.
3. **`code_execution`** (0.65.0): Python on xAI's servers, with no access to local files. Useful
   only where commands are off.
4. **Goals** (0.66.0): a lasting goal per conversation that the Agent keeps working on after
   each turn, until it is met or blocked. It overlaps the follow-up queue, so the story starts by
   deciding how the two meet.
5. **The Agent in the workspace** (0.66.0): `screen` (the Agent opens a view or a panel tab),
   `theme`, a progress card for a long task, and a canvas for an HTML or SVG widget in chat. Chat
   offers HTML and SVG only as downloads today, so a canvas needs a sandboxed frame.
6. **Tool search and Code Mode** (0.67.0): once MCP connections bring many tools, the Agent
   searches them instead of carrying every definition, and runs one script that calls several
   tools.
7. **Tool rules per Agent and per kind of turn**: which tools an Agent gets (say, a researcher
   without commands), and which tools Telegram or schedule turns get. Rules per sender are left
   out, because there is one user.
8. **Plugins and gateway control**: the Agent adds an MCP server or a skill, or changes a
   setting. **Needs your word:** today only you manage connections and settings.
9. **Nodes**: phones and other computers paired with Bazilion (camera, location, notifications,
   a command run there). **Needs your word:** pairing codes were removed in the November 2026
   cleanup, and macOS is untested.
10. **Elevated mode**: one turn that runs its commands on the host while Docker is on. **Needs
    your word:** Docker applies to every kind of turn.

## Notes

- The releases after 0.64.0 are a suggestion, to be settled when 0.64.0 ships.
- Each item that adds a management feature ships in both the CLI and the web UI, like
  everything else.
