# Releases

## 0.25.0 — published 2026-10-30 (alpha)

[GitHub release](https://github.com/rullopat/bazilion/releases/tag/v0.25.0) ·
[Upgrade guidance](upgrades.md)

`bazilion`, `@bazilion/api-types` and `@bazilion/client` are **0.25.0/latest**.
PR #82 merged as `2f1a1f059e282b41dfba83f649c2a9fa89f14be7`; the annotated umbrella tag and
per-package tags identify that source. [Final nine-job CI](https://github.com/rullopat/bazilion/actions/runs/41024307235)
and the existing [publication workflow](https://github.com/rullopat/bazilion/actions/runs/41025663188)
passed. Product maturity remains **alpha**, for operator testing.

This release delivers **trusted Apple Silicon Mac operation**, with explicitly unisolated host
execution, independent hardened Git/MCP/managed-browser protections and fail-closed refusal when
qualified isolation is required. Generic native Mac isolation is deferred/unqualified; Mac Docker/VM
support is removed. Linux native and retained Linux Docker keep their independent safety contracts.

The release supports **Node 26 only**, range **`^26.12.1`**, exact baseline **26.12.1**, pnpm
**12.15.0**. Node 24 and earlier dual-baseline/VM trials are historical, not current support.
Actual installed **27.0.1 (26A434), arm64** trusted-host/non-GUI and main-process lifecycle
trials, plus installed Linux native/protected checks and Mac protected refusals, have bounded
observed coverage. **Genuine public CLI archives** pass guarded offline installs, CLI/API/web/MCP
checks and owned cleanup on Linux and the accepted Mac; the public libraries pass offline runtime
imports and browser-only type consumers. These trials disable npm lifecycle scripts and explicitly
rebuild only project-admitted dependencies; they do not qualify unrestricted default npm scripts.

All three public archives pass integrity, structure and registry ECDSA signature verification.
The library archive bytes match the qualified candidate. The CLI differs only in proven generated
SSR build-root metadata and its renamed-manifest reference; no general cross-build byte-equivalence
is claimed. Registry metadata supplies no `gitHead` or build-source attestation metadata, so
**no cryptographic build-source provenance is claimed**.

For this alpha, the operator accepts the tested **macOS 27.x major line**, observed on **27.0.1**.
Apple's newer 27.2 minor is informational, not another release gate or an OS-upgrade requirement.
Other minors are not implied tested or automatically incompatible. **Mac headed/desktop-browser
qualification is deferred to a later version**, explicitly untested for this release; actual
non-GUI coverage is retained. Intel/Rosetta and Windows remain out of scope. Real-provider/generated-
image acceptance remains unobserved without separate authorized access/spend. These limits must be
reported, not silently converted into passes or new spending requirements for this bounded alpha.
[BAZ-072](backlog/in_progress/BAZ-072-apple-silicon-feature-parity.md) preserves failed histories,
unconfirmed ownership and remaining acceptance. No website deployment was performed. The release
does not erase failed histories, release uncertain resources, establish production readiness or
close unrelated full-parity work. Published 0.24.0 limits below remain historical fact.

## 0.24.0

[GitHub release](https://github.com/rullopat/bazilion/releases/tag/v0.24.0) ·
[What's new](https://bazilion.com/docs/whats-new-0-24/) · [Upgrade guidance](upgrades.md)

Published 2026-10-23. `bazilion`, `@bazilion/api-types` and `@bazilion/client` were published as **0.24.0/latest**.
The annotated tag identifies `06e4c3ddd724474484a675cdadc248a8c2762be6`. Product maturity remains alpha.
See the [changelog](../CHANGELOG.md) for ordinary macOS chat, embedded Pi 1.4.0 and independent
installation/platform/protected-readiness diagnostics. Doctor exits on structural health only;
protected automation separately inspects authenticated `protectedWorkBaselineReady`.

[Final six-job CI](https://github.com/rullopat/bazilion/actions/runs/39941560898) and
[publication](https://github.com/rullopat/bazilion/actions/runs/39942502773) passed: Linux/macOS
source/build/installed trials, offline library imports/browser-only types, 399 required security
cases and nine genuine-release fixtures. The 0.23 sentinel/auth pair survived two starts; eight
older fixtures refused unchanged. Platform/provider/ownership limits remain in
[BAZ-057](backlog/done/BAZ-057-portable-safe-reads.md) and
[BAZ-071](backlog/done/BAZ-071-platform-readiness-diagnostics.md).

Actual public archives passed integrity, structure and registry ECDSA signature checks. Both public
libraries passed offline imports/browser-only types; the public CLI passed a fresh Linux Node
24.22.0 guarded install, CLI/API/browser chat, diagnostics and owned cleanup. Scripts were disabled
and admitted dependencies rebuilt explicitly: no unrestricted lifecycle or new public macOS
qualification claim. Library bytes match the qualified archives; the CLI differs from the local
qualified archive only in proven generated SSR source-root metadata and its filename reference.
No cross-platform byte-equivalence is claimed. npm attestations returned 404 and metadata supplied
no `gitHead`; **no cryptographic build-source provenance is claimed**.

The first release run stopped before publication on a restart-test HTTP 401. A demonstrated
fixture readiness flaw was corrected without changing runtime authentication, then all six jobs
were repeated. The original cause remains unconfirmed;
[the failed run](https://github.com/rullopat/bazilion/actions/runs/39937913021) remains in CI.
[Website PR #23](https://github.com/rullopat/bazilion-web/pull/23) deployed through the existing
Git-driven build; 13 production URLs matched the checked build bytes, including the unchanged installer.

## 0.23.0

[GitHub release](https://github.com/rullopat/bazilion/releases/tag/v0.23.0) ·
[What's new](https://bazilion.com/docs/whats-new-0-23/) · [Upgrade guidance](upgrades.md)

Published 2026-10-21. `bazilion`, `@bazilion/api-types` and `@bazilion/client` were 0.23.0 on
npm `latest` at publication. The release tag identifies code commit `b6d354b5e5e6bc8f82febd1a8047f7a7984c7443`.
The version is stable-tagged; product maturity remains **alpha**, not general-availability acceptance.

### Changes

- Embedded Pi 1.0.0 with explicit daemon-owned MCP admission and no ambient CLI extensions.
- Ordinary provider-backed research, optional managed browsing and truthful source-reading evidence.
- Scoped ChatGPT image generation/rework acceptance and policy-gated retained private-image
  inventory, recovery and discard without regeneration.
- Limited scheduler/process reliability and workspace recovery surfaces.
- Early Node runtime admission and Linux-only MCP stdio process ownership.

### Support boundaries

- CLI/daemon Node range: `^24.22.0 || ^26.4.0`.
- Agent turns and ancestry-pinned repository context remain Linux-only. macOS installation and
  management do not establish Agent-turn support. Windows remains unsupported.
- MCP stdio is Linux-only; Streamable HTTP remains portable. Legacy SSE is retired.
- Incompatible old homes, including 0.22, require preserved state and explicit clean rebootstrap;
  there is no in-place import/compatibility adapter or automatic pre-refusal snapshot promise.
- Native API-key search and non-ChatGPT image routes remain live-unqualified. Account readiness
  is not entitlement. Exact image geometry, scheduled/inbox image qualification and the composed
  content-Team live/human journey are not claimed.
- Registry signatures were verified, but npm build attestations were unavailable. This limitation
  was explicitly accepted; no npm build-provenance badge is claimed.

For exact features and exclusions see the [user stories](backlog/README.md). Earlier release
notes live in [GitHub Releases](https://github.com/rullopat/bazilion/releases) and package changelogs:
[CLI](../apps/cli/CHANGELOG.md), [API types](../packages/api-types/CHANGELOG.md),
[client](../packages/client/CHANGELOG.md).
