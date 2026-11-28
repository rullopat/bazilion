---
"bazilion": minor
---

**AGENTS.md and TOOLS.md removed from Agents and templates.** Both were in every Agent's instructions on every turn and mostly repeated its `SOUL.md` and Bazilion's own instructions. `SOUL.md` now holds who an Agent is and how it works: the role you give it at the top, its personality and boundaries, and the rules you give it under **How you work**. When the daemon starts it moves into `SOUL.md` what the two files said that the built-in defaults did not, roles and approved lessons included, and keeps the old files in `upgrades/agent-files-<time>/`. An Agent with a Telegram topic is told how its replies read there. `bazilion profile create` no longer takes `--agents-file`, `--skip-agents`, `--tools-file` or `--skip-tools`. A project's `AGENTS.md` in the Team workspace is read as before.
