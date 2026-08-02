---
id: BAZ-006
title: Skill execution security - sandbox and command approval
status: done
size: L (1-2 weeks)
created: 2026-05-29
refined: 2026-08-01
shipped: 2026-08-02
priority: high
note: BAZ-008 shipped the static SKILL.md content scan. BAZ-006 adds independent default-off Docker isolation and dangerous-command approval controls; both are complete and awaiting release.
---

# BAZ-006 - Skill execution security - sandbox and command approval

**Status:** Done. Unreleased.

Bazilion's skill model is prompt-only: a `SKILL.md` under `~/.bazilion/skills/<name>/`
is represented in the agent prompt, and any procedural work happens through the
agent's normal tools. BAZ-008 scans skill content at import, list, and attach
time. The default runtime remains intentionally compatible: with shell sandboxing
off, Pi's host coding tools and merged worker environment behave as before. Slice A
now adds an opt-in Docker boundary that replaces that coding surface rather than
pretending the Team `cwd` alone is confinement.

This BAZ adds the remaining runtime boundary in two independently testable slices: an opt-in
container-isolated shell runner first, followed by an optional dangerous-command approval
tripwire. The controls apply to all
agent `bash` invocations, not only "skill scripts", because once a skill is in
the prompt there is no reliable runtime provenance marker that says a specific
shell command came from the skill rather than the model's ordinary reasoning.

**Dependency:** BAZ-008 is shipped. This work sits on top of:

- `apps/daemon/src/runtime/pi/session.ts`, where Bazilion builds the Pi session
  and selects the host or Docker coding-tool surface.
- `@earendil-works/pi-coding-agent`'s `createBashToolDefinition`, `BashOperations`,
  and `BashSpawnHook`, which allow Bazilion to override the built-in `bash`
  implementation by registering a custom `bash` tool with the same name.
- `apps/daemon/src/runtime/worker/*`, whose IPC channel already proxies
  messaging, USER.md, browser, and MCP calls between the worker and daemon.

## User stories

- **As an operator importing third-party skills**, I want runtime shell commands
  to run without my host secrets in their environment, so a malicious prompt or
  compromised skill cannot simply print provider keys or OAuth tokens.
- **As an operator using agents on real projects**, I want an opt-in hard
  sandbox for `bash` that exposes only the writable Team workspace plus bounded
  read-only memory, input, and attached-skill mounts, so a command cannot read
  `~/.ssh`, `~/.aws`, `~/.bazilion/auth.json`, or the Bazilion DB.
- **As an operator who wants a tripwire, not a full cage**, I want risky shell
  commands to pause for approval in the web and CLI chat flows, so I can allow
  a deliberate migration/install/delete while blocking accidental credential
  reads or `curl | sh` style execution.

## Goal

Ship a default-off runtime hardening layer for agent shell execution:

- `bash` can be run through a sandbox backend that receives a scrubbed
  environment and a narrow filesystem mount.
- high-risk commands are classified before execution and can require explicit
  approval in interactive web/CLI turns.
- non-interactive turns fail closed instead of hanging when approval would be
  required.
- existing behaviour is unchanged when both controls are disabled.

## Why

BAZ-008 reduced the chance of installing a poisoned skill, but it did not change
what an already-running agent can do. The current worker subprocess is isolated
from SQLite handles, but it still inherits the merged config/secrets envelope and
pi's local bash backend. Any prompt-injection path that reaches `bash` can ask
the shell to read local credential files, enumerate env vars, or run network
installers.

Per-agent skill selection does not solve this. Selection changes prompt
curation and token use; it is not a capability boundary. Runtime security has
to live at the tool execution layer.

## Decisions

1. **Scope is all `bash`, not only skills.** The runtime cannot reliably
   attribute a shell command to a specific skill prompt, so the policy wraps
   the `bash` tool itself.
2. **Default off.** Existing installs and local workflows keep today's
   behaviour until the operator enables sandboxing and/or approval.
