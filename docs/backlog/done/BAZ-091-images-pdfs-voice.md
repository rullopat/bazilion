---
id: BAZ-091
title: "Images, PDFs and voice notes an Agent can read"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.64.0
---

# BAZ-091 — Images, PDFs and voice notes an Agent can read

## Outcome

A PDF reaches the Agent as a file path, and no tool reads it on either mode. A Telegram voice
note arrives as an audio file (`src/lib/telegram/media.ts`) that nothing turns into words, so a
spoken request gets no answer. Pictures are partly covered: BAZ-086's file tools let `read` show
an image in Docker as well, but still one local file at a time. After this story the Agent reads
PDFs, hears voice notes, and looks at several pictures at once. Taken from OpenClaw's
`view_image` and `pdf`. Transcription is not on OpenClaw's list: it is where their `tts` points
for us.

## Scope

- `view_image` takes one or more pictures: paths in the workspace or the uploads, a URL (through
  the SSRF guard of `web_fetch`), or a saved result. They go to the model as images. A model that
  does not take images is told so, and gets no bytes it cannot use.
- `pdf_read` takes a path and, optionally, pages. It returns the text page by page, in parts like
  `browser_snapshot`, and says when a page has no text (a scan).
- **Voice notes:** a Telegram voice note or audio file, or an audio file uploaded in chat, is
  transcribed before the turn. The model is a **Transcription** model chosen under
  Setup → Models. The turn's message then carries the words and the file's path.
- Without a Transcription model, nothing changes: the Agent gets the path, and the setting's card
  says voice notes are not transcribed.

## As built

- `runtime/tools/documents.ts`: `view_image` takes `paths`, `urls` and `results`, shows the
  pictures in order with a line each, and lists what it could not show. `pdf_read` uses unpdf
  (PDF.js) in the worker; text comes per page, split in parts like a snapshot, read once a turn.
- Both read through the shell tools' `readFile`: `ContainerPaths` in Docker, `readFromRoots`
  (workspace and uploads) on the host, which the daemon's reference reader now shares.
- `pictures.ts` sniffs PNG, JPEG, GIF and WebP; the 25 MiB limit is shared with `image_generate`.
- `core/transcription-config.ts`: `BAZILION_TRANSCRIPTION_MODEL` (`off` or `openai:gpt-transcribe`);
  `lib/transcription.ts` posts each audio attachment to `/v1/audio/transcriptions` while the turn
  is prepared. A **Transcription** card on the Models page shares the Images card's parts.
- Guides: [Telegram](../../telegram.md), [models](../../models-and-providers.md#transcription),
  [agent engine](../../agent-engine.md#5-tools).

## Decided while building

- OpenAI's `gpt-transcribe` first: OpenAI deprecated `whisper-1` and the `gpt-4o-*-transcribe`
  models (shut down on 2027-02-26).
- A model without image input gets Pi's own note in place of the picture.
- On the host, `view_image` and `pdf_read` read only the workspace and the uploads.

## Limits

- Scanned PDFs have no text, and OCR is not part of this story.
- A transcription is not a turn, so Usage does not count it.
- Audio files the Agent finds in the workspace are not transcribed, only the ones you send.
