# Speech

Agents speak, and you can talk to them. A **Speech** model reads text out: the `speak` tool,
**Read aloud** on each Agent message in the web chat, and voice replies on Telegram. A
**Transcription** model turns speech into words: voice notes and audio you send, dictation in the
web chat, and the `transcribe` tool. Both are off until you choose a model on **Setup → Models**.

## Speech

| `BAZILION_SPEECH_MODEL` | Account |
| --- | --- |
| `elevenlabs:eleven_v4` | `ELEVENLABS_API_KEY` (ElevenLabs, a media-only account); in credits |
| `google:gemini-3.8-flash-tts` | `GEMINI_API_KEY`; billed per token |
| `xai:tts` | `XAI_API_KEY`; billed per character |
| `minimax:speech-2.8-hd` | `MINIMAX_API_KEY`; billed per character |

The **Speech** card lists the chosen model's voices, as its provider lists them (ElevenLabs, xAI
and MiniMax from their APIs; Gemini's 30 prebuilt voices), with **Play a sample**. The voice is
`BAZILION_SPEECH_VOICE`; empty means the model's first voice. OpenAI's speech endpoint is left out:
every model it takes is shut down on 2027-01-06.

```sh
bazilion config set BAZILION_SPEECH_MODEL xai:tts
bazilion speech voices                       # the chosen model's voices
bazilion config set BAZILION_SPEECH_VOICE eve
bazilion speech say "Good morning" --output hello.mp3
```

- **`speak`:** the Agent reads text out in the chosen voice, or one it names. The audio is saved
  as a result, played in the chat, and sent to a bound Agent's Telegram topic as a voice note.
- **Read aloud:** the speaker button under an Agent message plays it. Only its prose is read:
  code blocks and tables are left out, links and emphasis read as their words. The audio is made
  when you press it and is not saved; one message plays at a time.
- **Voice replies on Telegram:** when you send a voice note, the answer comes back as a voice
  note after the text. A message you type gets text only. Gemini's speech is WAV, which Telegram
  does not show as a voice note: it arrives as a file.

## Transcription

| `BAZILION_TRANSCRIPTION_MODEL` | Account | Largest file |
| --- | --- | --- |
| `openai:gpt-transcribe` | `OPENAI_API_KEY` | 25 MB; no times |
| `google:gemini-3.5-transcribe` | `GEMINI_API_KEY` | 20 MB |
| `xai:grok-voice-transcribe-2.0` | `XAI_API_KEY` | 500 MB |
| `groq:whisper-large-v3-turbo` | `GROQ_API_KEY` | 25 MB |
| `mistral:voxtral-mini-transcribe-3` | `MISTRAL_API_KEY` (a public preview) | not documented |
| `elevenlabs:scribe_v3` | `ELEVENLABS_API_KEY` | 5 GB; video too |

- **What you send:** voice notes and audio files, on Telegram or attached in a chat, are
  transcribed before the turn; the message carries the words and the file's path.
- **Dictation:** the microphone beside the paperclip records until you press it again; the words
  land in the message field, to edit before sending. The browser asks for the microphone once.
  Browsers give it only to `https://` addresses and to this computer (`127.0.0.1`, `localhost`):
  elsewhere the button is off and says why.
- **`transcribe`:** the Agent turns an audio or video file of its workspace or uploads into
  text, each line with its time (`[1:02] …`) when the model gives times. A file larger than the
  model takes is refused before it is sent.

## Limits

- Speech and transcription are not turns, so [Usage](usage.md) does not count them.
- Read aloud needs the page open; it is not offered on Telegram, where voice replies are.