3. **Hard sandbox backend is Docker for v1.** When sandboxing is enabled, run
   commands in an ephemeral container with the Team directory at `/workspace`
   read/write, its `memory/` subtree read-only, Agent inputs at `/inputs`
   read-only, and attached skill directories under `/skills/` read-only. The
   container gets a scrubbed env, no Bazilion home mount, and no network. Recursive bind
   propagation is disabled, image-defined environment values are discarded, and images with
   Docker `VOLUME` declarations are rejected. Only a local Unix-socket Docker context is
   accepted. If Docker or the configured local image is unavailable, fail closed with a
   clear operator-facing error instead of pulling or falling back to host
   execution.
4. **Approval is separate from sandboxing.** Operators can enable the tripwire
   without enabling Docker. Approval decides whether a risky command may run;
   sandboxing decides where it runs.
5. **Non-interactive turns auto-deny.** Scheduled triggers, future
   reviewer/background forks, and any caller without an approval response path
   must receive a denied tool result rather than block forever.
6. **A Docker shell alone is not a filesystem sandbox.** Pi's built-in
   `read`/`edit`/`write`/`grep`/`find`/`ls` tools accept absolute host paths; their `cwd` is a
   default, not a confinement boundary. When Docker sandbox mode is enabled, Bazilion therefore
   removes those host-backed coding tools from the active tool set and exposes the custom
   containerized `bash` plus Bazilion's already-scoped tools. Dedicated container-backed file
   tools can be added later without weakening the initial boundary.

## Delivery slices

### Slice A - container isolation foundation (complete)

- Strict default-off shell policy, structured risk classification, and scrubbed container-env
  construction are implemented in `runtime/shell/security.ts`.
- Docker mode replaces `bash` by name with Bazilion's Docker-backed Pi tool and removes
  `read`/`edit`/`write`/`grep`/`find`/`ls` as well as Pi's host `bash`; no absolute-path host-tool
  bypass remains.
- Each command gets a fresh container with the Team workspace read/write, memory/inputs/attached
  skill directories read-only, a read-only root, tmpfs `/tmp`, host uid/gid, dropped capabilities,
  and network disabled. Recursive bind propagation is disabled, so nested host mounts are not
  carried into the container.
- Attached `SKILL.md` bodies are injected into the prompt with the matching runtime directory:
  the installed host directory in off mode or that skill's `/skills/...` mount in Docker mode.
- Service configuration, doctor visibility, fail-closed diagnostics, abort/timeout cleanup, and
  opt-in Docker isolation tests are implemented. The image is local-only (`--pull never`), with
  `debian:bookworm-slim` as the default; the operator must pull it explicitly before use. The
  runner pins the image id, discards image `ENV`, and rejects image `VOLUME` declarations.

### Slice B - dangerous-command approval (complete)

- Turn-scoped worker/daemon approval IPC, interactive web and TTY CLI responses, timeout and
  cancellation cleanup, reload recovery, and non-interactive auto-denial are implemented.
- Shell-command approval remains ephemeral and separate from durable Team Policy communication
  approvals.

## Scope

### 1. Bash policy and risk classifier

- Add a small runtime module, e.g. `apps/daemon/src/runtime/shell/security.ts`,
  with:
  - `classifyBashCommand(command): CommandRisk[]`
  - `buildScrubbedShellEnv(env): NodeJS.ProcessEnv`
  - policy resolution from config/env.
- Classify at least these risky patterns:
  - reads of sensitive paths: `~/.ssh`, `~/.aws`, `~/.gnupg`, `auth.json`,
    `bazilion.db`, `.env`, provider key names;
  - destructive broad writes/deletes: `rm -rf /`, `rm -rf ~`, recursive deletes
    outside the team directory, chmod/chown across home/system paths;
  - shell-pipe installers and remote execution: `curl ... | sh`, `wget ... | bash`;
  - outbound upload/exfil commands: `curl -X POST`, `scp`, `rsync`, `nc`, `sftp`
    when pointed outside localhost;
  - privilege escalation: `sudo`, `su`, `security find-generic-password`,
    `gcloud auth`, `aws configure`, credential-helper access.
- Keep classifier output structured: `code`, `severity`, `message`, and the
  matched command span or normalized command text when feasible.

### 2. Custom pi `bash` wrapper

