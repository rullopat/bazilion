---
id: BAZ-059
title: Image generation
status: done
created: 2026-09-19
shipped: 2026-09-23
release: v0.22.0
---

# BAZ-059 — Image generation

## Outcome

An Agent can create an image from a text prompt, and the image is kept as a saved result you can
see in the chat, the Team's results, the CLI and Telegram. Asking for a change makes a new image
and keeps the old one. You choose which account pays.

## Scope

- One setting, `BAZILION_IMAGE_MODEL`: `off` (default), `openai-codex:gpt-image-2` (the ChatGPT
  login), `openai:gpt-image-2` (`OPENAI_API_KEY`), or an OpenRouter model
  (`openrouter:google/gemini-3.1-flash-image`, `openrouter:openai/gpt-image-2`, with
  `OPENROUTER_API_KEY`). There is no automatic choice.
- The `image_generate` tool takes a prompt (up to 8 KiB) and an optional file name. It runs in
  the daemon, which keeps the credentials, and applies to every kind of turn.
- At most four calls per turn and 180 seconds per call; PNG, JPEG or WebP from a response of at
  most 40 MiB. The images of one call are saved together or not at all.
- A failure shows the provider's own error to the Agent; nothing is retried.

## As built

- Settings: **Content tools → Image generation** on `/config/services`, or
  `bazilion config set BAZILION_IMAGE_MODEL <value>`; the card says whether the account is ready.
- Code: `apps/daemon/src/lib/image-generation.ts` (the daemon host) and the `image_generate` tool.
- Images are saved like delivered files ([BAZ-034](BAZ-034-durable-agent-deliverables.md)).
- Guide: [image generation](../../image-generation.md).

## Known limits

- Editing an image, masks and reference images are not supported.
- A call that failed or was stopped after the request was sent may still have been billed.
- Only the ChatGPT route was exercised against the live service.
