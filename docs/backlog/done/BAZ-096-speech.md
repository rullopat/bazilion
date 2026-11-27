---
id: BAZ-096
title: "Speech: Agents that talk, dictation, any audio transcribed"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.65.0
---

# BAZ-096 — Speech: Agents that talk, dictation, any audio transcribed

## Outcome

Voice notes you sent were transcribed (BAZ-091), through OpenAI only, but Agents answered in text
alone, the web chat took speech only as a file, and audio in the workspace stayed unread. Now
Agents talk, you can dictate, and an Agent transcribes any recording it has.

## As built

- **Speech** (`BAZILION_SPEECH_MODEL`, `BAZILION_SPEECH_VOICE`) through ElevenLabs Eleven v4,
  Gemini 3.8 Flash TTS, xAI Grok Voice or MiniMax Speech 2.8 HD (`lib/media/speech.ts`). The card
  lists the provider's voices (every page of them) and plays a sample.
- `speak` saves the audio as a result; Telegram gets it as a voice note.
- **Read aloud**: a speaker under each Agent message; `POST /api/speech` reads its prose only
  (`speakableText`: no code blocks or tables) and saves nothing.
- **Voice replies**: a Telegram voice note marks its queue item; after the turn the answer goes
  back as a voice note too (`lib/telegram/voice-reply.ts`).
- **Transcription** through Gemini 3.5 Transcribe, xAI Grok Voice Transcribe 2.0, Groq Whisper
  Large v3 Turbo, Mistral Voxtral Mini Transcribe 3 and ElevenLabs Scribe v3 beside OpenAI, each
  with its provider's upload limit.
- **Dictation**: a microphone beside the paperclip records with the browser's MediaRecorder and
  sends it to `POST /api/transcription`; the page's `permissions-policy` now lets it ask.
- `transcribe` reads a workspace or uploads file up to what the model takes and gives lines with
  their times where the model gives them (segments, or words grouped by sentence and pause).
- `bazilion speech voices` and `bazilion speech say`.
- Guides: [speech](../../speech.md), [Telegram](../../telegram.md).

## Decided while building

- No OpenAI speech: every model of `/v1/audio/speech` is shut down on 2027-01-06.
- Voice replies always follow a voice note, with no switch per Agent.
- Gemini's voices are its 30 prebuilt ones, kept here; its API lists catalogue voices of another
  kind.

## Limits

- Gemini's speech is WAV, which Telegram shows as a file, not a voice note.
- OpenAI's `gpt-transcribe` gives no times.
- Speech and transcription are not turns, so Usage does not count them.