- In Docker mode, `createBazilionSession` replaces Pi's built-in `bash` definition
  with a custom tool of the same name built with `createBashToolDefinition`.
  Pi's host-backed `read`, `edit`, `write`, `grep`, `find`, `ls`, and `bash` are
  all absent in that mode. With sandboxing off, the complete existing Pi coding
  surface remains unchanged.
- Slice A's Bazilion `BashOperations` implementation executes through Docker
  while preserving Pi's stdout/stderr streaming, timeout, abort, exit-code, and
  truncation behavior.
- The approval wrapper invokes the classifier before execution and requests a one-shot daemon
  decision when policy requires it. A denial is returned as a model-visible tool error before the
  host or Docker backend can execute.

### 3. Docker sandbox backend

- Implement an ephemeral Docker runner for `bash` when sandbox mode is enabled:
  - image: configurable, default `debian:bookworm-slim`, local-only via `--pull never`, resolved
    to an immutable id; it must provide `/bin/bash` and `/usr/bin/env` and declare no `VOLUME`s;
  - workdir: `/workspace`;
  - mounts: Team directory to `/workspace` read/write; `/workspace/memory`, optional Agent
    `/inputs`, and attached `/skills/...` directories read-only; recursive bind propagation off;
  - env: scrubbed allowlist only (`PATH`, `HOME`, locale, shell basics, plus
    explicit operator-configured variables); image-defined `ENV` is discarded before execution;
  - home: temp/in-container home, not host `~`;
  - root filesystem: read-only, with a bounded tmpfs `/tmp`;
  - network: disabled for v1;
  - lifecycle: container removed after command; abort kills container/process.
- Surface clear errors for missing Docker, missing image, mount failures, and
  commands that need tools not present in the image.
- Add config fields under the existing `/config` service registry, such as:
  - `BAZILION_BASH_SANDBOX=off|docker`
  - `BAZILION_BASH_SANDBOX_IMAGE=<image>`
  - `BAZILION_BASH_SANDBOX_ENV_ALLOWLIST=<comma-separated names>`
- `BAZILION_BASH_APPROVAL=off|dangerous` selects the independent approval tripwire.

### 4. Approval flow

- Extend worker IPC with an approval request/reply method, e.g. `bashApproval`.
  The worker asks the daemon whether a classified command may run.
- Extend `ChatFrame` / `SessionEvent` with a command-approval event that web
  and CLI can render while the stream stays open.
- Add a daemon-side pending approval registry keyed by turn id + tool call id,
  with timeout and cancellation cleanup.
- Add an authenticated endpoint for approval responses. Web uses it from the
  chat pane; CLI prompts on stdin and posts the response.
- Denied commands return a tool error result explaining which policy blocked
  them. Approved commands run exactly once and record the decision in the turn
  stream.
- For non-interactive callers, set approval mode to auto-deny before spawning
  the worker.

### 5. Operator visibility

- `bazilion doctor` and the shared service configuration surface show both shell-security controls.
- Approval decisions log Agent id, Team id, turn/tool ids, risk codes, and terminal status without
  logging the command, matched text, secret values, or environment.

## Out of scope

- Static `SKILL.md` scanning. Shipped in BAZ-008.
- Skill signing or trusted registry semantics.
- Changing per-agent skill selection. It remains a curation feature, not a
  security boundary.
- Sandboxing browser, MCP, `home_*`, or `user_md_*` tools.
- Domain-level network allowlists inside Docker. v1 disables sandbox network;
  a later BAZ can add controlled egress.
- A soft "pretend jail" that claims to prevent host filesystem access while
  still running commands directly on the host. Host mode may have approval and
  env scrubbing, but it must not be described as a sandbox.

## Acceptance criteria

Slice A:

- [x] With `BAZILION_BASH_SANDBOX=off`, existing chat, tests, and Pi host-tool behavior are
  unchanged.
- [x] With `BAZILION_BASH_SANDBOX=docker`, `bash` cannot read a sentinel outside the bounded
  mounts and cannot see provider secret env vars unless the operator explicitly allowlists one.
- [x] Host-backed coding tools are not exposed in Docker mode, so `read` or `write` cannot bypass
  the shell boundary with an absolute host path.
