# Image generation

The `image_generate` tool lets an Agent create an image from a text prompt. The image is saved as
a [Result](results.md): it appears in the chat, in **Team → Results**, in `bazilion result list`
and, for a bound Agent, in its Telegram topic. Image generation is off until you pick a model.

## Configure

One setting, `BAZILION_IMAGE_MODEL`, chooses the model and the account that pays for it:

| Value | Account |
| --- | --- |
| `off` (default) | Image generation is off; Agents have no `image_generate` tool. |
| `openai-codex:gpt-image-2` | Your ChatGPT login (**Connect ChatGPT** on `/config`, or `bazilion auth openai login`); uses the subscription. |
| `openai:gpt-image-2` | `OPENAI_API_KEY` (the OpenAI card on `/config`); billed per image by OpenAI. |
| `openrouter:google/gemini-3.1-flash-image` | `OPENROUTER_API_KEY`; billed by OpenRouter. |
| `openrouter:openai/gpt-image-2` | `OPENROUTER_API_KEY`; billed by OpenRouter. |

In the web UI, choose it on `/config/services` (**Content tools → Image generation**); the card's
status line says whether the chosen account is ready. From the CLI:

```sh
bazilion config set BAZILION_IMAGE_MODEL openai-codex:gpt-image-2
bazilion config set BAZILION_IMAGE_MODEL off
```

The setting applies to every Agent and every kind of turn (chat, Telegram, follow-ups, schedules
and inbox wakes) from the next turn on. Set spending limits in the provider's own account.

## Use

Ask for an image, for example: “Draw a square illustration of a balcony garden and save it as
balcony-garden.” The Agent passes a prompt (up to 8 KiB) and an optional file name. Asking for a
change (“make it brighter”) is a new generation, not an edit of the previous image.

The CLI chat saves a delivered image into the current directory unless a file of that name already
exists; it then prints the result id for `bazilion result download <id> --output <path>`.

## Limits

- At most four `image_generate` calls per turn; each call waits up to 180 seconds.
- The OpenAI and ChatGPT routes ask for one 1024×1024 PNG; OpenRouter uses the model's defaults
  and may return up to four images, each saved as its own result.
- Only PNG, JPEG and WebP are accepted, from a provider response of at most 40 MiB. Results are
  limited to 25 MiB per file and 1 GiB in total; the images of one call are saved together or not
  at all.
- A failed call shows the provider's own error to the Agent. Nothing is retried automatically, and
  a call that failed or was stopped after the request was sent may still have been billed.
