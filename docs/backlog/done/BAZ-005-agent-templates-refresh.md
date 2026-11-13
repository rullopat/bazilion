---
id: BAZ-005
title: Agent templates with a two-sided first run
status: done
created: 2026-05-25
shipped: 2026-05-29
release: v0.5.0
---

# BAZ-005 — Agent templates with a two-sided first run

## Outcome

A new Agent starts from useful default documents, and its first conversation is a short
interview about both of you: it learns who it is and who you are, writes that down, and from then
on works from it. Agents are recognisable by their emoji, avatar, creature and vibe.

## Scope

- Default Profile documents: `SOUL.md` (character), `IDENTITY.md` (name, emoji, creature, vibe,
  avatar), `AGENTS.md` (how it works: memory discipline, red lines, when to speak), `TOOLS.md`
  (tool playbook) and `BOOTSTRAP.md` (the first-run ritual).
- While `BOOTSTRAP.md` exists the system prompt adds a First-Run Ritual: one question per turn,
  then `home_write` for `IDENTITY.md`, `user_md_write` for the Team's USER.md, and
  `bootstrap_done`, which deletes `BOOTSTRAP.md`.
- A new Team gets a starter USER.md when none is given.
- The web lists Agents with the identity fields parsed from `IDENTITY.md`.

## As built

- Templates: `apps/daemon/src/core/profile/templates.ts`; copied into `agents/<id>/` at spawn.
- CLI: `bazilion profile create <id> [--soul-file …] [--identity-file …] [--agents-file …]
  [--tools-file …] [--bootstrap-file …] [--skip-bootstrap]`, `profile edit <id> --file <name>`.
- Web: **Templates → Agent templates** (`/templates/agents`), the Agent list and Agent page.
- HTTP: `GET /api/profiles/_/templates` returns the defaults; `GET|PUT
  /api/profiles/:id/files/:file` edits a Profile's documents.

## Known limits

- Existing Agents keep their own copies: editing a Profile does not change Agents spawned from it.
- An Agent edits its own documents with `home_write`; `BOOTSTRAP.md` is read-only to it.
