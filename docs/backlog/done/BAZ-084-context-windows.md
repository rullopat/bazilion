---
id: BAZ-084
title: "Context windows: from the server or set by hand, never assumed"
status: done
created: 2026-11-26
shipped: 2026-11-26
release: v0.62.0
---

# BAZ-084 — Context windows: from the server or set by hand, never assumed

## Outcome

Every local model was taken to read 32,768 tokens. On a llama.cpp server started with 32k,
compaction kept the last 20,000 tokens on top of about 9,500 of instructions and tools, so it
ran again every turn: the engine's prompt cache never held, and Pi left the reply almost no
room, so it stopped a few seconds in. The owner asked for no assumed value at all: the window
comes from the API where it can, and is set by hand where it cannot.

## Scope

- llama.cpp, LM Studio (0.4+) and Ollama say the window a loaded model has; each turn asks.
- A window set by hand per model, on the Models page and with `bazilion provider window`, for a
  local model its server does not size and a hosted model the catalog does not know.
- With neither, the turn is refused at once, saying where to set it; the meter shows no window.
- Compaction is sized to the window, and a reply may use what the window leaves.

## As built

- `core/model-windows.ts`: the windows set by hand, in the `MODEL_CONTEXT_WINDOWS` config row (no
  schema change), kept out of turn environments; `ResolvedAgent.contextWindowSetting` and the
  review runtime carry the one for their model. Taking a model out of Chat forgets it.
- `runtime/providers/pi-runtime.ts`: `askServerWindow` per `local.window` source; the server's
  answer wins over the value set by hand; no window refuses the turn. `maxTokens` is the window.
- `runtime/pi/session.ts`: `compactionFor(window)`: Pi's defaults, at most a quarter of a window.
- `PUT /api/config/models/window`; `GET /api/config/models` gives each chat model's `window`.
- Web: the Models row says **from the server**, **set by you** or **Context window not known**,
  with **Set** opening a dialog. CLI: `provider window`, and `provider models` shows each.
- Started from the owner's patch for llama.cpp's `meta.n_ctx`.

## Known limits

- LM Studio and Ollama say nothing before a model is loaded: a first turn on an unloaded model
  needs a window set by hand.
- A window too small for the instructions and tools (about 9,500 tokens) is not refused up
  front: its replies are cut, and Pi reports that it could not recover.
- llama.cpp's router mode lists only a model's training length, which is not used.
