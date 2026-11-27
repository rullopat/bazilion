---
id: BAZ-096
title: "Speech: Agents that talk, dictation, any audio transcribed"
status: draft
created: 2026-11-27
release: v0.65.0
---

# BAZ-096 — Speech: Agents that talk, dictation, any audio transcribed

## Outcome

Since BAZ-091 a voice note you send is transcribed before the turn, through OpenAI only. But the
Agent answers only in text, and the web chat takes speech only as a recorded file. Audio the
Agent finds in its workspace stays unread. After this story Agents talk, you can dictate, and an
Agent can transcribe any audio or video it has.

## Text to speech

- A **Speech** model function on **Setup → Models** (`BAZILION_SPEECH_MODEL`), off by default.
  Routes go through OpenAI, Google Gemini, MiniMax and ElevenLabs (BAZ-095), with the voices
  each one offers, read from the provider where it lists them. The card picks a default voice
  and plays a sample.
- `speak` takes text and, optionally, a voice. The audio is saved as a Result and played in
  chat, and it goes to a bound Agent's Telegram topic as a voice note.
- **Read aloud**: a button on each Agent message in the web chat plays it in the default voice.
  The audio is made when you ask and is not saved.
- **Voice replies on Telegram**: when you send a voice note, the Agent's answer comes back as a
  voice note as well as text. A message you type gets text only.
- Without a Speech model the tool is not offered, the button is not shown, and Telegram replies
  stay text.

## Speech to text

- **More providers** for **Transcription**: Google Gemini, Groq, Mistral and ElevenLabs beside
  OpenAI, each on its existing account.
- **Dictation**: press the microphone button in the web chat's message field to record, and
  press it again to stop. The words land in the field, for you to edit before sending. The
  browser asks for the microphone once. On an `http://` address other than this computer the
  browser refuses, and the button says why.
- `transcribe`: the Agent turns an audio or video file in its workspace or uploads into text.
  It includes times when the model gives them, and it takes the formats the chosen model takes.

## Where it goes

- `src/core/speech-config.ts`, more routes in `src/core/transcription-config.ts`,
  `src/lib/speech.ts` and `src/lib/transcription.ts`.
- `src/runtime/tools/speak.ts` and `transcribe.ts`, with their RPC methods. A route that speaks
  a message (Read aloud) and one that transcribes a recording (dictation).
- On the web: the Composer (the microphone), the transcript (Read aloud) and the Models cards.
  `src/lib/telegram/` for voice replies.
- Guides: [models](../../models-and-providers.md), [Telegram](../../telegram.md),
  [conversations](../../conversations.md).

## Limits and open questions

- Speech and transcription are not turns, so Usage does not count them.
- Read aloud and voice replies speak the message's prose and leave out code blocks and tables.
- To decide: whether voice replies on Telegram need a switch per Agent, or always follow a voice
  note as above.
