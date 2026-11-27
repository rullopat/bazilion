---
id: BAZ-093
title: "The rest of OpenClaw's tool list"
status: draft
created: 2026-11-27
release: v0.66.0 and later
---

# BAZ-093 — The rest of OpenClaw's tool list

## Outcome

When OpenClaw's tools were compared with ours (2026-11-26), these were judged not worth doing
yet. They stay here for later releases. Each one gets its own story when it is picked. The ones
marked **needs your word** go against a standing decision in `AGENTS.md`.

## The list, in a suggested order

Video and music generation and the Agent in the workspace moved to 0.65.0, as BAZ-095 and
BAZ-097.

1. **Goals** (0.66.0): a lasting goal per conversation that the Agent keeps working on after
   each turn, until it is met or blocked. It overlaps the follow-up queue, so the story starts by
   deciding how the two meet.
2. **Tool search and Code Mode** (0.67.0): once MCP connections bring many tools, the Agent
   searches them instead of carrying every definition, and runs one script that calls several
   tools.
3. **Tool rules per Agent and per kind of turn**: which tools an Agent gets (say, a researcher
   without commands), and which tools Telegram or schedule turns get. Rules per sender are left
   out, because there is one user.
4. **`x_search`**: searching posts on X through xAI, with an xAI key on the Web search card.
5. **`code_execution`**: Python on xAI's servers, with no access to local files. Useful only
   where commands are off.
6. **Plugins and gateway control**: the Agent adds an MCP server or a skill, or changes a
   setting. **Needs your word:** today only you manage connections and settings.
7. **Nodes**: phones and other computers paired with Bazilion (camera, location, notifications,
   a command run there). **Needs your word:** pairing codes were removed in the November 2026
   cleanup, and macOS is untested.
8. **Elevated mode**: one turn that runs its commands on the host while Docker is on. **Needs
   your word:** Docker applies to every kind of turn.

## Notes

- The releases after 0.65.0 are a suggestion, to be settled when 0.65.0 ships.
- Each item that adds a management feature ships in both the CLI and the web UI, like
  everything else.
