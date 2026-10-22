---
id: BAZ-057
title: Portable safe reads — repository context off-Linux
status: draft
size: L (likely split)
created: 2026-09-17
priority: undecided
note: fs-safe investigation completed 2026-10-22. Candidate building block, not an admitted replacement; implementation and macOS/Windows qualification remain outstanding.
---

# BAZ-057 — Portable safe reads — repository context off-Linux

## User stories

- As an operator on macOS or Windows, I want Bazilion to prepare repository instructions
  safely on my machine without requiring a weaker filesystem boundary.
- As a maintainer, I want explicit, tested per-platform guarantees and visible refusal when
  an operation cannot satisfy them, rather than an unsupported promise of equivalent safety.

## Goal

Support bounded repository-context inspection on a selected additional operating system,
using reusable public filesystem APIs where possible. Preserve the existing Linux path
until an alternative demonstrates the required behavior.

This is **not complete cross-platform Agent-turn support**. Owned process retirement, MCP
stdio, hardened Git inspection and other platform-dependent capabilities have separate
constraints. Passing repository-read checks must not enable those capabilities implicitly.

## Current contract

`apps/daemon/src/lib/repository-context/files.ts` retains Linux directory descriptors and
uses `/proc/self/fd` for child access. Nested symlinks, special files and unsafe targets are
refused; a deliberately registered root symlink is supported. Reads have byte limits and
before/after file-stamp checks. Before accepting a combined report, Bazilion revalidates the
registered root, retained child identities and previously observed files, including absence.

These are pinned reads and change detectors, **not an atomic filesystem snapshot or a
universal guarantee against every concurrent rename**. Unsupported platforms currently
report `safe_reads_unavailable`; no weaker pathname fallback is admitted.

## Investigation outcome (2026-10-22)

**Decision: evaluate a narrow Bazilion-owned adapter over `@openclaw/fs-safe`; do not replace
`ContextDirectory` with `Root.read()` or add a production dependency yet.**

