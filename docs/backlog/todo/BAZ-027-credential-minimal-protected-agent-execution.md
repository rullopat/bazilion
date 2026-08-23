---
id: BAZ-027
title: Credential-minimal protected Agent execution
status: todo
size: L
created: 2026-08-23
refined: 2026-08-23
priority: high
note: Give protected workers only their selected runtime capabilities and force that fail-closed surface for Telegram and every background turn.
---

# BAZ-027 — Credential-minimal protected Agent execution

## User stories

- **As the sole operator running Bazilion on a small online server**, I want each protected Agent
  worker to receive only the credential and tool configuration needed for that turn, so
  prompt-injected work cannot enumerate my Telegram token, OpenAI refresh credential, unrelated
  provider keys, or other daemon secrets.
- **As an operator starting work through Telegram**, I want the turn to use a mandatory,
  fail-closed protected posture even though I cannot answer an inline shell-approval prompt, so a
  remote message cannot silently run host-backed coding tools or reuse privileged browser/MCP
  state on the server.
- **As an operator enabling scheduled, inbox-driven, approval-replayed, or reviewed-learning
  work**, I want the daemon to choose a non-downgradable capability surface for every background
  turn, so request fields, Profiles, and Team Policy cannot weaken it.
- **As an operator using ChatGPT OAuth**, I want the daemon to retain the refresh credential and
  give a worker only its current access token, so long turns can refresh without widening the
  daemon/worker trust boundary established by BAZ-023.

## Goal

Replace the inherited daemon environment for protected normal turns and restricted reviews with a
typed, per-turn runtime. Require one central daemon policy to derive that effective tool surface
from a trusted invocation source.

```text
HTTP / Telegram / trigger / inbox / approval / review
                         |
                         v
            trusted invocation + central policy
                         |
          daemon resolves only this turn's material
    OpenAI access + paths + shell policy + IPC hosts
                         |
                         v
          fresh-home worker with minimal process env
              |                         |
              | protected normal turn   ` restricted review
              v                           propose_lesson only
       Docker coding tools only
       no browser or MCP
