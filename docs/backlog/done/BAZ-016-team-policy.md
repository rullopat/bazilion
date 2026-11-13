---
id: BAZ-016
title: Team Policy
status: done
created: 2026-07-10
shipped: 2026-07-11
release: v0.9.0
---

# BAZ-016 — Team Policy

## Outcome

You decide which Agents may message which. A Team is either open (members message freely) or
restricted (only along the allow edges you draw); messages between Teams need consent on both
sides. Policy never limits you: you can always talk to every Agent and every Agent can reach you.

## Scope

- A policy is a mode (`open` by default, or `restricted`) plus directed allow edges whose
  endpoints are member Agents or `outside` (every Agent in other Teams).
- Inside a restricted Team a message needs an edge `sender -> recipient`. Across Teams it needs
  `sender -> outside` in the sender's Team and `outside -> recipient` in the recipient's, whatever
  the modes.
- One check, `mayMessage`, runs when an Agent message is sent, together with the hop limit: from
  the `send_message` tool and from `POST /api/agents/:id/messages` (`bazilion send`).
- A denied message is an error returned to the sender with the reason, plus a
  `team_policy_denied` line in the daemon log; nothing is stored or queued.
- An Agent that moves to another Team loses its edges; edits apply at once, last write wins.
- The causal hop limit ([BAZ-025](BAZ-025-agent-loop-circuit-breaker.md)) is separate.

## As built

- CLI: `bazilion team policy show <team> [--json]`, `team policy mode <team> open|restricted`,
  `team policy allow|deny <team> <from> <to>` (member names, ids or `outside`).
- Web: the Team's **Policy** tab with the Open/Restricted toggle and the Flow and Matrix editors.
- HTTP: `GET|PATCH /api/teams/:id/policy`.
- Storage: `teams.policy_mode` and `team_policy_edges`.
- Guide: [Team Policy and Team templates](../../team-policy.md).

## Known limits

- No denial history, approval queue or policy revisions; the daemon log is the only record of a
  denial.
- Policy covers Agent-to-Agent messages only, not tools, files or the shell.
