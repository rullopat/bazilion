---
id: BAZ-031
title: Protected-runtime provider and credentialed web-tool expansion
status: draft
size: L
created: 2026-08-23
priority: medium
deferred: true
deferred_reason: BAZ-027 deliberately covers the operator's current OpenAI Codex usage; refine this only when another provider or credentialed web backend is actually needed.
note: Extend BAZ-027's minimal protected runtime without restoring ambient environment or credential-file discovery.
---

# BAZ-031 — Protected-runtime provider and credentialed web-tool expansion

## User stories

- **As the sole operator adopting another model provider**, I want protected Telegram/background
  turns to receive only that provider's explicit runtime fields, so switching models does not restore
  the daemon's merged environment.
- **As an operator who later needs web search or rendered-page fallback**, I want only the chosen
  backend's credential and validated endpoint available to that tool, so unrelated service secrets
  remain daemon-owned.

## Goal

Extend BAZ-027's closed `MinimalWorkerRuntime` beyond `openai-codex` only after actual usage chooses
the next provider/tool. Every added case must be a named typed projection with its own readiness,
redaction, failure, and regression tests; a generic environment record remains forbidden.

## Why this is separate from BAZ-027

The current deployment uses ChatGPT/OpenAI Codex OAuth. Mapping the entire Pi provider catalog,
ambient AWS/GCP authentication, custom endpoints, and three credentialed web backends would turn
the urgent Telegram/background hardening into an XL project. BAZ-027 therefore ships the protected
execution boundary for the current use and fails other protected providers closed. This draft keeps
the expansion visible without making current safety wait for hypothetical provider needs.

## Candidate scope

- Add a closed, exhaustive provider-runtime union for the provider modes selected during refinement:
  ordinary one-key providers, local LM Studio/Ollama/llama.cpp endpoints, Cloudflare Workers AI/AI
  Gateway identifiers, Bedrock bearer/static credentials, and/or Vertex API-key mode.
- Resolve provider precedence/defaults in the daemon and return either a typed protected runtime or
  `{ protectedReady: false, reason }`; configured local status must not be mistaken for protected
  readiness.
- Install credentials in Pi's in-memory credential store, never the child process environment.
- Reject provider URLs with userinfo/fragments, require HTTPS for credential-bearing remote
  endpoints, and permit HTTP only for explicitly validated loopback local-provider mappings.
- For credentialed web tooling, choose exactly one search backend with a closed union and make
  Firecrawl an independent optional fallback. Reject URL userinfo/fragments, require HTTPS when a
  credential is sent, and retain public-address/DNS-rebinding enforcement.
- Update Config, provider tests, doctor, error redaction, and focused sentinel tests for each added
  case. No unsupported provider may fall back to BAZ-027's configured legacy runtime on a protected
  invocation.

## Out of scope

- BAZ-027's invocation policy, approval mapping, Docker preflight, minimal process bootstrap,
  protected browser/MCP denial, and source-owned failure behavior.
- Credential-minimizing the configured local `operator_http` compatibility branch.
- A daemon provider streaming proxy or a generic secret/environment RPC.
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

## Open questions

- Which non-OpenAI provider or credentialed web backend is the first real requirement? Refine only
  that smallest useful set rather than implementing the whole candidate list speculatively.
- For Bedrock, is bearer/static configuration sufficient, or does current usage require the daemon
  to resolve AWS profiles, web identity, or role/metadata credentials into temporary material?
- For Vertex, is explicit API-key mode sufficient, or does current usage require daemon-side ADC or
  service-account token brokering?
- Does a protected deployment actually need Brave, Firecrawl, or a public SearXNG endpoint, and
  which single search precedence should be canonical?
