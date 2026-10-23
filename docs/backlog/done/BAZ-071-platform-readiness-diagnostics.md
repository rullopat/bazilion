---
id: BAZ-071
title: Separate installation health from platform and execution readiness
status: done
size: S
created: 2026-10-22
priority: medium
target_release: '0.24.0'
closed: 2026-10-23
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
Coverage includes real daemon/CLI exit codes, authenticated/public health separation, platform
matrices and web rendering. The composer exposes queue initialization through `aria-busy`; installed
smoke waits for actual readiness rather than treating a visible SSR textarea as ready to submit.
Submission and execution gates are unchanged.

**Qualified code/test revision:** `3d830efab270db17b76012f86aebd44415ae7311`.
[CI 39835158097](https://github.com/rullopat/bazilion/actions/runs/39835158097) passed all six jobs:
Linux 2,695 tests / 49 existing skips, actual macOS arm64 2,246 / 73 existing skips, build/pack,
399 required security cases and the existing upgrade matrix. Installed Linux/macOS Node 24.22.0
trials observed healthy-install doctor exit zero with protected readiness false, the same CLI/web
platform report at 1280/390-pixel widths without card overflow, empty/instructed CLI/API/browser
chat, instruction-marker arrival and settled owned closes plus successful fixture removal.
A forced queue-initialization control preserved the draft and emitted no chat request before
readiness; the subsequent new trial submitted once and completed.

**Retained failures:** the first Linux installed trial timed out before observing a browser chat
POST ([run](https://github.com/rullopat/bazilion/actions/runs/39830901026)); its exact cause remains
unconfirmed. A controlled probe reproduced the existing pre-dispatch queue-loading refusal, not
proof of that original cause. The follow-up trial exposed a test-interception cleanup race on both
OSs ([run](https://github.com/rullopat/bazilion/actions/runs/39833335454)); the harness now awaits held
route handlers before unregistering them. Fresh final trials passed without longer timeouts or
blind submission replay. A local cross-Node source probe correctly refused a memory addon built
for a different Node ABI; dependencies were not rebuilt to suppress that refusal.

Published 2026-10-23 in [0.24.0](https://github.com/rullopat/bazilion/releases/tag/v0.24.0).
Final six-job CI and actual public Linux guarded-install/library checks passed; see
[releases](../../releases.md). The platform/provider limits in [BAZ-057](BAZ-057-portable-safe-reads.md)
still apply. No expanded platform/paid-provider qualification or execution-admission change.
