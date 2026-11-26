---
"bazilion": minor
---

**A local model gets the context window its server was started with.** A llama.cpp model was always taken to read 32,768 tokens, whatever it was loaded with, so a conversation was summarized much earlier than needed, or later than the server allowed. Each turn now asks the server, which reports it in its model listing (`meta.n_ctx`), and the window meter and `bazilion agent chat-context` show the same figure. LM Studio and Ollama do not report one, and their models keep 32,768.
