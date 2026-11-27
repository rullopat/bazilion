---
id: BAZ-095
title: "Videos, music and sound an Agent makes"
status: draft
created: 2026-11-27
release: v0.65.0
---

# BAZ-095 — Videos, music and sound an Agent makes

## Outcome

An Agent can draw pictures (BAZ-059) but cannot make a video, a jingle or a sound effect. After
this story it can, through the same kind of setting as Images, and what it makes plays in chat,
under Files and on Telegram. Item 1 of BAZ-093.

## Scope

- Two model functions on **Setup → Models**, like **Images**: **Video** (`BAZILION_VIDEO_MODEL`)
  and **Music and sound** (`BAZILION_AUDIO_MODEL`). Both are off by default. Each choice names
  its account and who pays, and a choice that is not ready has a button that connects its
  provider. `bazilion config set` takes them too.
- Video through OpenAI (Sora), Google Gemini (Veo), xAI and MiniMax. Music through Google
  (Lyria), MiniMax and ElevenLabs, which also makes sound effects. Each provider's current
  models are checked when building.
- **ElevenLabs** is a new account under **Add a provider**: a key, and no chat models. BAZ-096
  uses it too.
- `video_generate` takes a prompt and optional pictures to start from (like `image_generate`'s
  references). Length and shape are chosen from what the chosen model offers, read from the
  route. It always runs in the background: the call answers at once. The Agent is woken in the
  same conversation when the video is saved, or with the provider's error.
- `audio_generate` takes a prompt, optional lyrics, instrumental or sung, and a length where the
  model takes one. It makes music or a sound effect, as the model allows. It waits like
  `image_generate`, or runs in the background with `background: true`.
- What they make is saved as [Results](../../results.md). Chat plays them with controls, and the
  Files tab and gallery get **Video** and **Audio** kinds. A bound Agent's Telegram topic gets a
  video or an audio file. The daemon serves them with range requests, so a player can seek.

## Where it goes

- `src/core/video-generation-config.ts` and `audio-generation-config.ts`, with their
  `services.ts` fields. `src/lib/video-generation.ts` and `audio-generation.ts`.
- The two tools in `src/runtime/tools/` and their RPC methods; `src/routes/results.ts` for
  playing.
- `src/core/providers.ts` (ElevenLabs). On the web, the Models cards and the chat and Files
  players. `src/lib/telegram/mirror.ts`.
- Guides: [image generation](../../image-generation.md) becomes the guide to pictures, video and
  sound. Also [models](../../models-and-providers.md).

## Limits and open questions

- A video in progress lives in the daemon. A restart before it is saved loses it, as it loses a
  background picture today.
- Results hold at most 25 MiB a file and 1 GiB in all, and a minute of video can pass 25 MiB.
  Proposed: a generated video or sound is saved at the size the provider made it, and still
  counts toward the 1 GiB.
- Telegram bots upload at most 50 MB. A larger file is named in the topic and stays under Files.
- Generating is not a turn, so [Usage](../../usage.md) does not count it. Set spending limits in
  the provider's own account.
