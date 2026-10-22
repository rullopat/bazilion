---
id: BAZ-071
title: Separate installation health from platform and execution readiness
status: in_progress
size: S
created: 2026-10-22
priority: medium
target_release: '0.24'
---

# BAZ-071 — Installation and platform diagnostics

## User outcome

An operator with a healthy ordinary-chat installation should not be told it is broken solely
because the protected unattended baseline is unavailable. CLI and web must clearly distinguish
structural installation health, platform support and execution readiness, with actionable limits.

## Accepted scope

- Existing `doctor`, authenticated detailed health and web `/config`; no new diagnostics service.
- A daemon-owned static support projection for ordinary interactive chat, hardened Git inspection,
  MCP stdio and Streamable HTTP. Linux/macOS support is explicit; other platforms remain unsupported.
- `doctor` exit status reflects structural health only. Protected readiness and remediation stay
  visible and machine-readable independently; chat execution is labelled Not checked.
- Neither a configured provider nor a supported platform is proof of execution. No new network,
  provider or native-addon probe, permission, fallback, admission bypass or platform capability.
- No Codemode or Durable adoption and no additional release feature scope.

## Acceptance

- A healthy install exits zero even when protected prerequisites are unavailable; structural faults
  still exit nonzero. Both paths show protected status and untested ordinary chat explicitly.
- macOS labels hardened Git and MCP stdio unsupported and explains the Streamable HTTP alternative.
  Unsupported operating systems cannot inherit supported capability labels.
- CLI and web consume the same daemon report. Detailed diagnostics remain authenticated; public
  liveness does not expose the report. Web imports only hermetic wire types, never daemon internals.
- Existing protected execution, provider, repository, ownership and communication gates are unchanged.

## As built and release boundary

The report is presentation-only in `lib/platform-capabilities.ts`; `/api/health/details` owns its
projection. The existing CLI renders it alongside independent installation and protected summaries.
The web configuration page shows the same report without forwarding unrelated home/health details.
Focused coverage includes real daemon/CLI exit codes and authenticated/public health separation,
platform matrices and web rendering. Qualification and release integration are pending.