```

This story protects the boundary most exposed by Telegram and autonomous work: untrusted content
can influence a model, but it cannot use the model-visible capability surface to recover ambient
daemon credentials or arbitrary host files. It does not claim that a Node child is a VM boundary,
that data intentionally sent to the selected model is private from that provider, or that Bazilion
provides data-loss prevention for Team/workspace content.

Local `operator_http` retains its existing configured BAZ-006 behavior in this story, including its
legacy worker environment and optional persistent browser/MCP surface. Config and doctor label that
branch **configured, not protected**. BAZ-028 later makes hosted web/CLI/mobile HTTP use BAZ-027's
protected branch; it does not duplicate this policy.

## Why

The daemon correctly owns SQLite, `auth.json`, encrypted secrets, the Telegram bot, provider
configuration, and OAuth refresh. The worker is DB-free, but `runAgentTurn` and the review
dispatcher currently call `mergeSecretsIntoEnv(...)`, then `spawnWorkerTurn` passes the result as
the child process environment. The child therefore receives every decrypted secrets-table value,
including the complete `OPENAI_CODEX_OAUTH` blob, plus daemon config and ambient process variables,
even when one provider and no credentialed tool are needed.

The bootstrap token is a different risk: `mergeSecretsIntoEnv` does not normally add it, but the
default host-backed coding surface can read `auth.json`, `bazilion.db`, SSH material, and other
same-user files. `BAZILION_HOME` is also inherited only because the worker currently rediscovers
paths from its environment; those paths can be passed explicitly instead.

BAZ-006's Docker isolation is opt-in and validates the image/context lazily on the first `bash`
call, after the provider has already been prompted. It also constrains only Pi's coding tools.
Normal turns can still invoke the daemon's persistent authenticated browser and globally configured
MCP tools; stdio MCP servers currently inherit the daemon's full merged environment. A credible
protected posture has to cover that entire model-visible surface and has to preflight before work
starts.

BAZ-023 already proves the intended OAuth shape: the worker receives a current access token and
uses provider-, Agent-, and turn-bound IPC to ask the daemon for a replacement, while the refresh
credential stays in the daemon. BAZ-027 applies that current OpenAI Codex pattern to protected
process bootstrap, shell policy, paths, and daemon capabilities.

## Product decisions

### 1. Trusted invocation and one effective policy

Use a required discriminated invocation union, not an `interactive | unattended` string paired
with a free `requireIsolation` boolean. Contradictory states such as an unattended invocation with
isolation disabled must be unrepresentable.

| Trusted invocation kind | Current effective surface | Shell approval |
|---|---|---|
| `operator_http` | configured BAZ-006 posture; local `off` remains compatible | request may provide `interactive` or `auto_deny` capability |
| `telegram` | `protected` | `auto_deny` |
| `scheduled_trigger` | `protected` | `auto_deny` |
| `inbox_wake` | `protected` | `auto_deny` |
| `approval_delivery` | `protected` | `auto_deny` |
| `restricted_review` | reviewer-only surface | `auto_deny` |

- The HTTP chat route is one trusted source whether its client is the web UI, TTY CLI, piped CLI,
  or mobile app. A client-provided `bashApprovalMode` describes whether that connection can answer
  a dangerous-command prompt; it never chooses host versus Docker execution.
- Each invocation carries its authorization state as part of the union: `operator_http` owns one
  final `authorize_ingress` with the exact sanitized message/attachments; `telegram` owns an exact
  `revalidate_ingress`; scheduler and inbox carry typed `preclaimed` claims;
  `approval_delivery` carries the repository-revalidated approved attempt; review carries `none`.
  Replace the loose `skipUserIngress`, `alreadyRegistered`, optional authorization, and implicit
  registration combinations with this contract.
- One daemon preparation boundary acquires the lifecycle lease, performs the invocation's final
  authorization/revalidation, registers the active Agent, derives policy, and returns a branded
  prepared turn. `runAgentTurn`, `spawnReviewWorker`, `WorkerTurnSpec`, and raw spawn accept only the
  matching prepared/effective-policy variants. There is no duplicate HTTP authorization,
  fabricated `internal_turn`, or implicit configured-host/interactive fallback. The explicit legacy
  runtime is valid only for `operator_http`; a protected or review variant cannot contain it.
- Telegram, trigger, inbox, and approval-delivery protection applies in every deployment now. It is
  not conditional on BAZ-028 or on the operator enabling global Docker mode.
- Communication approval is not proof of live attendance. A replay keeps the stored original
  `origin`, `attemptKind`, and `attemptId` for audit, but executes as `approval_delivery` because the
  original HTTP/Telegram response channel has ended. Unknown or inconsistent stored origin/payload
  combinations fail closed.
- Scheduler approval grants only its durable occurrence; the scheduler still executes it as
  `scheduled_trigger`. Inbox and Agent-message approvals grant/deliver canonical messages; any
  resulting turn still enters as `inbox_wake`.
- Manual and cadence learning reviews converge on the same `restricted_review` policy.
- Stop concatenating distinct Telegram updates under the first message's attempt identity. The
  queue remains serialized FIFO but dispatches one exact `telegram_ingress` attempt per Agent turn,
  revalidated under the lifecycle lease with its own text/media payload. A future coalescing design
  requires a typed multi-attempt approval payload; it may not silently restore first-item identity.
- BAZ-028 may later make every `operator_http` turn protected on a hosted installation. BAZ-027
  exposes one trusted daemon-side policy seam for that stricter choice but does not add or depend on
  a server-mode flag.

Approval delivery uses this exact allowlist; validation covers operation, payload kind, stored
origin, source/target shape, and typed payload before any side effect:

| Operation | Payload kind | Stored origin | Delivery effect |
|---|---|---|---|
| `user_to_agent` | `agent_turn` | `http_chat` | direct protected `approval_delivery` |
| `user_to_agent` | `telegram_ingress` | `telegram_agent_topic` | direct protected `approval_delivery` |
| `scheduler_trigger` | `scheduler_trigger` | `scheduler_trigger` | grant only; later `scheduled_trigger` |
| `deliver_agent_message` | `inbox_message` | `agent_inbox` or `scheduler_inbox` | grant only; later `inbox_wake` |
| `send_agent_message` | `agent_message` | `agent_tool` or `http_agent_message` | deliver message only; later `inbox_wake` |
| `agent_to_user` | `http_chat_frame` | `http_chat` | no worker |
| `agent_to_user` | `telegram_text`, `telegram_typing`, `telegram_image`, or `telegram_file` | `telegram_mirror` | no worker |

HTTP always captures the exact sanitized `agent_turn`, including attachments. Telegram always
captures the original `telegram_ingress` transport/media payload. The turn boundary never replaces
either with a generic payload or an empty attachment list.

### 2. Typed protected/review runtime, paths, and process bootstrap

Make the worker specification a required union:

- `configured_operator_http` explicitly carries today's configured runtime/environment and is
  accepted only for `operator_http`;
- `protected` carries only its effective policy, OpenAI Codex access runtime (including the
  daemon-selected normal reasoning level), exact normal-session paths, validated Docker runtime,
  guarded `web_fetch` flag, the required provider-, Agent-, and turn-bound refresh IPC capability,
  and permitted scoped IPC capabilities;
- `restricted_review` carries only OpenAI Codex access runtime (including the daemon-selected
  review reasoning level), prepared bounded review input, exact scratch-session path, and the
  required provider-, Agent-, and turn-bound refresh IPC capability. It has no Docker, web,
  browser, MCP, messaging, memory, home, USER.md, delivery, or shell fields.

Raw spawn has no default environment. A caller must pass the environment belonging to its union
variant, and runtime validation rejects a legacy configured environment on protected/review work.
This story deliberately does not redesign the attended local host-shell environment; that branch
remains an explicit compatibility surface rather than part of BAZ-027's security guarantee.

No field in `MinimalWorkerRuntime` is an arbitrary environment record, and no Bazilion resolver or
tool in that branch may use `process.env` as runtime configuration. Pi runtime creation, web-tool
creation, and shell-tool creation consume typed projections. Upstream libraries may inspect
`process.env`, but protected/review workers expose only the newly constructed bootstrap environment.

Each protected/review child gets:

- a fresh per-turn scratch home and temp directory; `HOME`, `USERPROFILE`, `TMPDIR`, `TMP`, and
  `TEMP` point there as applicable and are deleted on success, failure, or cancellation;
- `LANG=C` and `LC_ALL=C` on POSIX;
- only validated canonical `SystemRoot`, `WINDIR`, `ComSpec`, and `PATHEXT` mechanics on Windows in
  addition to the scratch paths;
- absolute daemon-resolved paths for Node, the worker entry, and mode-required helpers, so its
  bootstrap environment does not inherit `PATH`; only the protected normal variant receives the
  pinned Docker executable/runtime data;
- no `NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, dynamic-loader variables, proxy URLs, custom CA paths,
  Docker controls, Bazilion variables, provider/cloud variables, or daemon secrets.

