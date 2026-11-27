# Video and sound

Agents make short videos with `video_generate` and music or sound effects with `audio_generate`.
What they make is saved as a [Result](results.md): it plays in the chat, is listed under **Files**
(the Video and Audio kinds), and goes to a bound Agent's Telegram topic. Both are off until you
choose a model.

## Configure

Each is one setting, chosen on **Setup → Models** (`/config`) on the **Video** and **Music and
sound** cards, or from a terminal. Each choice says whether its account is ready; one that is not
has a button that connects the provider it needs.

| Setting | Value | Account |
| --- | --- | --- |
| `BAZILION_VIDEO_MODEL` | `xai:grok-imagine-video-1.5` | `XAI_API_KEY`; billed per second of video |
| | `google:gemini-omni-1.2-flash` | `GEMINI_API_KEY`; billed per second of video |
| | `minimax:MiniMax-H3` | `MINIMAX_API_KEY`; billed per video |
| `BAZILION_AUDIO_MODEL` | `elevenlabs:music_v2_5` | `ELEVENLABS_API_KEY`; music and sound effects, in credits |
| | `google:lyria-3.5` | `GEMINI_API_KEY`; music only, billed per song |

```sh
bazilion config set BAZILION_VIDEO_MODEL xai:grok-imagine-video-1.5
bazilion config set BAZILION_AUDIO_MODEL off
```

**ElevenLabs** is under **Add a provider** like the others, but it is an account for media only:
connecting it saves its key, and it has no chat models. It serves Music and sound,
[speech](speech.md) and transcription.

Left out on purpose: OpenAI's Sora (shut down on 2026-09-24), Google's Veo on the Gemini API
(shut down on 2026-10-22, replaced by Gemini Omni Flash) and MiniMax music (closed to new users).

## Use

- **Video:** ask for one, for example "make an eight-second video of waves at dawn, portrait".
  The Agent gives a prompt, a length in whole seconds and a shape (landscape, portrait or square),
  and may start from a picture of its workspace or uploads as the first frame. Grok Imagine takes
  1 to 15 seconds, Gemini Omni 3 to 15 (landscape or portrait), MiniMax H3 4 to 15; another
  length is refused at once with the ones the model takes. A video always runs in the background:
  the call answers at once, and the Agent is woken in the same conversation when the video is
  saved, to show it to you, or with the provider's reason when it fails.
- **Music and sound:** a prompt with the genre, mood and instruments, and optionally lyrics, no
  voices, a length (ElevenLabs: 3 to 600 seconds of music, 0.5 to 30 of a sound effect; Lyria takes
  the length from the prompt), or a looping sound effect. The call waits for the sound, or runs in
  the background with `background: true`. Lyria's lyrics come back with the song.

## Limits

- What is made is saved like any result: at most 25 MiB a file, 1 GiB in all. A short video at
  720p and an MP3 song are well under it; a larger one fails with that reason.
- A video, or a sound made in the background, lives in the daemon until it is saved: a restart
  before then loses it.
- Telegram bots send at most 50 MB a file.
- Making is not a turn, so [Usage](usage.md) does not count it. Set spending limits in the
  provider's own account.
