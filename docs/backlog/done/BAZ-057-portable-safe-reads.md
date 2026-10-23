---
id: BAZ-057
title: Portable safe reads — repository context off-Linux
status: done
size: L
created: 2026-09-17
priority: high
target_release: '0.24.0'
closed: 2026-10-23
note: Shipped in 0.24.0. Actual macOS arm64 qualification is bounded below; Windows remains unsupported.
---

# BAZ-057 — Portable safe reads — repository context off-Linux

## User stories

- As an operator on macOS, I want to install Bazilion and actually chat with my Agents,
  rather than finish setup only to discover every ordinary turn is refused.
- As an operator, I want required repository context captured with explicit checks and limits,
  not suppressed or replaced with identity-blind file reads to make a turn succeed.
- As a maintainer, I want truthful per-platform guarantees, preserved Linux protections and
  visible refusal when an independently restricted capability is unavailable.

## Goal and release scope

**Released in 0.24.0: usable ordinary Agent chat on macOS**, not merely a successful installer,
dashboard or repository-context endpoint. [PR #79](https://github.com/rullopat/bazilion/pull/79)
integrated the implementation; final CI/publication and public-artifact checks are recorded in
[releases](../../releases.md). The historical 0.23.0 package retains its Linux-only turn boundary.

Windows, universal native-platform parity, paid/live-provider qualification and additional
Git/container/subprocess capabilities are not implied by ordinary chat success.

## Capture contract and as built

Initial code candidate: **`b14b7c21ecce928100eb2172d0914d00d33dec82`**.
The ordinary path was subsequently revalidated after the Pi 1.4.0 upgrade at
**`5ab045cb3b6b2018378556857e2cdb32084c84a7`** in
[CI 39778352776](https://github.com/rullopat/bazilion/actions/runs/39778352776), including actual
installed Linux/macOS CLI/API/browser turns. See [embedded Pi](../../pi-runtime.md) for that
upgrade's qualification and retained failures; the filesystem/process limits below still apply.

- `lib/repository-context/files.ts` is the shared daemon-owned capture adapter. It uses public
  `@openclaw/fs-safe@0.26.8` APIs, pinned in both daemon and packed-CLI manifests; no private
  binding imports, custom native addon, worker DB access or client/wire dependency was added.
- Linux retains `/proc/self/fd` directory-relative no-follow access. macOS uses guarded rooted
  opens and exact retained-directory/registration checks around operations and final acceptance.
  Both retain directory descriptors, exact bigint identities, bounded reads and source observations.
- Registered root symlinks are supported; retargeting, observed root/child replacement, changed
  files, previously absent files and captured listings are revalidated. Nested/leaf symlinks,
  special files, unsafe targets, unknown identities and overflow do not become complete context.
  macOS keeps the library's stricter default hardlink rejection rather than silently disabling it.
  Source bytes/digests and instruction/source/report limits remain authoritative.
- These are guarded reads and change detectors, **not an atomic filesystem snapshot or a general
  sandbox**. macOS pathname observations are best-effort under hostile concurrent mutation, not
  the same mechanism as Linux's retained fd-relative access. No native-mode label establishes
  admission or removes those limitations.
- The single hardened `lib/git/capture.ts` now explicitly requires a Linux pinned worktree.
  macOS Git inspection reports `git_inspection_unavailable`; this does not discard otherwise
  complete repository instructions. No second Git implementation or pathname worktree fallback exists.
- macOS ordinary workers use `runtime/worker/observed-child.ts`: a daemon-owned live ChildProcess,
  normal code-zero exit, natural EOF on both output streams and absence of the original process
  group are required before releasing the recorded writer. Locally destroyed pipes are not EOF.
  Persisted receipts do not authorize PID signalling; missing live authority after restart/restore,
  abnormal exits or unknown settlement stay blocked. Linux process retirement is unchanged.
- MCP stdio remains Linux-only. Installed Streamable HTTP MCP was exercised on macOS; Docker,
  broader scheduled/protected configurations and arbitrary detached-host-writer recovery are not
  qualified by these ordinary-turn observations.

## Verification and qualification limits

[CI run 39753881066](https://github.com/rullopat/bazilion/actions/runs/39753881066) passed all six
jobs at the exact code candidate above, including Linux/macOS tests/builds, both guarded installed
trials, the existing upgrade matrix and security acceptance.

- **Actual macOS:** hosted macOS **26.6.2 arm64**, Node **24.22.0**. The new capture suite
  (11 tests), live-child ownership suite (7) and CLI/API chat suite (2) ran and passed on that OS.
  The full configured macOS run passed 2,217 tests including the four serial browser tests,
  with 73 existing skips; the broader Linux-only suites remain independently scoped.
- **Installed macOS trial:** fresh-home setup, empty-Team CLI/API/browser chat, then instructed-Team
  CLI/API/browser chat passed. The synthetic provider checked that the actual instructed requests
  contained the Team marker; browser checks required new visible replies and completed NDJSON.
  Installed `fs-safe@0.26.8` and its matching Darwin arm64 addon were observed loaded. Owned closes
  and fixture removal succeeded. This is a guarded scripts-disabled install plus admitted rebuilds,
  not unrestricted npm lifecycle qualification.
  [Installed job](https://github.com/rullopat/bazilion/actions/runs/39753881066/job/119740886298) ·
  [macOS test/build job](https://github.com/rullopat/bazilion/actions/runs/39753881066/job/119740886394).
- **Linux:** local Node 26.12.0 isolated run passed 2,666 tests / 49 existing skips, all 397 required
  security cases, lint, typechecks and build. The private packed CLI trial passed the same empty/
  instructed CLI/API/browser checks plus existing HTTP MCP and Git-backed coding receipt checks.
  CI independently passed on Node 24.22.0.
- **Failures retained, not rewritten:** the first broad local run had seven ownership/cleanup failures.
  A focused cluster and full run in an isolated PID namespace passed; the original cause remains
  undetermined. Initial offline-cache misses, absent SQLite native binding, two test callback type
  errors and a CommonJS Playwright export error were corrected. No production cleanup check was
  relaxed to obtain a pass. The original failed packed trial retained its fixture; a fresh successful
  trial settled and removed its own fixture.
- **Not claimed:** Intel Macs, older macOS versions, macOS Node 26, every filesystem/alias layout,
  Windows, real-provider entitlement, arbitrary detached descendants or all restricted capabilities.
  No global operator runtime/browser changes, paid provider calls, website deployment, version bump,
  merge or publication are part of this qualification.

## Investigation informing the implementation

OpenClaw's workspace reader was reviewed at
[`955669d`](https://github.com/openclaw/openclaw/blob/955669d69147635169709801318dc5f904663163/src/agents/workspace-file-read.ts);
`fs-safe@0.26.8` at
[`5c9d7c1`](https://github.com/openclaw/fs-safe/blob/5c9d7c1b5fbbe19cb1d576a12a5853faced8da51/docs/security-model.md).
MIT-licensed, declared Node `>=22`; native packages are platform-specific optional dependencies.

The initial Linux-only investigation observed 13 cases in native-off and native-required modes,
plus a missing-addon check. Ordinary `Root.read()` stayed best-effort and could succeed even when
native `require` status said package-missing. One-shot Root reads also did not preserve registered-slot
binding or capture-wide source freshness. Accordingly the implementation adds Bazilion-owned
capture checks rather than substituting Root reads or trusting native status. The initial probe
harness needed `NODE_ENV=test` and hardlink-fixture cleanup; those were not library defects.
Registry tarball integrity checks were not a build-provenance audit. Fuller investigation detail
remains in Git history, not a separate progress/evidence archive.

## Release integration

Published 2026-10-23 in [0.24.0](https://github.com/rullopat/bazilion/releases/tag/v0.24.0).
Final six-job CI and actual public Linux guarded-install/library checks passed; the original
qualification limits above remain authoritative. No cryptographic npm build-source provenance is
claimed. Any broader platform/capability qualification needs its own observed contract, not a
blanket support claim from this implementation.
