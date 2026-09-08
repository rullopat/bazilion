---
id: BAZ-040
title: Prepared per-Team coding environments and truthful readiness
status: draft
size: L
created: 2026-09-07
priority: high
note: Refine Team/global configuration precedence and explicit probe execution before moving to todo.
---

# BAZ-040 — Prepared per-Team coding environments and truthful readiness

## User stories

- **As an operator assigning coding work**, I want to know whether the actual execution environment
  has the required runtime and dependencies, so an Agent does not discover basic blockers mid-task.
- **As an operator using Telegram or the private web gateway**, I want a prepared project toolchain
  inside the protected environment, so successful commands do not depend on my desktop's setup.
- **As an operator reviewing readiness**, I want configuration, measured checks, and stale evidence
  clearly distinguished, so “ready to run tests” never implies that the tests passed.

## Goal

Configure a prepared coding environment per Team and show readiness for editing, building, and
running finite checks under the same execution posture an Agent will actually receive. Preserve
fresh, network-disabled Docker commands in the first slice. Environment preparation remains an
explicit operator activity; the Agent does not gain a privileged installation or networking tool.

## Why and current baseline

The [invocation resolver](../../../apps/daemon/src/lib/turn-invocation.ts) selects the configured
surface only for operator HTTP without `BAZILION_PUBLIC_ORIGIN`; Telegram, background work, and
private-gateway HTTP use protected execution. A command working on the host proves little about
the container available to the user's normal Telegram workflow.

[Shell configuration](../../../apps/daemon/src/runtime/shell/security.ts) currently selects one
global image, defaulting to `debian:bookworm-slim`. Protected
[preparation](../../../apps/daemon/src/lib/protected-execution.ts) uses that setting, while Docker
[preflight](../../../apps/daemon/src/runtime/shell/docker.ts) proves the required Bash/environment
executables, pinned image, mounts, and isolation. It does not establish project toolchain readiness.

Each Bash call gets a fresh container with a read-only root, no network, a 64 MiB temporary directory,
scrubbed environment, and a writable Team workspace. Image-provided environment variables are
discarded; workspace dependencies can persist, while container temporary files and processes cannot.
The [existing status projection](../../../apps/daemon/src/lib/execution-security-status.ts) and
[web card](../../../apps/web/src/components/ExecutionSecurityCard.tsx) report base-runtime readiness.
Extend that distinction instead of replacing it with an unqualified “coding ready” badge.

## Scope

### Reviewed Team configuration

- Add a daemon-owned, revisioned Team coding-environment configuration: enabled state, locally
  installed image reference, expected runtimes, bounded non-secret environment values, contained
  working-directory selection, and named probe/build/test commands with time/output bounds.
- Commands and runtime expectations are operator-reviewed configuration. Repository manifests and
  [BAZ-039](BAZ-039-repository-coding-context.md) can suggest candidates, but reading a repository,
  opening settings, or receiving an Agent message never activates executable hooks automatically.
- Resolve Team selection and `BAZILION_BASH_SANDBOX_IMAGE` through one documented precedence rule.
  Proposed default: an explicit Team image overrides the global default for that Team's Docker
  execution; unset Teams retain current behavior. Confirm operator-global override expectations
  before todo. Neither setting can weaken mandatory protected execution.
- Centralize effective image/environment/cwd resolution for probe and real turn preparation. Both
  normal Docker and protected paths must use the same selected Team configuration within their
  existing posture; host execution remains visibly separate and cannot supply protected evidence.
- Resolve mutable image tags to immutable image IDs for an execution attempt. Retain existing
  local-image, Unix-socket, mount, image-volume, and executable validation; do not pull during a turn.
- Validate configured environment keys/values against a closed non-secret contract. Reject shell
  startup hooks, credential fields, unsafe path overrides, and Docker/provider control variables.
  Do not inherit image ENV, daemon secrets, user dotfiles, credential helpers, or ambient caches.
- A selected cwd must remain inside the canonical Team execution root and map to its container
  path, including BAZ-043 workspaces later. No arbitrary host paths or additional mounts here.

### Readiness information and explicit probes

- Show configured expectations, the actual execution posture, selected image, and known constraints
  without executing project code. Distinguish **not configured**, **not checked**, **checking**,
  **ready for the selected operation**, **blocked**, and **stale** with concrete reasons.
- Check passive facts such as manifest/lockfile presence and configured paths separately from
  execution. Files existing or a lockfile being present does not prove dependencies are usable.
- Run commands only after an explicit authenticated operator request naming the Team, intended
  posture, and reviewed check set. Display the exact commands first; no scheduled background
  probing, model-selected bootstrap commands, or automatic package-manager invocation.
- Execute bounded probes through the established shell/isolation and dangerous-command approval
  boundaries. Define their concrete execution identity before implementation. A probe cannot bypass
  shell approval, impersonate another Agent, or fall back to host execution when Docker fails.
- Mark a command requesting unavailable approval as blocked; do not silently reduce approval policy.
  Configuration access and a previous successful probe never grant permission for later execution.
