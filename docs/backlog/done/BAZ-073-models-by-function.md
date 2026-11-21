---
id: BAZ-073
title: Models by function, connected in one step
status: done
created: 2026-11-21
shipped: 2026-11-21
release: v0.51.0
---

# BAZ-073 — Models by function, connected in one step

## Outcome

Setting up what Agents think and draw with takes one step per provider and ends in a state that
was checked. Setup is sorted by what a model does, not by which of 45 vendors has a switch on.

## Scope

- **Setup → Models** replaces the Providers page: Chat (the models Agents think with, each with
  its name, size, list price and who uses it), Images (one route, or off) and Providers (only the
  ones in use, each with what its last test found).
- Connecting a provider is one step: key, sign-in or address, the models to offer, and a test.
  The provider is on once it answers; a failed test saves nothing.
- A provider's state is the outcome of a test, worded for the operator, with the provider's own
  message kept beside it.
- The first run is one screen: choose, connect, start chatting. Local model servers are found
  at their usual addresses.
- Health, the runtime summary and the backup move to a **System** tab.

## As built

- Web: `/config` (Models, with the connect dialog, the model picker and a sheet per provider),
  `/config/system`, and `/welcome` as the one-screen first run. `?provider=`, `?add=` and
  `?pick=true` open the sheet, the connect dialog and the picker.
- CLI: `bazilion provider connect`, `disconnect`, `test <id>`; `provider list` shows states and
  only the providers in use (`--all` for every one).
- HTTP: `POST /api/config/providers/:id/connect`, `…/test`, `DELETE /api/config/providers/:id`,
  `GET|POST …/catalog`, `GET /api/config/providers/local`, `GET /api/config/models`.
- Suggested models are a short list per provider in `core/providers.ts`; a test fails when Pi's
  catalog drops one.
- No database change: a 0.50 home opens as it is. Test outcomes are one row of the config table.

## Known limits

- Connecting tests one model, the cheapest chosen; the others are not asked.
- A hosted provider's key is checked with a real request, which the provider may bill at its
  normal rate for a few tokens. No free "list models" call is used for this.
- A provider that stops working later is noticed only at the next test or the next failed turn;
  nothing tests in the background.
- Services and the model menus were left as they were; [BAZ-074](BAZ-074-tools-and-model-names.md)
  redid both in 0.52.0.
- Video generation and voice transcription do not exist; a new function would be one more card.
