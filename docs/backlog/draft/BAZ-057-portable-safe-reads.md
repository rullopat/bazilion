---
id: BAZ-057
title: Portable safe reads — repository context off-Linux
status: draft
size: L (likely split)
created: 2026-09-17
priority: undecided
note: Split out of BAZ-049 refinement. The coding sequence is Linux-only today; install.ps1 exists, so Windows operators hit this wall.
---

# BAZ-057 - Portable safe reads — repository context off-Linux

## User stories

- **As an operator on macOS or Windows**, I want to register a repository and run the
  coding sequence on my own machine, so the flagship feature does not require Linux.
- **As a maintainer**, I want a portable primitive with the same guarantees the Linux
  dir-fd pinning gives (ancestry cannot be swapped mid-read, no TOCTOU through
  symlinks), so portability never means a silently weaker boundary.

## Goal

Replace the Linux-only safe-read primitive (`apps/daemon/src/lib/repository-context/files.ts`:
`O_DIRECTORY|O_NOFOLLOW` directory descriptors + `/proc/self/fd/<n>` pinning) with a
portable implementation — or a clearly-scoped per-platform pair — that preserves the
boundary claims BAZ-039/045 made and the receipts that observe them.

## Why

`safe_reads_unavailable` is deliberate: on Linux, reads are pinned through a
directory fd so ancestry is checkable against the registered root with no
symlink-swap window, and the code refuses to fall back to weaker path-based checks.
macOS has `openat`/`F_GETPATH`-adjacent tooling and `resolving symlinks` semantics;
Windows has open file handles by ID and `FILE_FLAG_OPEN_REPARSE_POINT` — neither maps
1:1, and each needs its own proof that the ancestry claim still holds. Shipping
`install.ps1` while the flagship coding sequence is Linux-only is a product gap for
exactly the non-technical operators the installer targets.

## Why not now (as of refinement 2026-09-17)

BAZ-049 locks the honest boundary instead: Linux is the validated coding platform,
off-Linux surfaces `safe_reads_unavailable` cleanly, and the docs state it. This story
exists so the portability work has a holder with the security constraints written down
before anyone reaches for a path-based shortcut. Candidate triggers: a real macOS/Windows
operator needs the coding sequence, or 1.0 decides cross-platform coding is a promise.

## Scope (provisional — refine when triggered)

- Survey per-platform primitives (macOS: dir fd + `fstatat`-equivalents via libuv or
  FFI; Windows: handle-based open with reparse-point refusal) and what ancestry proof
  each can actually give.
- Define the claim each platform's implementation can honestly make, and what the
  receipts should say (`posture` claims must stay per-platform truthful — BAZ-045).
- Decide: one portable primitive with platform backends, or per-platform resolvers
  behind one interface.
- Tests that observe the boundary per platform (swap-a-symlink-mid-read style proofs),
  not just unit-level happy paths.

## Out of scope

- Weakening the Linux implementation to make the code portable.
- A path-based fallback that cannot prove ancestry (explicitly rejected by the
  original design and still rejected here).

## Tests

1. On each supported platform, the ancestry claim made in receipts is observed to
   hold under an adversarial rename/symlink-swap harness.
2. Off-Linux platforms no longer surface `safe_reads_unavailable` for supported
   operations, and still fail closed (visibly) for any operation whose ancestry
   cannot be proven.

## Open questions

- Which platforms are actually in demand (macOS first? Windows at all for coding?)
- Does `openat`-style pinning exist accessibly in Node on macOS without native addons,
  or does this require a small native module (supply-chain and build implications)?
- Does the verification/review container story (docker-dependent) need the same
  portability pass, or is a Linux container runtime acceptable on macOS via a VM?