Pass exact normal-session paths for the selected Agent, Team memory, session, attached skills,
uploads, and bounded scratch output. Pass review only a prepared bounded input (digest plus approved
private-lesson summaries and shared-lesson keys) and a daemon-created ephemeral session directory.
The protected/review worker does not call zero-argument `resolvePaths()` or learn the Bazilion root
through `BAZILION_HOME`.

Protected turns use a fixed non-credential container environment. Docker-client mechanics are a
separate typed, daemon-resolved input, and protected policy ignores every configured container
allowlist value. Configured `operator_http` retains today's allowlist and host-shell behavior; it
cannot be reached from a protected invocation.

### 3. OpenAI Codex runtime for the current deployment

BAZ-027 deliberately supports the operator's current `openai-codex` use only. The protected/review
provider runtime is a closed object containing the selected provider/model identity, the
daemon-selected normal or review reasoning level, current OAuth access token, and the existing
provider-, Agent-, and turn-bound refresh-over-IPC capability. It is not a generic provider union
or environment record.

- The daemon resolves the access token before spawn. Pi receives it through its in-memory
  credential store, never `process.env`; refresh replies carry only a new access token while the
  stored refresh credential remains daemon-owned.
- Protected readiness is true only when the selected normal/review model uses `openai-codex`, its
  OAuth state is valid/refreshable, and the provider is enabled. Every other provider is
  **configured-only** in this story and fails protected/review preparation before worker spawn with
  one bounded reason. Config and doctor distinguish configured from protected-ready.
- Configured local `operator_http` continues to support the full existing provider catalog. BAZ-028
  may force hosted HTTP through the protected branch only when its selected model is protected-ready.
- The access token necessarily exists in the one-shot stdin payload and worker heap while the
  provider request runs. This is an accepted residual risk; a provider streaming proxy would be a
  separate story.

Protected normal turns expose the existing primary `web_fetch` implementation with SSRF/rebinding
protection, Readability extraction, bounded response handling, and cache, but force Firecrawl
fallback off. They do not expose `web_search`, Brave, Firecrawl, or SearXNG, so no first-party
web-tool credential/config enters `MinimalWorkerRuntime`. Restricted review exposes neither web
tool. BAZ-031 owns expansion to additional providers and credentialed web backends after real usage
requires one.

