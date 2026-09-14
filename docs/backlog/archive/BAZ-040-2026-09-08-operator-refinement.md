---
id: BAZ-040
title: Prepared per-Team coding environments and truthful readiness
status: in_progress
size: L
created: 2026-09-07
refined: 2026-09-08
priority: high
note: Implemented and locally validated 2026-09-09; unpublished changes and release pending.
---

# BAZ-040 — Prepared per-Team coding environments and truthful readiness

> Historical refinement, superseded on 2026-09-09 by the Agent-led stories.
> Frontmatter and completion statements below describe the former scope only.

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
  [BAZ-039](../in_progress/BAZ-039-repository-coding-context.md) can suggest candidates, but reading a repository,
  opening settings, or receiving an Agent message never activates executable hooks automatically.
- Resolve Team selection and `BAZILION_BASH_SANDBOX_IMAGE` through one documented precedence rule.
  An enabled explicit Team image overrides the global default for that Team's Docker execution;
  unset or disabled Teams retain current behavior. Neither setting can weaken mandatory protected
  execution. Disabling configuration invalidates its readiness evidence, not the sandbox policy.
- Centralize effective image/environment/cwd resolution for probe and real turn preparation. Both
  normal Docker and protected paths must use the same selected Team configuration within their
  existing posture; host execution remains visibly separate and cannot supply protected evidence.
- Resolve mutable image tags to immutable image IDs for an execution attempt. Retain existing
  local-image, Unix-socket, mount, image-volume, and executable validation; do not pull during a turn.
- Validate configured environment keys/values against a closed non-secret contract. Reject shell
  startup hooks, credential fields, unsafe path overrides, and Docker/provider control variables.
  Do not inherit image ENV, daemon secrets, user dotfiles, credential helpers, or ambient caches.
- A selected cwd must remain inside the canonical Team execution root and map to its container
  path, including any future managed workspaces. No arbitrary host paths or additional mounts here.

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
  boundaries, using the operator-probe identity defined below. A probe cannot bypass
  shell approval, impersonate another Agent, or fall back to host execution when Docker fails.
- Mark a command requesting unavailable approval as blocked; do not silently reduce approval policy.
  Configuration access and a previous successful probe never grant permission for later execution.
- Prevent probes from racing an Agent or another probe that can mutate the same workspace. Reuse
  applicable lifecycle coordination, and make busy/cancelled/timeout outcomes explicit.
  Existing per-Agent exclusion alone is insufficient for a shared Team root: add the minimal
  canonical-workspace coordination needed for enabled coding Teams and probes in this slice.
  A future story can extend that contract to managed parallel checkouts without blocking finite probes.
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

- Implement after BAZ-039 establishes repository context and command provenance; do not duplicate its
  instruction discovery. Existing runtime preflight remains mandatory independently of this story.
- [BAZ-041](../todo/BAZ-041-coding-command-verification.md) can provide richer live output and durable check
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

## Refinement decisions (2026-09-08)

### Configuration and execution scope

- Deliver one documented Linux Node/pnpm recipe, tested with the repository-required Node 24+
  and pnpm 10+. Pin the actual image/tool versions used in acceptance evidence. Generic locally
  prepared images are configurable, but additional language recipes are outside this story.
- Keep the Team root as the mount and ownership boundary. `cwd` is an existing, non-symlinked
  Team-relative directory (default `.`); map it beneath `/workspace` for each command. It selects
  the default command directory, not a new Team or mount. BAZ-039 resolves its instruction ancestry.
  Agent documents, skills, attachments and the read-only Team-memory mount keep their existing scope.
- Enabled Team image wins over `BAZILION_BASH_SANDBOX_IMAGE`, then the existing built-in default.
  Resolve the chosen tag once per admitted turn/probe set and execute every command with that
  immutable image ID. A tag moving later invalidates readiness for the next admission; it cannot
  change the image midway through an admitted operation.
- Team environment values initially allow only `CI` (true/false), `NO_COLOR` (0/1), and
  `TZ` (`UTC`). Reject all other keys, NUL/newline values, and credentials. Keep the runtime's
  pinned PATH/HOME/TMPDIR/LANG/LC_ALL/SHELL. The recipe places tool executables on that PATH and
  keeps writable persistent caches/dependencies inside the workspace. No arbitrary environment
  passthrough or configurable extra mounts. Host turns do not inherit this Docker configuration.
