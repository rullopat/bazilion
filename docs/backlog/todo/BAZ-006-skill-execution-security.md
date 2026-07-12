---
id: BAZ-006
title: Skill execution security - sandbox and command approval
status: todo
size: L (1-2 weeks)
created: 2026-05-29
refined: 2026-07-05
priority: high
note: BAZ-008 shipped the static SKILL.md content scan. This remaining BAZ is runtime hardening for all agent bash calls, because skill-origin cannot be reliably distinguished from ordinary model-origin bash in a prompt-only skill system. Default behaviour remains unchanged until an operator opts in.
---

# BAZ-006 - Skill execution security - sandbox and command approval

**Status:** Todo. Ready to pull.

Bazilion's skill model is prompt-only: a `SKILL.md` under `~/.bazilion/skills/<name>/`
is represented in the agent prompt, and any procedural work happens through the
agent's normal tools. BAZ-008 now scans skill content at import, list, and attach
time, but runtime command execution is still unrestricted: pi's built-in `bash`
tool runs from the agent team directory with the worker's merged environment,
including provider credentials and service config.

This BAZ adds the remaining runtime boundary: an opt-in sandboxed bash runner
and an optional dangerous-command approval tripwire. The controls apply to all
agent `bash` invocations, not only "skill scripts", because once a skill is in
the prompt there is no reliable runtime provenance marker that says a specific
shell command came from the skill rather than the model's ordinary reasoning.

**Dependency:** BAZ-008 is shipped. This work sits on top of:

- `apps/daemon/src/runtime/pi/session.ts`, where Bazilion builds the pi session
  and currently lets pi register the built-in coding tools.
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
  sandbox for `bash` that mounts only the agent's team directory, so a command
  cannot read `~/.ssh`, `~/.aws`, `~/.bazilion/auth.json`, or the Bazilion DB.
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
   commands in an ephemeral container with the team directory mounted as the
   working directory, a scrubbed env, no Bazilion home mount, and network
   disabled by default. If Docker is unavailable, fail closed with a clear
   operator-facing error instead of silently falling back to host execution.
4. **Approval is separate from sandboxing.** Operators can enable the tripwire
   without enabling Docker. Approval decides whether a risky command may run;
   sandboxing decides where it runs.
5. **Non-interactive turns auto-deny.** Heartbeats, scheduled triggers, future
   reviewer/background forks, and any caller without an approval response path
   must receive a denied tool result rather than block forever.

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

- In `createBazilionSession`, replace pi's built-in `bash` definition by
  registering a custom tool named `bash` built with `createBashToolDefinition`.
  Pi lets SDK custom tools override built-ins by name during registry refresh.
- Keep the rest of the coding tools (`read`, `edit`, `write`, `grep`, `find`,
  `ls`) on pi's default implementations.
- Wire a Bazilion `BashOperations` implementation that:
  - runs the classifier before execution;
  - requests approval when policy requires it;
  - executes via the selected backend after approval;
  - preserves pi's stdout/stderr streaming, timeout, abort, exit-code, and
    truncation behaviour.

### 3. Docker sandbox backend

- Implement an ephemeral Docker runner for `bash` when sandbox mode is enabled:
  - image: configurable, default to a small Linux image with `bash`;
  - workdir: `/workspace`;
  - mount: agent team directory to `/workspace` read/write;
  - env: scrubbed allowlist only (`PATH`, `HOME`, locale, shell basics, plus
    explicit operator-configured variables);
  - home: temp/in-container home, not host `~`;
  - network: disabled by default for v1;
  - lifecycle: container removed after command; abort kills container/process.
- Surface clear errors for missing Docker, missing image, mount failures, and
  commands that need tools not present in the image.
- Add config fields under the existing `/config` service registry, such as:
  - `BAZILION_BASH_SANDBOX=off|docker`
  - `BAZILION_BASH_SANDBOX_IMAGE=<image>`
  - `BAZILION_BASH_APPROVAL=off|dangerous`
  - optional comma-separated env allowlist for sandboxed commands.

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

- Show current shell-security posture in `bazilion doctor` and the web config
  page.
- Log sandbox/approval decisions with agent id, team id, risk codes, and
  whether the command was allowed, denied, or auto-denied. Do not log secret
  values or full env.

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

- With both controls off, existing chat, tests, and pi tool behaviour are
  unchanged.
- With `BAZILION_BASH_APPROVAL=dangerous`, safe commands such as `pwd` and
  `ls` run without interruption, while classified risky commands pause in web
  and CLI until approved or denied.
- Denied and auto-denied commands are returned to the model as tool errors and
  do not execute.
- With `BAZILION_BASH_SANDBOX=docker`, `bash` cannot read a sentinel file
  outside the team directory and cannot see provider secret env vars.
- Sandboxed commands can still read/write files under the mounted team
  directory.
- Cancellation of a turn with a running sandboxed command stops the process and
  cleans up the container.
- Missing Docker fails closed with a clear error when sandbox mode is enabled.

## Tests

- Unit tests for `classifyBashCommand` covering benign commands, sensitive path
  reads, broad deletes, pipe installers, upload/exfil commands, and privilege
  escalation.
- Unit tests for env scrubbing: provider keys and Bazilion secrets are absent;
  allowed basics remain.
- Runtime tests for the custom `bash` wrapper using a fake `BashOperations`
  backend: safe command runs, risky command requests approval, denial prevents
  execution, auto-deny prevents execution.
- Worker IPC tests for approval request/reply, timeout cleanup, and cancellation
  cleanup.
- Docker-backed integration tests gated behind an env flag, proving filesystem
  isolation, env isolation, writable team mount, network-disabled behaviour,
  and abort cleanup.
- Web/CLI focused tests for rendering an approval request and sending allow/deny
  responses.

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