Reviewed OpenClaw's workspace reader at
[`955669d`](https://github.com/openclaw/openclaw/blob/955669d69147635169709801318dc5f904663163/src/agents/workspace-file-read.ts)
and its pinned `@openclaw/fs-safe@0.26.8`, source revision
[`5c9d7c1`](https://github.com/openclaw/fs-safe/blob/5c9d7c1b5fbbe19cb1d576a12a5853faced8da51/docs/security-model.md).
The library supplies useful no-follow/identity checks, bounded reads, exact bigint identities
and platform-specific native machinery. It does not supply Bazilion's whole capture contract.

### API and behavioral differences

| Requirement | Finding |
| --- | --- |
| Containment admission | Public `Root.open/read` results report `best-effort`, including with native mode `require` and the addon loaded. The direct native Linux `openBeneath` mechanism can report `kernel-atomic`; that is not the ordinary Root read API's contract. Upstream documents macOS/Windows native containment as best-effort too. |
| Native admission | With the addon hidden and mode still `require`, status reported `package-missing` but ordinary `Root.read()` still succeeded as `best-effort`. Native mode is operation-specific; callers must enforce their actual admission contract, not trust the mode label alone. |
| Registered-root binding | Retargeting a registered symlink leaves a library Root reading its original canonical target. Bazilion additionally rejects that changed registration at final validation. Preserve both the selected object and the registration binding. |
| Combined report freshness | Separate library reads may validly return different file generations. Bazilion must retain and revalidate its own observed file/directory identities and stamps across instruction and command discovery, including missing files and bounded listings. |
| Child directory replacement | A later Root read follows an admitted replacement child. A retained Bazilion directory still reads its original child and final validation rejects the replacement. One-shot reads are not an equivalent capture API. |
| Missing files | Library reads throw `not-found`; Bazilion records absence and returns null. An adapter must preserve absence revalidation, not merely translate an error. |
| Hardlinks | The library rejects hardlinks by default; the current Bazilion reader does not. This is an explicit policy difference, not a reason to disable library protections silently. |
| Identity and resource ownership | Use exact bigint identities and refuse persistent unknown identities. Preserve byte/depth/entry limits, nonblocking special-file rejection, source-change checks and deterministic closure on every refusal. |

The public advanced API includes directory identity checks, pinned file opens and
[`createRootFileOpenBatchSync`](https://github.com/openclaw/fs-safe/blob/5c9d7c1b5fbbe19cb1d576a12a5853faced8da51/src/root-file-open-batch-sync.ts).
Its retained native-root optimization is Windows-specific and conditional; other paths
retain ordinary per-open admission. `retainFileInDirectory` is a separate Windows NTFS
file-retirement capability, not a portable repository-directory reader. Do not reach into
private native bindings or internal package paths to bypass the public contract.

### Packaging and platform constraints

- MIT license; declared Node requirement is `>=22`, compatible with Bazilion's declared
  runtime ranges. Only Node 26.12.0 on Linux x64/glibc was exercised in this investigation.
- The core has no mandatory JavaScript dependencies. Native support uses matching optional
  OS/CPU/libc packages; JSZip is optional archive functionality, not needed for these probes.
- The inspected core and Linux x64/glibc addon total about 8.75 MB unpacked. Published tarballs
  were checked against registry SHA-512/SHA-1 metadata; this is not a build-provenance audit.
  No install scripts, native builds or package-manager installation were run.
- Adoption needs explicit daemon and packed-CLI dependency/externalization checks. Do not assume
  source imports prove the published CLI contains the matching native package. Keep the adapter
  daemon-only; API types and clients must remain hermetic.
- `lib/git/capture.ts` consumes `ContextDirectory` and passes the pinned worktree to Git through
  `/proc/<daemon-pid>/fd/<root-fd>`. A file-reader port does not port this interface. Keep the one
  hardened Git implementation and report Git unavailable until an equivalent path is qualified.

### Bounded local observations

- Existing repository-context suite: **33 passed**, unchanged.
- **13 synthetic probe cases in each of two modes** (`off` and `require`): all expected outcomes
  observed on Linux x64/glibc, Node 26.12.0. Native status confirmed the addon loaded in `require`.
  One additional missing-addon probe observed successful best-effort reading despite `require`;
  no native-only admission was established by that read.
- Probes covered normal reads, initial root links, nested/leaf links, size limits, FIFO refusal,
  missing files, hardlinks, root replacement, registered-slot retargeting, file/child replacement
  across reads and a deterministic resolution-to-open symlink substitution. That substitution
  was refused without returning the synthetic outside bytes.
- Two initial harness errors were corrected: the upstream fault hook requires `NODE_ENV=test`,
  and the hardlink case needed cleanup before reusing its synthetic target. These were fixture
  errors, not library defects; later passes do not relabel those initial attempts as successful.
- Packages and probes stayed in a temporary directory; execution used a network-isolated,
  restricted-filesystem sandbox. No application code, dependency manifest or lockfile changed.
  No macOS, Windows, Node 24, packed-install or broader Agent-turn qualification is claimed.

## Next implementation scope — still to refine

1. Select the first target OS and obtain a real test environment. Do not simulate a platform
   by changing `process.platform` and call that native qualification.
2. Prototype a read-only capture adapter using public library APIs. Preserve registration
   binding, ancestry/absence/source revalidation, exact bytes/digests, limits and error behavior.
   Do not weaken the existing Linux implementation or assume native `require` selects an atomic read.
3. Define the supported filesystem/alias cases and honest per-platform guarantees. Refuse
   unsupported cases rather than silently accepting a weaker posture.
4. Handle the shared hardened Git reader's pinned-worktree dependency separately; do not add
   a second Git inspection path or claim Git availability from successful instruction reads.
5. Validate source and packed-CLI behavior before enabling any new platform capability.

## Acceptance criteria

- Registered root links work; retargeting or root/child replacement is detected before report
  acceptance. Nested links, traversal, special files and unsupported aliases remain refused.
- Adversarial rename/symlink substitutions and observed file creation/replacement/editing cannot
  become a complete report with stale provenance. Include changes between reads and final validation.
- Existing instruction/source/report limits and exact-byte hashing remain intact; overflow never
  becomes a silently truncated success. Absent files and directory listings remain bounded evidence.
- Identity uncertainty, missing native capability where required, cancellation and read failure
  release owned resources and produce truthful unavailable/incomplete states.
- Linux regressions and actual target-platform adversarial tests pass. Packed installs resolve the
  intended package/native policy without runtime downloads or private API imports.
- Repository instructions, passive Git availability and Agent-turn platform support are reported
  independently. No result is advertised as a general sandbox or atomic namespace snapshot.

## Open questions

- Which platform and filesystems should be supported first, and where can they be exercised?
- Can public library APIs plus capture-wide validation meet the chosen admission contract, or is
  a narrowly scoped upstream API addition needed? A new Bazilion native module is not the default.
- Which remaining Git/process/container capabilities would still block a useful local coding turn?
