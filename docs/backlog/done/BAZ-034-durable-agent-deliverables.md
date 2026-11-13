---
id: BAZ-034
title: Saved results
status: done
created: 2026-09-07
shipped: 2026-09-08
release: v0.15.0
---

# BAZ-034 — Saved results

## Outcome

A file an Agent delivers stays available after the turn: you can reopen, preview and download it
from the chat, a Team's results list, the CLI or Telegram, and every surface refers to the same
saved copy.

## Scope

- `deliver_file` and `image_generate` save the bytes, size and SHA-256 in the database through the
  turn's daemon host; the chat's `file` event and the tool result carry only the result id.
- A result is listed with its Agent, Team and conversation; it outlives the Agent and is deleted
  with its Team.
- Preview: text and Markdown up to 256 KiB, PNG/JPEG/GIF/WebP up to 10 MiB; everything else is
  download-only.
- Limits: 25 MiB per file and 1 GiB per home; deleting a result frees its share.

## As built

- CLI: `bazilion result list --team <team> [--agent …] [--json]`, `result show <id>`,
  `result download <id> --output <path>`, `result rm <id> --yes`; `bazilion agent chat` saves
  delivered files into the current directory.
- Web: result cards in the chat and **Team → Results**, with a link to the conversation.
- Telegram: a bound Agent's results are sent to its topic.
- HTTP: `GET /api/results`, `GET|DELETE /api/results/:id`, `GET /api/results/:id/download`,
  `GET /api/results/:id/preview`.
- Table: `agent_results`. Guide: [results](../../results.md).

## Known limits

- Results never expire; at the 1 GiB limit deliveries fail until you delete some.
- Changing the workspace file later does not change the saved result.