### 4. Protected capability matrix

Protection applies to the complete model-visible surface, not only `bash`.

| Capability | Configured `operator_http` | Protected normal turn | Restricted review |
|---|---|---|---|
| Pi host coding/file tools | existing configured behavior | never exposed | never exposed |
| Docker `bash` | when configured | only coding surface; mandatory | not exposed |
| web tools | existing configured behavior | guarded primary `web_fetch` only; no search/Firecrawl | not exposed |
| Browser tools | existing configured persistent Agent context | disabled | not exposed |
| MCP tools | existing configured behavior | disabled | not exposed |
| scoped `home_*`, Team memory, `user_md_*`, messaging, `deliver_file` | retained | retained under existing ownership/policy checks | not exposed |
| learning proposal | normal learning tools absent | normal learning tools absent | `propose_lesson` only |

- Protected policy does not force-enable browser automation. It supplies no browser tool schemas or
  host and launches no Chromium process, regardless of configured `BROWSER_ENABLED` or private-
  network settings. A separately refined story may add a scrubbed ephemeral protected browser.
- Protected policy performs no MCP discovery, connection creation, tool-schema injection, or call.
  Existing pooled connections owned by unrelated configured/attended work need not be closed. This
  denial is required because an arbitrary MCP server is a separately privileged execution surface
  and stdio MCP currently inherits daemon credentials.
- Protected Docker preserves every BAZ-006 invariant: local Unix socket only, pre-existing
  validated image, `--pull never`, no image `VOLUME`s, no network, bounded mounts, read-only root,
  temporary `/tmp`, scrubbed environment, and no host fallback.
- Protected container input uses `/workspace`, `/inputs`, and attached `/skills/...` paths selected
  from the effective policy even when configured global mode is `off`. Team `memory/` stays
  read-only to Docker while scoped memory tools own writes.
- The restricted review branch does not initialize qmd, normal Agent sessions, Team/workspace
  tooling, messaging, USER.md, browser, MCP, file delivery, or shell approval. It receives the
  prepared bounded review input (digest plus approved private-lesson summaries and shared-lesson
  keys), OpenAI Codex access runtime, exact scratch session path, and `propose_lesson` only. The
  daemon prepares that input; qmd is absent from the review worker.

### 5. Preflight, execution checks, and failure ownership

- Add a daemon-side protected-normal preflight that runs before worker spawn, provider prompting, or
  transcript mutation. It validates protected-ready OpenAI Codex, the required bound refresh IPC
  capability, supported platform, absolute Docker binary, local Unix socket, immutable image id and
  policy, Team/input/memory/skill mount containment, and current access to every required path.
- Pin the inspected image id and Docker endpoint in the effective runtime, then re-check mutable
  mount and Docker facts immediately before each container execution. There is no remote context,
  implicit pull, lazy first-command downgrade, or host fallback.
- On Windows or any host where BAZ-006 cannot establish its Unix identity/mount/socket invariants,
  protected normal turns fail closed. Cross-platform worker bootstrap remains supported and tested.
- Restricted-review preflight is separate: validate only OpenAI Codex readiness, its required bound
  refresh IPC capability, bounded prepared input/session paths, bootstrap environment, and cleanup.
  Missing Docker does not block a reviewer because review has no coding or shell surface.
- Resolve attachment references and skill prompt paths from the effective surface, not the
  configured global sandbox value, so a forced turn never leaks a host-only path into its prompt.
- Perform inbox protection readiness before marking messages read. If readiness is unavailable,
  leave the canonical messages unread and expose the health failure instead of consuming them or
  creating a new runs/events table.

Failure is returned through the source that owns the attempt:

| Source | Protected-preflight failure behavior |
|---|---|
| Telegram | one bounded, redacted reply in the owning topic |
| scheduled trigger | existing dispatch retry/terminal failure state |
| inbox wake | messages remain unread; health/config explains the blocked posture |
| communication approval | existing `delivery_failed` state with bounded error |
| restricted review | existing review failure/cancellation state |
| operator HTTP when a future deployment forces protection | typed HTTP/NDJSON error before transcript mutation |

### 6. Redaction and operator visibility

- Worker stderr is piped and size-bounded instead of inheriting the daemon terminal. A streaming
  redactor removes the exact active OpenAI access-token value across chunk boundaries before any
  Bazilion-authored diagnostic is logged.
