---
'bazilion': minor
'@bazilion/api-types': minor
---

BAZ-059: opt-in image generation through direct OpenAI API-key access, ChatGPT/Codex login, or Pi's OpenRouter image API. Automatic mode follows enabled OpenAI text providers, with the Agent's own route resolving dual enablement; explicit image choices remain available. Stored credentials alone, errors and quota failures never cause credential/billing fallback. Normal Agents save generated images as durable, policy-authorized Results; rework preserves previous versions. Daemon-bound IPC, response limits, cancellation and durable receipts prevent automatic retries of uncertain operations. Restricted reviewers and verification specialists remain denied. Account-dependent live acceptance remains a release gate; no social publishing. The image schema upgrades existing beta homes forward without resetting Results.
