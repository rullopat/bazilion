---
id: BAZ-105
title: "One file for who an Agent is: AGENTS.md and TOOLS.md removed"
status: in_progress
created: 2026-11-28
release: v0.67.0
---

# BAZ-105 — One file for who an Agent is

## Outcome

Asked for on 2026-11-28: "make it part of 0.67.0 to remove both TOOLS.md and AGENTS.md". Both
were in every Agent's instructions on every turn, about 3,900 characters. In the owner's 16
Agents neither had ever changed, apart from the role put at the top of AGENTS.md. Their text
repeated SOUL.md and the instructions Bazilion writes, TOOLS.md was a placeholder, and nothing
told an Agent to write to either. An Agent's home now has SOUL.md (who it is and how it works:
its role, personality, boundaries and rules) and IDENTITY.md. A project's `AGENTS.md` in the Team
workspace is read as before.

## As built

- Templates and new Agents have SOUL.md, IDENTITY.md and BOOTSTRAP.md, in the web UI and the CLI
  (`--agents-file`, `--skip-agents`, `--tools-file` and `--skip-tools` are gone). `home_read`,
  `home_write`, the instructions and the `/context` view know only those.
- A role given when an Agent is added (web, CLI or `agent_create`) goes at the top of SOUL.md;
  approved lessons from a 0.65 home go to its end.
- `home_edit` changes one passage of SOUL.md or IDENTITY.md (it must appear once), or adds to the
  end, so a rule is added without rewriting the file; `home_write` says to prefer it.
- The default SOUL.md adds "reading is free; prefer a step you can undo" and stops naming
  AGENTS.md. The Agent Home section says a rule you give about how the Agent works goes in
  SOUL.md under **How you work**, and a preference for the whole Team in USER.md.
- A **Telegram** section, only for an Agent with a topic: its replies are read there, so short and
  in one message, and Markdown is converted. It replaces AGENTS.md's channel manners, which every
  Agent got and which named channels nothing plans.
- `lib/soul-only.ts`, at each start: an Agent home or template that still has either file gets
  what it says that a shipped default did not (known by hash) moved into SOUL.md, the role at the
  top and lessons at the end, the rest under **How you work** and **Tools**. A SOUL.md that is a
  shipped default becomes today's. The files as they were go to `upgrades/agent-files-<time>/`
  first; a link or an unreadable file is left, with a line in the log.
- The content team example builds each SOUL.md from its role, operating rules and tool notes.
- Tests: `test/lib/soul-only.test.ts` starts the daemon on a 0.66 home (defaults, a role, edited
  files with lessons, a template, a link, a second start); the lessons test upgrades a 0.65 home.

## Limits

- An AGENTS.md or TOOLS.md that an Agent added to at the end moves only what it added. One
  changed inside the default text moves whole, the default text included.
- A changed SOUL.md keeps its text; only a shipped Continuity paragraph is updated.
- `home_write` still replaces a whole file: an Agent that uses it for SOUL.md must keep its role
  and rules, as its description says.
- Going back to 0.66.0 leaves the Agents with SOUL.md alone until the kept files are copied back.
