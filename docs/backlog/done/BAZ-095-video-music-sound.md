---
id: BAZ-095
title: "Videos, music and sound an Agent makes"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.65.0
---

# BAZ-095 — Videos, music and sound an Agent makes

## Outcome

An Agent could draw pictures (BAZ-059) but not make a video, a jingle or a sound effect. Now it
can, through settings like Images, and what it makes plays in chat, under Files and on Telegram.
Item 1 of BAZ-093.

## As built

- `core/media-routes.ts`: **Video** (`BAZILION_VIDEO_MODEL`) through xAI Grok Imagine Video 1.5,
  Gemini Omni Flash or MiniMax H3; **Music and sound** (`BAZILION_AUDIO_MODEL`) through ElevenLabs
  (music and sound effects) or Lyria 3.5 (music). Each runs on its provider's key, read where the
  provider's entry says; the cards on Setup → Models are the Images card's.
- **ElevenLabs** is a provider entry with `media: true`: connecting it saves its key, with no
  chat models; its sheet says what it serves.
- `lib/media/video.ts`: xAI and MiniMax run a job, asked about as each suggests (5 s, 10 s);
  Gemini Omni answers the request with the video. Lengths and shapes are each model's own
  (`VIDEO_CHOICES`), checked before anything is sent. `video_generate` always runs in the
  background and wakes the Agent with the result or the provider's reason.
- `lib/media/audio.ts`: ElevenLabs music and sound effects, Lyria with its lyrics.
  `audio_generate` waits, or runs in the background.
- `GET /api/results/:id/media` serves sounds and videos inline with `Range`; chat and Files play
  them; Files has Video and Audio kinds. Telegram gets an MP4 as a video and MP3 as audio.
- Guides: [video and sound](../../video-and-sound.md), [results](../../results.md).

## Decided while building

- No OpenAI video and no Veo: Sora was shut down on 2026-09-24 and Veo on the Gemini API on
  2026-10-22 (Gemini Omni Flash replaced it). MiniMax music is left out: closed to new users.
- The 25 MiB per-file limit stays. Lifting it needs the table of saved files rebuilt in every
  home, and these models' videos (up to 15 s at 720p) and songs fit under it.
- A video always runs in the background, with no deadline of Bazilion's: the provider ends it.

## Limits

- A video, or a sound made in the background, is lost if the daemon restarts before it is saved.
- Telegram bots send at most 50 MB; a larger file is named in the topic.
- Making is not a turn, so Usage does not count it.
