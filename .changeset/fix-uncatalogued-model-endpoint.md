---
'bazilion': patch
'@bazilion/client': patch
'@bazilion/api-types': patch
---

Fix the endpoint used for a model newer than the bundled catalogue.

Two defects, both introduced with the Fireworks endpoint in 0.19.0:

- An uncatalogued model id is built for the OpenAI-compatible adapter, and the OpenAI SDK appends only
  `/chat/completions` to the base URL it is given. The pinned endpoint was the provider's catalogue base
  (`…/inference`, correct for its `anthropic-messages` entries), so the fallback called
  `…/inference/chat/completions` and got a **404** instead of `…/inference/v1/chat/completions`. The
  translation is now applied only to the fallback, explicitly per provider, and catalogued models keep
  their own endpoint and API type.
- The provider registry carried only the API key, so `bazilion provider test` and any other registry
  consumer failed closed with "configure an endpoint for a custom one" for exactly the models that
  endpoint was meant to admit. The default endpoint now travels in the provider config from the same
  single source, and an explicit `FIREWORKS_BASE_URL` still wins.

Verified against your own model (`accounts/fireworks/models/deepseek-v4p1-flash`, newer than this build's
catalogue): `provider test` answers, a real turn produces a visible reply, and both live loops — specialist
verification and specialist review — complete on it, with the reviewer stating in its own words that it has
no shell and cannot run anything.

No schema change: a 0.19.0 home upgrades in place. Both live-run harnesses additionally assert that a turn
actually put an assistant message in the transcript, so a turn that does nothing can no longer read as one
that succeeded.
