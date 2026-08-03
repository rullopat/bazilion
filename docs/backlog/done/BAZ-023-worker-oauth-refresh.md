---
id: BAZ-023
title: Worker-side OpenAI Codex OAuth refresh
status: done
size: S (1-2 days)
created: 2026-08-02
refined: 2026-08-02
shipped: 2026-08-02
priority: high
note: Keep workers DB-free; refresh expiring openai-codex access tokens through daemon-owned IPC.
---

# BAZ-023 - Worker-side OpenAI Codex OAuth refresh

**Status:** Done (unreleased).

## User stories

- **As an operator using ChatGPT OAuth**, I want a long tool-heavy Agent turn to refresh an
  expiring access token, so otherwise healthy work does not fail merely because the turn crossed
  the JWT lifetime.
- **As a maintainer**, I want refresh credentials and the secrets database to remain daemon-owned,
  so adding refresh does not weaken the worker-process boundary.
- **As an operator**, I want refresh failures to surface as ordinary turn errors without exposing
  tokens in events or logs.

## Goal

Complete the existing `openai-codex` refresh seam by letting a worker request a fresh access token
from its parent daemon over the turn's existing IPC channel. Pi receives the callback it already
supports; the worker never opens SQLite or reads encrypted credentials directly.

## Decisions

- The daemon remains the only owner of the DB, bootstrap token, and OAuth refresh credential.
- Refresh is available only when the current Agent actually uses `openai-codex`; unexpected
  provider requests fail closed.
- Refreshed access tokens travel only in the private IPC reply. They are never emitted as
  `ChatFrame`/`SessionEvent` content or written to logs.
- Worker cancellation and exit end the refresh channel with the rest of the turn; no new
  long-lived credential service is introduced.
- API-key providers and short turns retain their existing behavior.

## Scope

- Add a typed worker/daemon IPC refresh request and reply.
- Resolve the daemon-side refresher through the existing `resolveAgentApiKey` helper.
- Pass a worker-side `refreshApiKey` callback into `createBazilionSession`.
- Validate provider scope and preserve useful errors without credential disclosure.
- Add focused protocol, worker wiring, cancellation/error, and redaction tests.
- Remove documentation that describes worker refresh as deferred once the boundary is verified.

## Acceptance criteria

- A worker turn using `openai-codex` can obtain a replacement token after its initial token expires.
- The refresh credential and secrets DB never enter the worker; the worker receives only the
  refreshed access token returned for its current turn.
- A refresh request for another provider is denied without calling the credential loader.
- Cancellation/worker exit does not leave a pending IPC request or keep the subprocess alive.
- No token value appears in emitted chat frames, logs, thrown user-facing errors, or snapshots.
- Existing providers and turns without a refresher are unchanged.

## Out of scope

- Changing the OAuth login, credential storage, or token encryption model.
- General credential brokering for API-key providers.
- Refreshing remote client bearer tokens.
- New CLI or web settings; refresh is transparent runtime reliability.

## As built

- `runAgentTurn` resolves the existing daemon-owned refresher and exposes it to an
  `openai-codex` worker through the turn's private IPC channel. The request is bound to the
  provider, Agent, and turn; the worker remains DB-free and never receives the stored refresh
  credential.
- The correlated worker IPC client rejects and clears pending calls on disconnect, refuses calls
  after disconnect, and cleans up synchronous send failures. Turn cancellation also aborts the
  daemon-side wait.
- Refresh-host failures are replaced with a stable reconnect message so upstream request context
  cannot leak credentials. A child-process integration fixture proves initial and refreshed access
  tokens never enter `ChatFrame` output.
- Expired-token refresh is single-flighted per daemon DB/auth context. It re-reads credentials
  after acquiring the flight and uses a full credential-tuple guard so concurrent login/logout
  cannot be overwritten or resurrected.
- Deferred-refresh documentation was removed and the worker/daemon ownership documentation now
  describes the implemented boundary.

## Tests

- IPC request/reply coverage for success, unexpected provider, missing host, host failure, and
  cancellation/worker shutdown.
- Worker/session wiring test proving Pi receives and uses the callback.
- Regression test proving the refreshed token is absent from output frames and diagnostics.
- Focused daemon tests, root typecheck, lint, build, and `git diff --check` pass.
