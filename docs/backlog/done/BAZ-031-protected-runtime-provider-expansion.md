---
id: BAZ-031
title: Provider-neutral protected runtime
status: done
size: L
created: 2026-08-23
refined: 2026-08-27
shipped: 2026-08-27
priority: high
note: Extend BAZ-027 across the complete pinned Pi provider catalog without restoring ambient environment or credential-file discovery.
---

# BAZ-031 — Provider-neutral protected runtime

## User stories

- **As an operator adopting any Pi-supported model provider**, I want protected Telegram/background
  turns to receive only that provider's explicit runtime fields, so switching models does not restore
  the daemon's merged environment.
- **As a maintainer updating Pi**, I want provider-catalog drift to fail an exhaustive test, so a new
  provider cannot silently enter configured turns while remaining unsafe or ambiguous in protected
  turns.

## Goal

Extend BAZ-027's closed `MinimalWorkerRuntime` to every provider in Bazilion's pinned Pi registry.
Each provider is resolved to one credential-minimal typed projection or one explicit fail-closed
readiness reason. A generic environment record remains forbidden.

## Why this is separate from BAZ-027

BAZ-027 intentionally shipped the immediate OpenAI Codex OAuth boundary first. Bazilion is also a
general product whose configured provider catalog includes Anthropic and other Pi providers. Those
users should not lose Telegram, schedules, inbox wakeups, approval delivery, hosted HTTP, or reviews
merely because their selected model is not OpenAI Codex, and support must not reintroduce the merged
daemon environment to accomplish that.

## Scope

- Add one exhaustive provider-runtime contract covering ordinary one-key providers, OpenAI Codex
  OAuth, local LM Studio/Ollama/llama.cpp endpoints, Cloudflare identifiers, and explicit
  Bedrock bearer/static credentials.
- Resolve provider precedence/defaults in the daemon and return either a typed protected runtime or
  `{ protectedReady: false, reason }`; configured local status must not be mistaken for protected
  readiness.
- Install credentials in Pi's in-memory credential store, never the child process environment.
  Ambient AWS profiles and host Google ADC paths remain unavailable. Google Vertex instead accepts
  encrypted explicit credentials JSON that is materialized as a mode-0600 per-turn scratch file.
- Reject provider URLs with userinfo/fragments, require HTTPS for credential-bearing remote
  endpoints, and permit HTTP only for explicitly validated loopback local-provider mappings.
- Update Config, provider tests, doctor, error redaction, and focused sentinel tests for each added
  case. No unsupported provider may fall back to BAZ-027's configured legacy runtime on a protected
  invocation.

## Out of scope

- BAZ-027's invocation policy, approval mapping, Docker preflight, minimal process bootstrap,
  protected browser/MCP denial, and source-owned failure behavior.
- Credential-minimizing the configured local `operator_http` compatibility branch.
- A daemon provider streaming proxy or a generic secret/environment RPC.
- Credentialed search, rendered-page fallback, or any expansion of protected `web_fetch`; model
  provider execution is the complete forcing function for this story.
- Enabling a persistent browser or arbitrary MCP server in protected turns.

## Acceptance tests

- Every enabled protected provider id is exhaustively mapped to one documented runtime variant or
  one explicit unsupported reason; unknown ids fail before spawn.
- Sentinel tests prove the worker receives only the selected provider/tool fields and that no
  unrelated daemon/provider/service value appears in process env, typed input, IPC, frames,
  transcripts, logs, or errors.
- Provider and tool endpoint validation rejects embedded credentials, insecure credential
  transport, private-network escape, and DNS rebinding according to the refined mode.
- OpenAI Codex behavior from BAZ-027 and all protected origin/Docker/tool-surface invariants remain
  unchanged.

## Refined decisions

- “All providers” means every provider ID in Bazilion's registry pinned to the current Pi version;
  catalog equality is enforced by a drift test.
- Static-key and explicitly projected multi-field providers are usable immediately. Ambient profile,
  metadata, and host credential-file discovery never cross into the worker and fail with a bounded
  readiness reason.
- OpenAI Codex retains daemon-owned OAuth refresh. Static providers reuse the same provider-bound IPC
  contract without adding a generic secret RPC or exposing unrelated credentials.
- Credentialed web tooling is a separate future story; BAZ-031 changes only model execution.

## As built

- The protected provider catalog is exhaustive against the pinned Pi registry. A catalog drift test
  fails when Pi adds or removes a provider without a reviewed projection.
- Protected turns now support ordinary static-key providers, OpenAI Codex with daemon-owned OAuth
  refresh, explicit Bedrock bearer or static credentials, Cloudflare account and gateway fields,
  loopback-only local providers, and explicit Google Vertex project/location/credentials JSON.
- Workers receive only the selected provider runtime. Credentials are installed into Pi's in-memory
  store; Vertex JSON is written to a mode-0600 per-turn scratch file and removed with the scratch
  directory. Ambient AWS profiles, metadata discovery, host ADC paths, unsafe endpoints, unknown
  providers, and missing credentials fail before spawn.
- Protected Telegram, scheduler, inbox, approval, hosted HTTP, and restricted-review turns share the
  same provider-neutral path. Browser and MCP remain denied and protected `web_fetch` remains
  uncredentialed.
- `pnpm security:acceptance` now requires 60 adversarial cases, including catalog drift, static-key,
  local endpoint, Bedrock, provider-neutral readiness, and Vertex credential-file boundaries.
- Validated on Node 26.7.0: the 60-case acceptance gate passed; the root suite passed 131 files and
  1108 tests with 1 file/3 tests intentionally skipped; root, web, and mobile typechecks passed;
  lint passed with 39 existing warnings; and the production web build passed.