- Prevent probes from racing an Agent or another probe that can mutate the same workspace. Reuse
  applicable lifecycle coordination, and make busy/cancelled/timeout outcomes explicit.
  Existing per-Agent exclusion alone is insufficient for a shared Team root: add the minimal
  canonical-workspace coordination needed for enabled coding Teams and probes in this slice.
  BAZ-043 can extend that contract to managed parallel checkouts without blocking finite probes.
- Record narrow evidence: check identity and revision, execution posture, workspace identity,
  resolved image, environment revision, relevant manifest/lockfile identity, timestamps, exit status,
  and bounded safe diagnostics. Keep no second transcript or general runs/events subsystem.
- Invalidate evidence when known inputs change; show its time and scope without guaranteeing that
  mutable dependencies or external conditions stay valid.
- Separate runtime/dependency probes from optional full build/test commands. **Ready to run tests**
  means the selected test environment is available; only actual check execution can report pass/fail.
- Provide HTTP/CLI/web configuration/status/check parity; ordinary diagnostics never run commands.

### Preparation and supported limits

- Document how the operator supplies an already-built local toolchain image and prepares dependencies
  in the approved workspace. Preparation may require downloads or installation, but it is a separate
  explicit operator step, not an automatic privileged phase of Agent or probe execution.
- Explain which dependency locations persist between commands and which do not. Keep dependency
  artifacts inside the selected workspace or prepared image; no mount of a shared credential-bearing
  host package cache. Images must not bake credentials into layers or project defaults.
- Report missing runtimes, incompatible dependencies, unwritable cache paths, insufficient temporary
  space, unavailable local services, and network-required checks as actionable limitations.
- Preserve the current network-disabled, fresh-container execution and scrubbed environment. A test
  requiring a database, network service, or browser that is absent is **blocked/unsupported here**,
  not a reason to weaken the sandbox or silently skip it and report success.
- Cover configuration and narrow evidence in the canonical clean-install schema/backup contract.
  A restored configuration must revalidate local image/workspace availability; backup metadata alone
  cannot recreate Docker images, externally linked directories, or a previously measured environment.

## Acceptance criteria

1. Two Teams can select different prepared images without changing each other's effective execution;
   the documented global fallback remains intact and protected invocation rules cannot be disabled.
2. A status read performs no project-command execution. Probes require an explicit request, retain
   approval/isolation boundaries, and cannot race mutating work in the selected workspace.
3. Probe and Agent execution use the same effective image ID, cwd mapping, allowed environment, and
   posture. Missing images or credentials never trigger host fallback or automatic installation.
4. Readiness reports its scope and measured inputs. Changed configuration/image/lockfile/root and
   restored state become stale or unverified; test success requires an actual successful test check.
5. Workspace dependencies remain usable across fresh commands when compatible; temporary-directory
   state is never assumed to persist. Missing tooling/services/network yields an actionable blocker.
6. Non-secret settings and diagnostics cannot expose daemon/provider credentials or enable shell
   startup hooks. Commands from manifests are never executed merely because they were discovered.
7. Web/CLI expose consistent configuration, progress, cancellation, stale state, and safe diagnostics.

## Dependencies and sequencing

- Refine after BAZ-039 establishes repository context and command provenance; do not duplicate its
  instruction discovery. Existing runtime preflight remains mandatory independently of this story.
- [BAZ-041](BAZ-041-coding-command-verification.md) can provide richer live output and durable check
  evidence later. It is optional for bounded readiness probes; neither story depends on the other's
  completed UI. Agree shared command identity and result shapes before implementing overlapping code.
- First deliver Team selection, passive status, finite probes, and preparation guidance. Split
  additional orchestration if refinement exceeds L.

## Out of scope

Persistent containers/services, dev-server supervision, preview/public ports, network allowlisting,
automatic image builds/downloads, dependency-update automation, arbitrary devcontainer lifecycle
hooks, host credential forwarding, remote Docker, and a general environment orchestration engine.

## Tests

- Resolver tests cover Team/global precedence, immutable image binding, unset Teams, contained cwd,
  environment rejection, posture differences, and no host fallback.
- Integration tests cover passive reads, explicit probes, shell denial, busy workspaces, cancellation,
  timeout/output bounds, missing/incompatible dependencies, temporary-state loss, and absent services.
- Use an isolated prepared test image to compare readiness and real command execution; verify no
  network, hidden mounts, image ENV, or credentials become available through the new configuration.
- Check staleness after configuration/image/workspace/lockfile changes and restore. Verify CLI/web
  parity, secret-safe diagnostics, applicable typechecks, and the protected security acceptance gate.

## Open Questions

- **Configuration precedence:** should the global image remain an operator-enforced override or a
  fallback? Recommend explicit Team override plus global fallback, with effective values visible.
- **Probe identity and locking:** select the existing execution/approval context used by an
  operator-requested check. Recommend a daemon-bound check identity with the same shell gate and
  workspace coordination, rather than creating a synthetic model turn or privileged shell path.
- **Initial toolchains/environment:** recommend one Node/pnpm recipe, generic operator-supplied
  images, and a closed non-secret key contract; refine the supported set before todo.
- **Evidence freshness:** choose dependency identity checks and an age policy without claiming a
  lockfile proves an intact installation. Recommend input-bound evidence plus an explicit recheck.