- Sanitize provider/tool errors at their adapter boundary before Pi can turn them into session
  events or transcript entries. Apply the same exact-value redactor to fatal frames, session events,
  Telegram mirrors, and Bazilion-authored snapshots/errors. Unrelated daemon secrets cannot appear
  because they never enter `MinimalWorkerRuntime`.
- Bazilion never intentionally serializes the runtime credential into argv, child process environment,
  command approvals, frames, transcripts, logs, snapshots, or operator-facing errors. Selected
  access tokens are permitted only in the private bounded stdin runtime field, the turn-bound
  refresh IPC reply, and the corresponding in-memory client.
- Extend authenticated Config UI and `bazilion doctor`/health projection with **Configured operator
  HTTP** and **Protected unattended turns (Telegram, schedules, inbox, approvals)** sections. Show
  effective coding surface, Docker readiness, browser/MCP denial, provider protected-readiness, and
  one secret-free remediation when protection is unavailable.
- This story adds no durable state and makes no schema change. Do not add `ALTER` migrations,
  legacy import, compatibility aliases, or dual-read behavior.

## Out of scope

- Multi-user accounts, roles, per-user authorization, or API-token scopes.
- Publishing the web interface, browser-session authentication, Tailscale/reverse-proxy setup, or
  native mobile pairing; those belong to BAZ-028.
- Telegram owner pairing/ACL redesign, backup encryption/recovery, or credential rotation.
- Replacing BAZ-006's Docker backend, allowing network inside the coding container, containerizing
  the daemon, or claiming the worker child itself is a kernel/VM boundary.
- Any browser or general-purpose MCP capability in protected turns. Both are disabled; a later story
  must design their own minimal subprocess/runtime and capability policy before enabling them.
- Credential-minimizing the explicitly configured local `operator_http` compatibility branch.
  BAZ-028 secures hosted HTTP by selecting the protected branch instead of weakening this boundary.
- Protected/review support for API-key, local, Cloudflare, Bedrock, Vertex, or any other provider,
  and credentialed Brave/Firecrawl/SearXNG tools. Those expansions belong to BAZ-031.
- Daemon-side provider streaming proxying, AWS profile/role/metadata credential brokering, or
  Google ADC/service-account-file brokering.
- Data-loss prevention for Team/workspace content intentionally visible to the model, provider, web
  tools, messaging recipients, browser destinations, or delivered files.
- Defending against a compromised daemon, kernel, same-UID debugger, swap/core-dump inspection, or
  arbitrary code execution inside the Node worker. The selected provider credential remains in
  worker memory for the duration of its turn.
- Detecting every encoded, fragmented, or transformed rendering of a credential emitted by a
  compromised third-party dependency. BAZ-027 prevents intentional serialization and redacts exact
  active values at Bazilion-owned boundaries.
- Changing Team Policy communication approvals, the ephemeral shell-approval protocol, or the
  reviewed-learning approval workflow.
- Granting an exception because a message came from the sole Telegram owner. Trusted human identity
  does not make external content or model output trusted code.

## Acceptance tests

- [ ] Table-driven invocation tests cover web, TTY CLI, piped CLI, mobile, queued Telegram messages,
  trigger, inbox, both approval replays, and manual/cadence review; request fields, Profiles, Team
  Policy, and missing/invalid metadata cannot select a weaker surface. Loose authorization/claim
  flags and duplicate HTTP/Telegram final authorization paths no longer exist.
- [ ] An approved HTTP Agent turn becomes protected `approval_delivery` while retaining its stored
  origin/attempt identity; Telegram replay remains protected; unknown stored combinations fail
  closed against the complete approval allowlist. Scheduler/inbox/message approvals still reach
  their canonical protected dispatchers, and captured attachments/media survive without generic
  payload rewriting.
- [ ] Queued Telegram messages dispatch FIFO as separate turns, retain/revalidate their own exact
  attempt identity and payload, and route denied/pending outcomes canonically without reusing the
  first queued attempt id or retaining downloaded media bytes for an approval replay.
- [ ] Protected/review platform fixtures assert the child bootstrap environment exactly. Sentinels
  for daemon secrets/config, unrelated providers, bootstrap exports, startup hooks, loaders,
  proxies, custom CA paths, Docker controls, and Bazilion paths are absent; scratch home/temp
  cleanup is reliable.
