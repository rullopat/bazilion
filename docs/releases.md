# Releases

## 0.24.0 — prepared, unreleased

`bazilion`, `@bazilion/api-types` and `@bazilion/client` are versioned **0.24.0** on the release
branch. They are not yet published; npm latest remains 0.23.0 and PR #79 remains draft/unmerged.
See the [changelog](../CHANGELOG.md) for ordinary macOS chat, embedded Pi 1.4.0
and independent installation/platform/protected-readiness diagnostics. Product maturity remains alpha.

Versioned candidate **`2a2bb4acdaa8225efcd8c38c9a76ce83dedc35a8`** passed all six jobs in
[CI 39923495901](https://github.com/rullopat/bazilion/actions/runs/39923495901): source checks,
build/pack and installed CLI trials on Linux/macOS Node 24.22.0; offline installation of both
unpublished library tarballs together, runtime imports and browser-only consumer types; 399 required
security cases; and the nine-entry genuine-release matrix. The 0.23.0 fixture preserved its Team
sentinel and paired auth across two candidate starts; all eight older fixtures refused unchanged.
CLI tarballs have platform/build-specific hashes; no cross-platform byte-equivalence is claimed.

Existing platform/provider/ownership limits remain. See [upgrade guidance](upgrades.md),
[BAZ-057](backlog/in_progress/BAZ-057-portable-safe-reads.md) and
[BAZ-071](backlog/in_progress/BAZ-071-platform-readiness-diagnostics.md). Publication, public-registry
artifact verification, release integration and website promotion still require operator approval.

## 0.23.0

[GitHub release](https://github.com/rullopat/bazilion/releases/tag/v0.23.0) ·
[What's new](https://bazilion.com/docs/whats-new-0-23/) · [Upgrade guidance](upgrades.md)

Published 2026-10-21. `bazilion`, `@bazilion/api-types` and `@bazilion/client` are 0.23.0 on
npm `latest`. The release tag identifies code commit `b6d354b5e5e6bc8f82febd1a8047f7a7984c7443`.
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
