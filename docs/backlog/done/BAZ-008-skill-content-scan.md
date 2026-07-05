---
id: BAZ-008
title: Skill content scan — prompt-injection and exfiltration warnings
status: done
size: S (1-2 days)
created: 2026-07-02
shipped: 2026-07-02
priority: high
note: Split from BAZ-006 Layer 1. This is static warning/confirmation only; sandboxing and command approval remain in BAZ-006.
---

# BAZ-008 — Skill content scan — prompt-injection and exfiltration warnings

**Status:** Done. Bazilion imports third-party `SKILL.md` files and injects them into agent system prompts when attached. Before this BAZ, import validated YAML/frontmatter shape, but did not scan the markdown for prompt-injection, credential-access, or exfiltration patterns. This BAZ shipped the first independent layer from BAZ-006: a static scanner that warns operators before risky skills are imported or attached.

## User stories

- **As an operator importing skills from OpenClaw, a local directory, or a zip**, I want Bazilion to flag suspicious `SKILL.md` content before it lands in `~/.bazilion/skills`, so I do not accidentally load a prompt-injection payload.
- **As an operator attaching a skill to an agent**, I want a warning when that skill has known findings, so prompt-context changes remain intentional.
- **As a CLI/web user**, I want concise findings that name the suspicious pattern and severity, so I can decide whether to trust the skill without reading a giant markdown file line by line.

## Goal

Ship a static `SKILL.md` scanner used at import, list, and attach time. The scanner should report structured findings for:

- sensitive path access: `~/.ssh`, `~/.aws`, `~/.gnupg`, `auth.json`, `bazilion.db`, provider key names;
- exfiltration language around secrets/env/files;
- instruction-hijacking phrases such as "ignore previous instructions" and "override system prompt";
- Unicode stealth characters: bidi overrides, zero-width characters, and byte-order marks inside the body.

Import should fail by default when findings are present and succeed only with an explicit `force` confirmation. Existing installed skills should remain usable, but `GET /api/skills`, CLI `skill list`, and web `/skills` should surface warning badges. Agent attach should reject risky skills unless the request explicitly confirms the warnings.

## Scope

- Add `scanSkillContent` under `apps/daemon/src/core/skills/`.
- Extend `SkillInfo` and import/attach request/response wire types with scan findings.
- Run scan during import validation before any filesystem copy.
- Run scan in `GET /api/skills` and `GET /api/agents/:id/skills` so already-installed skills are visible.
- Add an explicit confirmation field for import and attach flows. Reuse the existing `force` flag for import confirmation so old CLI/web paths have a clear manual override.
- Show findings in CLI `bazilion skill list` / `bazilion skill import`.
- Show findings and confirmation affordances in web `/skills` and agent skill attach controls.

## Out of scope

- Runtime filesystem/network sandboxing.
- Command approval tripwires.
- Skill signing or trusted registry metadata.
- Blocking existing already-attached skills at turn runtime.

## Tests

- Unit scanner fixtures: benign skill passes; sensitive paths, exfiltration language, prompt-hijack language, zero-width characters, and bidi controls are flagged.
- Import tests: suspicious skill fails without confirmation, imports with confirmation, and reports findings in skipped/imported metadata.
- Route tests or core-level attach coverage: attaching a suspicious skill requires explicit confirmation.
- Existing parse/import/resolve tests continue passing.

## As-built

Shipped as planned:

- Added `scanSkillContent` in `apps/daemon/src/core/skills/scan.ts`, returning structured findings with `code`, `severity`, `message`, and line numbers.
- Import now validates and scans every candidate `SKILL.md` before copying. Findings block import unless the operator confirms with the existing `force` path (`bazilion skill import --force`, web checkbox, or multipart `force=true`).
- `GET /api/skills` and `GET /api/agents/:id/skills` include `scanFindings`, so already-installed skills are visible without changing runtime behavior.
- `POST /api/agents/:id/skills` rejects risky skills unless `allowFindings: true` is passed.
- CLI surfaces:
  - `bazilion skill list` prints scan findings below the library table.
  - `bazilion skill import` prints blocked findings and a `--force` hint; forced imports print confirmed findings.
  - `bazilion agent skill add --allow-warnings` confirms attach findings.
- Web surfaces:
  - `/skills` shows a scan column and blocked-import findings.
  - Agent skill tables show scan findings and prompt before attaching a risky skill.

Tests added:

- Scanner fixtures and import confirmation coverage in `apps/daemon/test/core/skills.test.ts`.
- Focused route coverage in `apps/daemon/test/routes/agent-skills.test.ts` for rejecting a risky skill attach unless findings are confirmed.

Deliberately left for BAZ-006:

- Runtime sandboxing.
- Command approval tripwires.
- Signed/trusted skill registry semantics.