- [x] Sandboxed commands can read/write Team work product under `/workspace`; shared memory,
  Agent inputs, and attached skill assets are readable but not writable through `bash`.
- [x] Cancellation or timeout stops the command and force-removes the named container.
- [x] Missing Docker, daemon, local image, or mount fails closed with a clear error and no host
  fallback. Bazilion never pulls the image implicitly.
- [x] A remote Docker context, image-declared writable `VOLUME`, unsafe read-only-mount symlink,
  or nested bind propagation cannot silently widen the boundary.

Slice B:

- [x] With `BAZILION_BASH_APPROVAL=dangerous`, safe commands run without interruption while
  classified risky commands pause in web and CLI until approved or denied.
- [x] Denied and non-interactive auto-denied commands return model-visible tool errors and do not
  execute.

## Tests

Implemented:

- Unit coverage for the classifier, strict config, env scrubbing, Docker argument construction,
  host-vs-Docker tool selection, prompt runtime directories, input references, and error mapping.
- Abort/timeout/startup-race cleanup coverage and Docker-backed tests gated behind an env flag for
  filesystem, environment, recursive read-only mounts, writable workspace, local-image, and
  network isolation. Unit coverage rejects remote contexts and image `VOLUME`s.
- CLI/config/doctor coverage for operator visibility.
- Runtime approval coverage proves safe bypass, allow-once execution, denial before execution,
  same-decision idempotency, conflicting decisions, timeout, cancellation, and lifecycle-scoped
  replay rejection even after response tombstones expire. Classifier regressions include arbitrary
  absolute recursive targets and path-qualified pipe interpreters.
- Authenticated daemon/worker integration coverage proves pending-state recovery, allow and deny
  streaming, cancellation cleanup, model-visible tool errors, and non-TTY auto-denial without a
  stdin hang. Web and CLI tests cover rendering, response posting, reload recovery, and terminal
  status handling.

Verification on 2026-08-02 passed 102 test files / 845 tests (with the opt-in Docker file skipped in
the default run), root and web typechecks, lint with existing warnings only, the production build,
`git diff --check`, and the opt-in live Docker suite (3 tests).

## Implementation notes

- The current `createAgentSession` call passes an explicit tool allowlist, so
  the custom `bash` must remain named `bash` and stay in that allowlist.
- `createBashToolDefinition` already handles truncation, streaming updates,
  timeouts, and abort signals; prefer wrapping its `operations` instead of
  reimplementing the whole tool UI contract.
- Approval should be model-visible only as a tool result, not as a hidden
  system-prompt mutation.
- The Docker runner should not receive the worker's `process.env` wholesale.
  Build its env from the scrubbed allowlist even if approval allowed the
  command.
- Skill instructions remain prompt-only. `loadPromptSkills` injects each attached SKILL.md body
  and advertises the same runtime directory that the session mounts: its installed directory in
  host mode or its read-only `/skills/...` directory in Docker mode.

## As-built (2026-08-02)

BAZ-006 is complete across two independent, default-off controls:

- Docker mode replaces the complete host coding-tool surface with one ephemeral, local-image,
  network-disabled `bash` backend using bounded mounts, a scrubbed environment, a read-only root,
  and fail-closed Docker/image/context validation.
- Dangerous approval wraps either host or Docker `bash` at Pi's tool-call boundary. Structured risk
  classification happens before backend execution; safe commands bypass the gate, while risky
  commands require one explicit decision for that tool call.
- The daemon owns an ephemeral, turn-scoped registry keyed by turn and tool call. It emits pending
  and terminal stream events, supports idempotent same-decision retries, retains an exactly-once
  tuple claim for the worker lifetime, and clears waiters on denial, timeout, cancellation, worker
  disconnect, or turn shutdown.
- Web chat renders inline allow-once/deny cards and recovers pending decisions after reload. TTY CLI
  uses the same authenticated response endpoint and a single stdin owner. Scheduled, Telegram,
  background, and non-TTY callers explicitly auto-deny rather than hanging.
- Command approval is intentionally separate from durable Team Policy communication approval.
  Decision audit records identity, risk codes, and status while omitting command text, matched
  spans, environment values, and secrets.
