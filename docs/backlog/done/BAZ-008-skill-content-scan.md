---
id: BAZ-008
title: Skill content scan
status: done
created: 2026-07-02
shipped: 2026-07-02
release: v0.8.0
---

# BAZ-008 — Skill content scan

## Outcome

Before a third-party `SKILL.md` lands in the library or reaches an Agent's prompt, Bazilion flags
text that looks like prompt injection or credential exfiltration, names the pattern and its
severity, and asks you to confirm.

## Scope

- A static, line-based scan of `SKILL.md` with four rules: references to sensitive paths, the
  database, `auth.json` or credential variables (`sensitive-reference`); instructions to send
  secrets somewhere (`secret-exfiltration`); attempts to override instructions
  (`instruction-hijack`); invisible Unicode control characters (`unicode-stealth`).
- Import refuses a skill with findings until you confirm; attaching one to an Agent asks again.
- The library and the Agent's skills list show the findings.

## As built

- CLI: `bazilion skill import --from <openclaw|path|file.zip> [--force]` (`--force` confirms
  findings and overwrites existing skills); `bazilion agent skill add <agent> <skill>
  [--allow-warnings]`.
- Web: the **Skills** page and the Agent's skills card show findings and ask before attaching.
- HTTP: `POST /api/skills/import` and `POST /api/agents/:id/skills` answer 400
  `skill_scan_blocked` with the findings until confirmed (`force`, `allowFindings`).
- Code: `apps/daemon/src/core/skills/scan.ts`.

## Known limits

- The scan reads text; it does not run or inspect helper scripts. Skills stay prompt-only and
  their scripts run through `bash`, under the sandbox setting of the turn.
- A clean scan is not a guarantee: read skills you do not trust.
