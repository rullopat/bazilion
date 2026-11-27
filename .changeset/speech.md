---
"bazilion": minor
---

**Agents talk, and you can dictate.** The new **Speech** card chooses a voice model (ElevenLabs Eleven v4, Gemini 3.8 Flash TTS, xAI Grok Voice or MiniMax Speech 2.8 HD) and one of its voices, with a sample to hear. Agents then have `speak`, which saves the audio and sends it to Telegram as a voice note; every Agent message in the web chat has a speaker button that reads it aloud, prose only; and a voice note you send on Telegram is answered by a voice note too. With a **Transcription** model chosen, the microphone beside the paperclip dictates into the message field, and Agents have `transcribe` for audio and video files in their workspace, with the time of each line where the model gives one. Transcription now also runs through Gemini 3.5 Transcribe, xAI Grok Voice Transcribe 2.0, Groq Whisper Large v3 Turbo, Mistral Voxtral and ElevenLabs Scribe v3. `bazilion speech voices` lists the voices and `bazilion speech say` reads text into a file.