- Save up to 16 named checks, each with a stable id, kind (`runtime`, `dependency`, `build`, `test`),
  exact command (max 4 KiB), contained cwd, timeout (1–300 seconds), and optional BAZ-039 provenance.
  Runtime expectations are display metadata backed by an explicitly selected probe, never an
  automatic version command. Each readiness selection names the required runtime/dependency checks;
  optional build/test outcomes remain individually labelled and are not code-verification badges.
- Configuration writes use expected-revision compare-and-swap and return 409 on stale input.
  Every change increments the environment revision. Editing or enabling configuration never runs it.
  Disabled/unconfigured Teams cannot launch probes; no automatic installation or image pull.

### Operator probes and lifecycle

- A probe is an authenticated operator action on a Team, not an Agent turn. It uses a daemon-minted
  attempt id bound to operator credential/session identity, Team/root identity, environment revision,
  exact ordered check ids/commands/cwds, Docker image ID, and cancellation controller. The request
  must name the reviewed environment revision; changed configuration is rejected before execution.
  It has no model, provider credentials, Agent identity, message, or Team Policy communication edge.
- This first slice runs probes only in protected-equivalent Docker isolation, including the
  dangerous-command classifier and mount/environment policy. Ordinary local Docker Agent turns
  use the same environment resolver under their existing shell-approval mode; protected Agent
  turns retain their mandatory dangerous-command gate. Host execution remains separately labelled
  and never supplies Docker readiness evidence.
- Reuse shell operations and the approval wrapper rather than spawning a privileged daemon shell.
  The probe has no interactive shell-approval bridge in this slice: a classified dangerous command
  is `blocked: approval_unavailable` before execution. Clicking Run or saving the command does not
  count as dangerous-command approval. Existing Agent chat approvals are unaffected. Adding a
  probe-specific approval dialog is later work, not a dependency of finite safe readiness probes.
- Run the selected checks sequentially, each in a fresh container, at most 10 minutes for the set.
  Stop at the first failure, blocked check, timeout or cancellation; show remaining checks as not
  executed. No hidden queue or automatic retry. Cancellation must terminate/reap the active
  container before releasing workspace ownership. A browser disconnect does not cancel an accepted
  attempt; its status is inspectable and it remains bounded by the same deadline.
- Register all admitted mutating Agent turns against their canonical workspace, including Teams
  whose environment is disabled. When either contender belongs to an enabled coding Team or is
  a probe, allow only one writer for overlapping canonical roots (equal or ancestor/descendant),
  across different Agents and Team aliases. Hold ownership through the entire turn/probe teardown,
  including paused questions, rather than just individual Bash calls. Per-Agent exclusion remains.
- Enabling/configuring/deleting a coding Team must coordinate with active workspace owners; return
  a visible busy conflict rather than mutate an in-use environment. New interactive turns/probes
  receive busy; existing scheduler/inbox/follow-up mechanisms retain their own deferral behavior.
  Do not create another scheduling queue. Atomic admission prevents simultaneous claims.
- This coordinates Bazilion-owned writers, not editors, other processes, hard-link aliases or remote
  filesystems. Keep that limit visible. On daemon restart reconcile interrupted probe containers
  using daemon-owned identities; terminate/reap them before admitting overlapping work. If cleanup
  cannot be established, keep that workspace blocked pending recovery. Never replay a lost attempt.
  Extend existing worker cleanup/recovery for Agent owners where needed; restart alone is not proof
  that a previous writer has stopped.

### Evidence and freshness

- Separate context availability (039), environment configuration, measured runtime/dependency
  readiness (040), and future code-check applicability (041/042). A successful probe says the
  selected commands exited zero under the recorded environment at that time; it does not say the
  current source passed tests. Display build/test exits as historical command outcomes only.
