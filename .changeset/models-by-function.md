---
"bazilion": minor
---

Setup is sorted by what a model does, and a provider is connected in one step that ends in a checked state. A 0.50 home opens as it is.

- **Setup → Models (`/config`):** Chat (the models Agents think with), Images (the model they draw with, or off) and Providers (the accounts and local servers behind them) on one page. Only the providers in use are listed; the others are behind **Add a provider**. Each chat model shows its name, how much it can read, whether it takes images, its list price per million tokens and who uses it; these facts come from the catalog bundled with Pi.
- **Connect in one step:** paste the key (or sign in with ChatGPT, or give a local server's address), keep the suggested models or choose others, and press **Connect and test**. The cheapest chosen model is asked for a short reply; only when it answers are the key and the models saved and the provider switched on. A key that does not work is never stored, and a model the provider refuses for the account is left out.
- **A state that was checked:** a provider is "Working", "Key rejected", "Not answering", "Model unavailable", "Limit reached", "Not tested yet", "Needs a key" or "Turned off". A failed test says what happened and what to do, with the provider's own message beside it. A line above the cards names the provider that does not answer and how many Agents depend on it.
- **Model picker:** search across every connected provider, filter by image input or reasoning, with dated copies of a model folded away. Removing a model that Agents use says so first.
- **First run on one screen:** `/welcome` is choose, connect, start chatting. **On this computer** finds LM Studio, Ollama and llama.cpp at their usual addresses; **Start chatting** opens the first Agent.
- **System tab:** installation health, the runtime summary and the backup download moved from the top of the providers page to `/config/system`.
- **CLI:** `bazilion provider connect <id> [--key …] [--url …] [--set NAME=value] [--models a,b] [--no-test]`, `bazilion provider disconnect <id>` and `bazilion provider test <id>`. `provider list` shows each provider's state and only the providers in use (`--all` for every one); `provider models <id>` lists names, sizes and prices.
- **HTTP:** `POST /api/config/providers/:id/connect`, `POST …/test`, `DELETE /api/config/providers/:id`, `GET|POST …/catalog`, `GET /api/config/providers/local` and `GET /api/config/models`.
- **Changed:** `GET /api/config/providers` returns each provider's `state`, `check`, `models`, `suggested` and `listed` and no longer asks any provider for its model list, so the page opens at once whatever a local server is doing; `GET /api/config/providers/:id/models` is gone; `GET /api/config/services` lists image generation under `functions`; `PUT /api/config/providers/:id/enabled` refuses to switch on a provider that has no credentials. The Services page no longer has an Image generation card.
- **Renamed:** the ChatGPT provider is shown as "ChatGPT" and Google as "Google Gemini"; a local server's "Endpoint URL" is its "Address". Provider ids and setting names are unchanged.