- [ ] OpenAI Codex protected/review workers receive the selected provider/model identity, the exact
  daemon-selected normal or review reasoning level, and only the current access token; they refresh
  through the existing bound BAZ-023 IPC path and never receive the stored refresh credential.
  A missing bound refresh capability fails preflight. Every other provider is labelled
  configured-only and fails protected preparation before spawn without a generic environment
  fallback.
- [ ] Protected normal turns retain guarded primary `web_fetch` behavior while `web_search`, Brave,
  Firecrawl fallback, and SearXNG are absent. No first-party web credential/config sentinel enters
  `MinimalWorkerRuntime`, and private, loopback, link-local, metadata, or DNS-rebinding targets stay
  blocked.
- [ ] With configured global sandbox `off`, every Telegram, trigger, inbox, and approval-delivery
  turn still exposes Docker `bash` only and no Pi host coding/file tools. Invalid/already-Docker
  configured states resolve deterministically without rewriting the configured value.
- [ ] Docker preflight completes before worker spawn, provider invocation, or transcript mutation;
  missing Docker/image, remote context, image `VOLUME`, unsafe mount/symlink, unsupported platform,
  or execution-time mismatch fails closed without host fallback.
- [ ] Protected attachments use `/inputs`, attached skill prompts use `/skills/...`, memory is
  read-only to Docker, the container has no network or credential-bearing allowlist values, and no
  host credential path is reachable through a model-visible coding tool.
- [ ] Protected turns expose no browser tool schemas/host and launch no Chromium process. They
  perform no MCP discovery, connection creation, schema injection, or calls; unrelated attended
  pooled MCP connections may remain alive but are unreachable from the protected turn.
- [ ] Protected scoped home, memory, USER.md, messaging, and file-delivery tools retain their
  existing containment, Team Policy, cancellation, and error semantics.
- [ ] Restricted review initializes only its exact scratch session, OpenAI Codex access runtime,
  prepared digest/existing-lesson input, required bound refresh IPC, and `propose_lesson`; Docker,
  normal qmd, Team/workspace, home, messaging, web, browser, MCP, file, and shell surfaces are
  absent. A missing refresh capability fails preflight, while missing Docker does not block review.
- [ ] A protected-preflight failure sends one redacted Telegram notice, records trigger and approval
  failure through their owners, leaves inbox messages unread, and preserves existing review state
  semantics without adding runs/events tables.
- [ ] Telegram, bootstrap, OAuth-refresh, unrelated-provider, and unrelated-tool sentinels are absent
  from every minimal worker input and output. The selected OpenAI access-token sentinel occurs only
  in the designated typed stdin field or bound refresh IPC reply and corresponding in-memory client;
  it is absent from argv, child env, captured stderr, frames, transcripts, Bazilion-authored logs
  and errors, snapshots, command approvals, and Telegram output. No unexpected descriptor is
  inherited; the bounded stdin pipe closes after delivery and refresh IPC remains turn-bound.
- [ ] Local configured `operator_http` host/Docker behavior and web/CLI/mobile command-approval
  capability remain compatible through the explicit legacy variant. Protected/review origins cannot
  select that variant, while Config and doctor label it unprotected and show secret-free remediation
  for mandatory protected work.
- [ ] Focused worker-runtime, OpenAI OAuth, tool-surface, origin, approval, Docker, browser/MCP-denial, review,
  failure-routing, cleanup, and redaction tests pass with root/web/mobile typechecks, lint, and the
  full test suite.

## Delivery slices

1. **Typed runtime and credential boundary:** introduce the required worker/runtime wire, minimal
   platform bootstrap and explicit paths; carry only the selected OpenAI Codex identity, reasoning
   level, and access; retain uncredentialed guarded `web_fetch`; remove protected/review
   `process.env` fallbacks; and strip normal qmd/host
   initialization from the reviewer.
2. **Trusted policy and preflight:** require every invocation kind, preserve approval audit origin,
   derive effective policy centrally, add daemon Docker preflight plus execution re-checks, resolve
   protected attachment/skill paths, and route failures through each canonical owner.
3. **Complete protected surface:** disable browser and MCP capabilities, capture/sanitize worker
   diagnostics before Pi persistence or Bazilion logging, expose Config/doctor status, and run the
   complete origin/provider/tool regression matrix.

BAZ-027 is complete only when all three slices ship together. A credential-minimal worker without
the protected capability policy still leaves Telegram/background work unsafe; Docker-only
protection without the typed runtime, browser/MCP constraints, and failure visibility still leaves
ambient escape paths.