- Persist narrow probe attempts with per-check outcomes: pending/running/succeeded/failed/blocked/
  timed_out/cancelled/interrupted, observed exit code when available, termination reason, timestamps,
  identities above, and capped diagnostics. Unacknowledged termination is interrupted/unknown,
  never success. Cap combined output at 64 KiB per check and 256 KiB per attempt; keep a bounded
  tail with truncation indicated, redacting known runtime secrets before storage or presentation.
  Render control bytes/HTML inert. Full streamed/retained command logs belong to BAZ-041.
- Freshness inputs include canonical root, context source fingerprints, config/check revisions,
  resolved image ID, and bounded hashes of applicable manifests/lockfiles (reuse 039 path rules;
  additionally include `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, up to 4 MiB total).
  Missing, unsafe or over-limit inputs yield unknown freshness. No recursive node_modules hashing.
- Measured readiness expires after 15 minutes, or immediately on a known input change, restore,
  or daemon restart. Always show when it was measured and that dependency files/external writers
  can change without detection. Never re-probe during a status read or turn admission. A stale or
  absent measurement is informational, not an extra automatic Agent execution gate; actual runtime
  preflight and complete applicable instructions are still required.
- Keep at most 20 terminal attempts per Team and expire them after 7 days; active attempts are
  bounded separately and never silently evicted. No manual durable publication or generic history
  service. Configuration and retained receipts belong to the canonical schema and backup; restored
  active attempts become interrupted and all restored evidence is stale. Team deletion cascades
  after active work is stopped. Diagnostic access is authenticated operator management access;
  these are operator-requested probes, not a way to publish Agent-held output or bypass egress.

### API and client agreement

- Use `/api/teams/:id/coding-environment` for GET/PUT configuration and passive status,
  `/api/teams/:id/coding-environment/probes` for POST start / GET retained attempts, and
  `/api/teams/:id/coding-environment/probes/:probeId` for GET details with `/cancel` POST.
  Start returns 202 plus the attempt reference; stale revision or busy workspace returns 409.
  Reject foreign-Team attempt ids. Mutations keep existing device/session auth and CSRF gates.
- CLI: `bazilion team environment show|configure|check|history|cancel <slug>` with JSON parity.
  `check` requires exact check selection and expected revision; web shows the same reviewed command
  list before starting it. Web polls bounded status, exposes cancellation and reasons, and separates
  passive configuration from measured readiness. Telegram operators configure/check through the
  authenticated gateway; a new Telegram probe-command protocol is outside this slice.
- Store wire types in `@bazilion/api-types` and share HTTP access through the client. Reuse the
  command-definition and termination vocabulary in BAZ-041 later; do not invent code-snapshot ids
  here. Importing a 039 suggestion copies a reviewed command; source changes flag provenance without
  changing that command or renewing execution permission.

### Delivery and acceptance evidence

1. Add revisioned Team settings and the shared effective-environment resolver; test global fallback,
   disabled behavior and exact image/cwd/env equivalence across probes and Docker Agent execution.
2. Add workspace admission/recovery, finite operator probes and narrow evidence. Prove exclusion
   across two Agents, aliases and overlapping roots, cancellation teardown, restart recovery,
   dangerous-command denial, and unchanged normal Agent authorization.
3. Add API/CLI/web parity and the prepared Node/pnpm recipe. On a disposable linked repository,
   show missing-runtime failure, prepare dependencies explicitly, then run successful runtime and
   dependency probes plus a finite test command in separate fresh containers. Demonstrate dependency
   reuse without host caches/network and changed-lockfile/image/config/age staleness.
4. Verify that a private-gateway/Telegram-origin Agent uses the same prepared environment as the
   probe using a fake provider and fake Telegram ingress. No live messages or personal home data
   are needed. Include restore, output limits/redaction, busy and unsupported-service scenarios.
5. Run relevant tests, root/web typechecks, lint, and the security acceptance gate before release.
   Record evidence per acceptance criterion. BAZ-041/042's persistent diffs and code verification
   remain a later milestone, not a claim made by this story's readiness view.

No unresolved product decisions remain for this slice. It remains L because shared-workspace
admission and recovery are required for truthful probes; persistent services, expanded approval UX,
and additional environment orchestration must be separate stories rather than absorbed here.

Implementation checkpoints and acceptance evidence: [BAZ-040 progress](../BAZ-040-progress.md).
