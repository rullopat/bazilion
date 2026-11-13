---
id: BAZ-015
title: Team templates
status: done
created: 2026-07-10
shipped: 2026-07-11
release: v0.9.0
---

# BAZ-015 — Team templates

## Outcome

A Team you have built (its Agents, who may message whom, its USER.md) can be saved as a template
and spawned again in one step, from the web, the CLI or Telegram.

## Scope

- A template is a name, an optional USER.md, a policy mode, ordered slots (Agent Profile, Agent
  name, optional model and reasoning overrides) and allow edges between slots, written by slot
  position (`0` is the first) or `outside`.
- Spawning into a new Team creates it with the template's USER.md and mode; spawning into an
  existing Team adds the Agents and their edges and keeps the Team's mode. The Agents are created
  from their Profiles as with an ordinary spawn.
- A live Team can be saved as a template; templates export to and import from JSON.
- This replaces the earlier Profile Groups and the browser-local policy prototype.

## As built

- CLI: `bazilion team-template list|show|create|export|import|rm`,
  `team-template spawn <template> <team> [--user-md-file …]`,
  `team-template save <team> <template> [--name …]`.
- Web: **Templates → Team templates** (`/templates/teams`), the spawn dialog, and **Save as Team
  template** on the Team's **Policy** tab.
- Telegram: `/spawn_team <template> [in <team>]`.
- HTTP: `/api/team-templates` (`GET`, `POST`, `GET|PUT|DELETE /:id`, `POST /:id/spawn`) and
  `POST /api/teams/:id/policy/save-as-template`.
- Tables: `team_templates`, `team_template_slots`, `team_template_edges`.
- Guide: [Team Policy and Team templates](../../team-policy.md); an example template is in
  `examples/content-team/`.

## Known limits

- A template has no revisions or lineage: editing it does not change Teams spawned from it.
- A Profile that a template slot uses cannot be deleted while the template uses it.
