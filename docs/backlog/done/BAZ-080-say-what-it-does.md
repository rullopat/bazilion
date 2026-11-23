---
id: BAZ-080
title: Say what it does: connections, roles, names, a Team's day, common connections
status: done
created: 2026-11-23
shipped: 2026-11-23
release: v0.58.0
---

# BAZ-080 — Say what it does: connections, roles, names, a Team's day, common connections

## Outcome

After 0.57.1 the owner asked what a UX expert would still change, and took every suggestion:
name the Connections modes by what they do; give an Agent its job when it is added; one name per
Agent; show Changes only where there is a repository; a Team's day at a glance; mail, calendar,
chat and notes through common MCP servers, with outward tools asking first; and four small ones.

## Scope

- Connections: **Everyone** and **Connections only**; drawing a teammate connection in an open
  Team asks to switch.
- **What is it for?** on Add an Agent and `agent spawn --role`: the role on top of AGENTS.md,
  no first-run ritual.
- The name from IDENTITY.md shown and offered; names unique per Team on add, rename and move;
  teammates reachable by either name.
- Changes only for Git folders; the Team folder behind a link.
- **Today** on a Team's overview and `bazilion team today`.
- Setup → MCP **Common connections** (Microsoft 365, Google Workspace, Slack, Notion), server
  variables, and approval before outward MCP tools.
- System names a broken skill; Stop says the follow-ups are paused; templates say Use; the
  Mailbox's try-a-message tool folded.

## As built

- Shared: `chosenName`, `agentNameProblem`, `MCP_PRESETS`/`presetServer`, `TeamDayResponse`,
  the `outward-action` risk and `CommandApproval.tool`.
- Daemon: `nameTakenInTeam`/`freeNameInTeam`, `giveRole` in `core/agent/spawn.ts`,
  `lib/team-day.ts` and `GET /api/teams/:id/today`, `lib/mcp/settings.ts` (variables and ask
  lists in the encrypted secrets, kept out of every Agent environment), the approval gate in
  `resolveMcpForTurn`'s host, wired from `agent-turn.ts` to the command approval registry.
- Web: `lib/team-policy.ts` (`MODE_NAME`, `SWITCH_QUESTION`), `TeamToday.tsx`,
  `setup/McpPresets.tsx`, the ask editor on the Servers card.
- No schema change.

## Known limits

- Common connections are third-party servers; each one's own guide is the reference, and their
  sign-ins differ. A server whose only sign-in is a remote OAuth flow cannot be connected.
- Which tools ask is guessed from tool names until you choose; a tool named like a read that
  writes is not caught.
- With host execution an Agent's shell runs as your user: a server's variables are kept out of
  its environment, not out of its reach. The Docker sandbox keeps them out.
- Today covers the local day since midnight and up to 200 events, and says when there were more.
