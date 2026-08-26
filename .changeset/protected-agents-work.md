---
'bazilion': minor
'@bazilion/api-types': minor
---

Add credential-minimal protected execution for Telegram and autonomous Agent work. Protected turns
now require a fail-closed Docker coding surface, an OpenAI Codex access-token-only runtime, guarded
`web_fetch`, and exact trusted invocation identity while excluding host tools, browser, MCP, search,
ambient daemon credentials, and OAuth refresh credentials. Restricted learning reviews use the same
minimal worker bootstrap with a reviewer-only capability surface. Config, health, and `bazilion
doctor` expose protected readiness and secret-free remediation.

Telegram no longer grants ownership to the first sender. Authenticated CLI and web surfaces mint a
short-lived, digest-only one-time pairing challenge; `/pair` is accepted only in the configured
service topic, and messages, edits, bots, anonymous senders, foreign-chat callbacks, and missing
sender identities fail closed before commands or Agent work. Health now warns when the forum is
public, has unexpected membership, or no longer contains the paired owner, while Telegram logs and
Bot API errors omit message content, identities, pairing secrets, and bot credentials.
