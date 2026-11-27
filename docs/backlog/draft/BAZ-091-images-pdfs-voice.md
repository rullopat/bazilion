---
id: BAZ-091
title: "Images, PDFs and voice notes an Agent can read"
status: draft
created: 2026-11-27
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

## Where it goes

- `src/runtime/tools/view-image.ts`, `src/runtime/tools/pdf-read.ts` (a PDF text library the
  worker can load under type stripping and the CLI bundle can carry).
- `src/lib/attachments.ts`, `src/lib/telegram/media.ts`, `src/core/services.ts` and
  `src/core/providers.ts` (the model function and the providers that offer transcription).
- Guides: [Telegram](../../telegram.md), [agent engine](../../agent-engine.md#5-tools),
  [models and providers](../../models-and-providers.md).

## Limits and open questions

- Scanned PDFs have no text, and OCR is not part of this story.
- Usage is counted from the session files, so a transcription made outside a turn does not show
  in Usage until it is counted there.
- Audio files the Agent finds in the workspace are not transcribed, only the ones you send.
- To decide: which transcription providers come first. OpenAI's models are my pick.
