---
"bazilion": patch
---

Fix Agent templates keeping a model removed from a provider's list, and embed Pi 1.5.2.

- Saving a provider's model list on `/config` or with `bazilion provider models-set` without a model
  that an Agent template defaults to now moves the template to the provider's first remaining
  model (or to the first available model of another provider when none remains), and reports the
  move. Before, the default template kept the model it was first given, so correcting a mistyped
  model id left new Agents on the old one. Templates on a model that was never listed and per-Agent
  model overrides are not changed.
- The embedded Pi packages (`pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-mcp`) move from 1.4.0
  to 1.5.2. The model catalogs on `/config` follow: GPT-6.1 Terra, Claude Fable 5.2 and Kimi K3.1
  Pro are among the additions, and ids Pi dropped are no longer offered.
- New provider: Qwen Token Plan (Individual, CN), `qwen-token-plan-individual-cn`, which uses
  `QWEN_TOKEN_PLAN_CN_API_KEY`.
- On macOS, Connect ChatGPT on `/config` opens the sign-in page with `/usr/bin/open` instead of
  whichever `open` is first on the daemon's `PATH`. A terminal app that puts its own `open` there
  could keep the page in its built-in browser, leaving the web UI waiting on "opening browser…".

The database schema is unchanged: a 0.26.0 home opens as it is.
