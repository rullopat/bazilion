---
id: BAZ-023
title: ChatGPT token refresh during long turns
status: done
created: 2026-08-02
shipped: 2026-08-02
release: v0.11.0
---

# BAZ-023 — ChatGPT token refresh during long turns

## Outcome

A long, tool-heavy turn on a ChatGPT (`openai-codex`) model keeps working when its access token
expires mid-turn. The refresh token never leaves the daemon, and a failed refresh is an ordinary
turn error that names the fix (sign in again).

## Scope

- The daemon keeps the OAuth blob (`refresh`, `access`, `expires`) in the encrypted secrets table
  as `OPENAI_CODEX_OAUTH` and refreshes it once at a time when it nears expiry.
- A worker starts with the current access token. Pi asks for a key before every provider request;
  the worker asks the daemon over the turn's IPC channel (`refreshApiKey`), and only an access
  token comes back.
- The daemon answers only for the turn's own provider and only while the turn runs.
- Daemon-side sessions (`/compact`) use the same refresher directly.

## As built

- `apps/daemon/src/lib/api-key.ts:resolveAgentApiKey` gives every session its starting token and
  refresher; `runtime/worker/api-key-refresh.ts` answers the IPC call.
- Sign-in: `bazilion auth openai login [--device-code] | status | logout`, or **Connect ChatGPT**
  on `/config`.
- Refreshed tokens are added to the turn's redaction list, so they never appear in frames or
  logs.

## Known limits

- A revoked or expired refresh token needs a new sign-in; turns fail until then.
