---
id: BAZ-074
title: Tools with typed settings, model names in the menus
status: done
created: 2026-11-21
shipped: 2026-11-21
release: v0.52.0
---

# BAZ-074 — Tools with typed settings, model names in the menus

## Outcome

What Agents can do besides thinking is set on one page, each tool as a card that says what is in
effect and is saved whole. A model is chosen by its name wherever one is chosen.

## Scope

- **Setup → Tools** replaces Services: five cards (Web search, Web pages, Browser, Commands,
  Messages between Agents) for the 18 settings that each had a text box and a save button.
- A setting is entered as what it is: a choice with what each option means, a switch, a number
  in the unit people use, a key shown as saved.
- A card says what is in effect now and what a choice would meet (a missing key, Docker without
  the image) before it is saved. A setting that only matters with another choice appears with it.
- One Save per card: every value is checked, and nothing is stored unless all of them pass.
- The model menus of the Agent tab, **Spawn an agent** and Agent templates show model names by
  provider, with how much each reads and whether it sees images.
- The Setup tabs are Models, Tools, MCP, Telegram, Access and System.

## As built

- Daemon: a field's `input` (text, choice, switch, number) and `when` in `core/services.ts`;
  `lib/setting-fields.ts` checks a value and reads it the way the daemon does;
  `lib/tools-overview.ts` describes each card. `GET /api/config/tools`, `PUT /api/config/fields`
  (several settings, all or nothing); `PUT /api/config/fields/:name` runs the same check.
- CLI: `bazilion config set NAME=value …` saves several together; `config list` shows defaults,
  what is in effect and what each setting takes.
- Web: `/config/tools` (`components/setup/ToolCard.tsx`, `lib/tool-form.ts`) and
  `components/ModelMenu.tsx`. `/config/telegram` and `/config/access` replace
  `/config/integrations/telegram` and `/config/tokens`, without redirects.
- Removed: `GET /api/config/services`, `GET /api/config/available-models`, and the setting groups
  `shell-security`, `brave-search`, `searxng` and `firecrawl`.
- No database change. Stored values are read as before: one that would now be refused stays in
  effect until it is changed.

## Known limits

- Telegram and MCP keep their own pages and forms.
- Outside the menus a model is still shown by its id: template lists, the conversation header,
  the CLI.
- Docker is asked whether it has the image each time the Tools page opens, for at most 3 s.
- In the dark theme the choices use the browser's own light radio buttons.
