---
"bazilion": minor
---

**A model's context window is never assumed: the server says it, or you set it.** Every local model was taken to read 32,768 tokens, whatever it was loaded with. On a 32k llama.cpp server that made Bazilion summarize the conversation again on every turn, so the engine's prompt cache never held, and replies stopped a few seconds in for lack of room. Now each turn asks the server: llama.cpp, LM Studio 0.4 or later and Ollama all say the window a loaded model has. When the server does not say (an LM Studio or Ollama model not loaded yet, or a hosted model the catalog does not know), set the window on the model's row on the Models page, or with `bazilion provider window <provider:model> <tokens>`. A turn on a model whose window nothing says is refused at once, saying where to set it. Summaries are sized to the window, keeping at most a quarter of a small one, and a reply may use what the window leaves instead of 4,096 tokens.
