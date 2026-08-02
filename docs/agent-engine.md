# Bazilion Agent Engine — Internals

Engineer-to-engineer walkthrough of how a chat turn actually runs, end to end.

> **Core engine credit**: Bazilion is based on
> [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).
> Pi owns the per-turn session loop, transcript storage, replay, compaction,
> tool execution, provider retries, and the coding tools. Bazilion provides
> profiles, teams, skills, messaging, memory, the scheduler, the HTTP API
> (`apps/daemon`), the web UI (`apps/web`), and a thin bridge
> (`apps/daemon/src/runtime/pi/*`) that glues them together. The on-disk JSONL
> session file under `~/.bazilion/agents/<id>/sessions/` is the canonical
> transcript and the only persistent record — there is no separate `runs` /
> `events` audit table.

## 1. Request → subprocess boundary

A chat turn starts at `POST /api/agents/:id/chat` (the daemon at `apps/daemon`). The route hands off to `apps/daemon/src/lib/agent-turn.ts:runAgentTurn`, which is a thin relay (~30 lines). It:

1. Resolves the agent (`resolveAgent(db, paths, id)`) — joins agent + profile + team + skills.
2. Reads the enabled-provider set (`providerStateRepo.listEnabled(db)`).
3. Computes the merged env (`mergeSecretsIntoEnv(db, authToken)` — `process.env > secrets table > config table`).
4. Pre-fetches the API key via `apps/daemon/src/lib/api-key.ts:resolveAgentApiKey(db, authToken, agent)` — a no-op for env-key providers; for `openai-codex` it pulls the OAuth access token out of the secrets table. Throws a friendly "not connected" error here if the user hasn't done the OAuth flow.
5. Builds a `MessagingHost` backed by repos (`apps/daemon/src/lib/messaging-host.ts:createDbMessagingHost(db)`).
6. Registers an `AbortController` keyed by `agentId` (`apps/daemon/src/lib/agent-cancel.ts:registerAgent`).
7. Calls `spawnWorkerTurn({agent, message, enabledProviders, apiKey}, {signal, env, messagingHost})`.

**No LLM work happens in the daemon process.** The worker runs in its own Node child.

`apps/daemon/src/runtime/worker/spawn.ts` spawns the child:

```
node --import <file:///…/tsx/loader.mjs> apps/daemon/src/runtime/worker/entry.ts
```

The tsx loader path is discovered once via `createRequire(import.meta.url).resolve('tsx')` → `pathToFileURL`. Result cached. This lets the child execute `.ts` source with no build step and works under pnpm's hoisted layout because the specifier is absolute, not bare.

Stdio is `['pipe','pipe','inherit','ipc']`:
- **stdin** — parent writes one JSON line (`{agent, message, enabledProviders, apiKey?}`), closes it.
- **stdout** — line-buffered NDJSON stream of `ChatFrame`s (`session/frame.ts`):
  - `{kind:'event', event}` — one per `SessionEvent`
  - `{kind:'done', messages}` — exactly once on clean exit
  - `{kind:'fatal', error}` — exceptional exits
- **stderr** — inherited to the daemon console.
- **fd 3 (IPC)** — bidirectional JSON RPC. Worker → daemon: `{type:'rpc', id, method, args}` for daemon-owned tools and shell approval. Daemon → worker: `{type:'rpc-reply', id, ok, result|error}`.

Cancellation is keyed by **agentId** (not runId — there are no runIds anymore, since the runs table is gone). The agent-cancel registry is pinned to `globalThis[Symbol.for('bazilion.agent-cancel.registry')]` so module reloads don't replace it. `POST /api/agents/:id/cancel` looks up the controller and aborts it; the parent's abort handler calls `child.kill('SIGTERM')`, arms a 3s timer, and SIGKILLs if the child doesn't exit.

## 2. Child bootstrap (`worker/entry.ts`)

The worker has **no DB handle**. Everything DB-shaped came in over stdin:

```
process.on('SIGTERM' / 'SIGINT', onSignal)            // installed FIRST so a signal during boot
                                                      // emits a synthetic 'cancelled' event + exits 0
const {agent, message, enabledProviders, apiKey, turnId, bashApprovalMode} = await readInput()
paths = resolvePaths()                                // BAZILION_HOME from env, no DB access
memory = qmdBackend(join(agent.team.path, 'memory')) // Team-shared store, not per-agent
                                                      // BM25 index via @tobilu/qmd
messagingHost = createIpcMessagingHost()              // process.send/on('message') wrapper
bashApprovalHost = createIpcBashApprovalHost()        // risky bash → daemon decision RPC
session = createBazilionSession({
  agent, paths,
  env: process.env,                                   // already merged by daemon, passed via spawn env
  memory,
  enabledProviders: new Set(enabledProviders),
  messagingHost,
  bashApprovalHost,
  apiKey,                                             // pre-fetched OAuth token if openai-codex
})
abortSession = () => void session.abort()
```

`createBazilionSession` (in `apps/daemon/src/runtime/pi/session.ts`) is the integration seam where Bazilion hands control to Pi's agent engine. It instantiates pi-coding-agent's `AgentSession` with:
- A `SessionManager` rooted at `~/.bazilion/agents/<id>/sessions/` — pi owns the JSONL transcript, compaction, and replay. Resume-or-create: the worker walks the session dir for the newest `.jsonl`, opens it if found, otherwise creates a fresh session.
- A shell-policy-selected coding surface. With both controls off, Pi's original `read`/`bash`/`edit`/`write`/`grep`/`find`/`ls` surface remains unchanged. `BAZILION_BASH_APPROVAL=dangerous` replaces only `bash` with a same-name local wrapper that classifies before execution and asks the daemon for a one-shot decision. With `BAZILION_BASH_SANDBOX=docker`, none of the host-backed coding tools are enabled; Bazilion registers only a same-name custom `bash` backed by an ephemeral Docker container, optionally with the same approval wrapper.
- Bazilion's custom tool list via `createBazilionCustomTools` (memory_*, home_*, web_*, bootstrap_done, optional messaging via the `messagingHost`) — see `apps/daemon/src/runtime/pi/tools.ts`.
- The provider/model pair from the registry, with `apiKey` (caller-supplied for OAuth providers, env-derived for API-key ones), plus the agent's `reasoning_level`.

Docker mode is an opt-in confinement boundary, not just a different process launcher. The Team
workspace is mounted read/write at `/workspace`, but its `memory/` subtree is over-mounted
read-only to `bash` (the scoped `memory_*` tools still own memory writes). Non-image attachments
saved under the Agent's private `uploads/` directory are exposed read-only at `/inputs`, and the
message's generated file note uses those container paths. Each attached skill directory is exposed
read-only at the runtime path printed beside that skill in the prompt. Recursive bind propagation
is disabled, so nested host mounts do not expand those capabilities. The container otherwise has
a read-only root, a temporary `/tmp`, no network, no capabilities, and only Bazilion's scrubbed
allowlist environment; image-defined environment values are discarded before the requested
command. It runs an immutable id resolved from the configured local image with `--pull never`.
Only a local Unix-socket Docker context is accepted. Images declaring Docker `VOLUME`s are rejected
because those would create implicit writable filesystems. Missing Docker, a missing/incompatible
local image, or a mount failure returns a tool error and never falls back to host execution.

Dangerous-command approval is independent of Docker isolation. The wrapper intercepts Pi's bash
tool definition (where the stable tool-call id exists), classifies the complete command, and sends
an IPC request before either local or Docker operations run. Interactive browser and TTY CLI turns
receive `command_approval` stream events and answer through `/api/shell-approvals`; every other
caller is marked `auto_deny`. Pending entries live only in daemon memory, expire after two minutes,
and are removed on turn cancellation or worker disconnect. Allow invokes the selected backend once;
all other outcomes become a model-visible bash tool error without invoking it.

Provider gate: `enabledProviders.size > 0 && !enabledProviders.has(providerName)` → throws "provider is disabled — enable it on /config". The set is pre-computed by the daemon so the worker doesn't have to read `provider_state`.

For `openai-codex` agents specifically, the worker doesn't get a refresher callback (it has no DB to refresh against). The initial token is expected to last the turn; turns that exceed the JWT lifetime fail. Daemon-side compact/context routes use `resolveAgentApiKey(..., {withRefresher:true})` to wire pi's mid-turn refresh hook.

After the turn finishes (or aborts), the worker calls `process.disconnect()` in its `finally` so the IPC channel doesn't pin the event loop alive after the turn settles.

## 3. The prompt

`session/prompt.ts:buildSystemPrompt` concatenates, in order, whichever of these files exist under the agent's dir:
`AGENTS.md → SOUL.md → TOOLS.md → IDENTITY.md → BOOTSTRAP.md`.

Those were copied out of the profile at spawn time (`core/agent/spawn.ts`) so an agent can diverge from its profile. If `BOOTSTRAP.md` exists a nudge is appended telling the model to call `bootstrap_done` (which deletes the file) once it's done onboarding.

Then three team-related blocks are appended (when applicable):

- **`# Agent Home`** — describes the agent's private home (`agents/<id>/`) and points the model at `home_read` / `home_write` / `home_list` for self-edits and at `memory_write` for things-to-remember-later. Frames the distinction between "who I am" (home) and "what I produce" (team dir).
- **`# Team`** — `- <id> (<name>): <path>`. Reminds the model that the currently exposed workspace tools operate on team work product, that the team may be shared with other agents, and that it must use `home_*` (not workspace tools) to edit its own identity files. In Docker mode the only coding tool is the containerized `bash`, so the prompt does not claim that host file tools remain available.
- **`# About the User`** — only when `teams.user_md` is non-empty. Read-only context block about the human; the agent is told it can't edit it directly.

Finally appends: the list of attached skills (each skill's SKILL.md body is injected into the prompt), and a memory blurb explaining the **team-shared** scope: "You share a persistent memory backend with every other agent in this team. Use `memory_write` for project knowledge — codebase notes, decisions, things the user told you about the work. For personal notes about yourself (preferences, persona quirks), use `home_write` on IDENTITY.md instead." Each injected skill also names its runtime directory so relative helper scripts/assets resolve correctly: the installed host directory when sandboxing is off, or that skill's matching read-only `/skills/...` mount when Docker mode is on.

## 4. The turn loop

The turn itself is run by pi-coding-agent's `AgentSession`. The worker invokes:

```ts
await session.prompt(message)
await session.agent.waitForIdle()
```

A `session.subscribe(...)` listener is installed beforehand to capture pi's session events. Each event passes through `apps/daemon/src/runtime/pi/events.ts:translatePiEvent` to one (or zero) Bazilion `SessionEvent`s, which the worker emits as `{kind:'event', event}` NDJSON frames on stdout.

### Pi owns durability and replay

The user's message lands in pi's session JSONL the moment `prompt()` is called, so a SIGKILL mid-turn doesn't lose it. On the next worker, `SessionManager.open` replays the JSONL and pi's own orphan-strip drops trailing user/tool entries with no matching assistant reply. There is no `agents.chat_messages` blob anymore; the JSONL file at `~/.bazilion/agents/<id>/sessions/<sessionId>.jsonl` is the canonical transcript and the **only** persistent record of the conversation.

### Event flow

Per pi iteration:

1. Abort check — if the worker's signal handler has fired, `session.abort()` was called and pi unwinds the in-flight provider fetch via the `AbortSignal`.
2. Pi calls the provider via Bazilion's `pi-adapter.ts`. Streaming text arrives via internal events; the translator yields `{type:'assistant_delta', delta}`.
3. When the provider resolves, the translator yields `{type:'assistant_message', text}` (full text). Tool calls produce `{type:'tool_call', ...}` → tool dispatch → `{type:'tool_result', ...}` (or `tool_error`). Messaging tools dispatch through the IPC host (see §6).
4. Loop continues until pi decides the turn is complete.

On clean exit, the worker emits `{kind:'done', messages}` carrying the full final `ProviderMessage[]` view (built from pi's session) so the consumer can reconcile its render with authoritative state.

## 4b. `/compact`, `/context`, `/reset` — session commands

These run **inside the daemon** (not in a worker subprocess) — they're short read/edit operations on pi's session, no LLM streaming.

**`/compact`** delegates to pi's `session.compact()`: summarize the head, preserve a verbatim tail (default 10 messages), record a compaction marker pointing at the first kept entry. The HTTP endpoint at `apps/daemon/src/routes/agents.ts` (POST `/api/agents/:id/chat/compact`) opens the agent's session via `createBazilionSession` (with `apiKey` + `refreshApiKey` from `resolveAgentApiKey` — this *is* an LLM call to summarize, so OAuth refresh matters), calls `compact({keepTail, customInstructions})`, and returns `{before, after, summarized, keptTail, tokensBefore, tokensAfter, summary}`.

On replay, pi turns the compaction marker into a synthetic `assistant` message prefixed with `[conversation summary]\n\n…`; entries before the marker are skipped; entries from `firstKeptEntryId` onward pass through verbatim. The web UI renders a divider (`chat-msg-compaction`) instead of an agent bubble.

CLI: `bazilion agent chat-compact <id> [--keep-tail N] [--instructions "..."]`.

**`/context`** (GET `/api/agents/:id/chat/context`) returns a `ChatContextResponse`: per-file system-prompt contribution, tool count + total schema JSON chars + per-tool schema/description/param-count, skill list + per-skill block size, the agent's team block + USER.md size, history breakdown (message entries / compaction entries / chars / bytes / token estimate), and a `totals` line summing system prompt + tool schemas + history.

Implementation: calls `buildSystemPrompt(resolved)` for the total, re-renders the skills/team subsections inline for subsection sizes, opens `createBazilionSession` to enumerate tools and read pi's session stats. `?detail=1` (or `--json` on the CLI) emits the full `entries` arrays; default truncates to top 30.

**`/reset`** drops the agent's session(s) so the next turn starts with an empty transcript. Endpoint: `POST /api/agents/:id/chat/reset`; CLI: `bazilion agent chat-reset <id>`; web slash: `/reset`.

**`/truncate`** keeps the first N entries (`POST /api/agents/:id/chat/truncate {keepCount}`; CLI `bazilion agent chat-trim <id> --keep N`; web "edit last message" UI).

## 5. Provider layer (`providers/pi-adapter.ts` + `registry.ts`)

All provider traffic goes through pi-ai (`@earendil-works/pi-ai`). `piProvider(cfg)` adapts pi's `streamSimple(model, {systemPrompt, messages, tools}, {signal, apiKey, reasoning, …})` to Bazilion's `Provider.chat(ProviderRequest): Promise<ProviderResponse>`.

Model lookup tries `getModel(piProviderName, modelId)` first — returns a typed `Model<>` with cost/context-window metadata for catalog hits. Miss falls back to a hand-built literal (32k ctx, 4k maxTokens, zero cost) — this is what makes `lmstudio:<any-loaded-model>` or unreleased OpenAI models Just Work.

Message conversion: `system` is passed separately (pi keeps it out of the message array), `assistant` messages with tool calls are rebuilt as `{type:'text'|'toolCall'}` content blocks, `tool` messages become pi `toolResult` messages. The synthesized `usage`/`stopReason`/`api` fields on replayed assistant messages are load-bearing only for pi's type checker, not the LLM.

`apiKey` can be a function — providers like `openai-codex` use this for lazy OAuth refresh. The registry passes `() => loadOpenAICodexAccessToken(db, authToken)` so refresh happens at each `chat()` without rebuilding the cached Provider.

`loadProviderConfigFromEnv(env, oauth?)` takes an optional `{db, authToken}` to enable OAuth-backed providers; daemon-side callers always pass it, env-only callers (currently none in production code) can omit it.

`withRetry` wraps every provider uniformly. Retryable: 5xx, 429, connection resets, `overloaded_error`, etc. Non-retryable: 4xx auth/invalid_request/context_length. **Hard rule**: if `onDelta` already fired on this attempt (`streamed=true`), we throw instead of retrying — a retry would duplicate streamed text in the UI. Exponential backoff with `AbortSignal`-aware sleep, default 3 total attempts.

## 6. Tool registry (`tools/registry.ts` + `pi/tools.ts`)

`createToolRegistry(handlers[])` gives a dumb Map keyed on `def.name` with `list()/has()/invoke(name, jsonArgs)`. On `invoke`:
- `JSON.parse(jsonArgs)` — wrap errors with the tool name for better debugging
- Guard non-object args
- Call `handler.invoke(args)` — handler returns a string (the tool result content)

`createBazilionCustomTools` (`apps/daemon/src/runtime/pi/tools.ts`) composes the Bazilion-specific tool list and adapts each `ToolHandler` to pi's `ToolDefinition`:

- `memory_{write,read,search,list}` — qmd BM25 over markdown files in `<team.path>/memory/`. The store is **shared by every agent in the team** — descriptions explicitly say so and direct personal notes to `home_write IDENTITY.md` instead.
- `home_{read,write,list}` — scope = `<agentDir>/`, hard whitelist of identity files (`SOUL.md`, `IDENTITY.md`, `BOOTSTRAP.md`, `AGENTS.md`, `TOOLS.md`). No path arg, no traversal. `BOOTSTRAP.md` is read-only — `bootstrap_done` owns its lifecycle.
- `web_search` + `web_fetch` — SSRF-guarded, Readability + markdown, 15-min LRU cache, UA spoof, 20s timeout, 3 max redirects.
- `bootstrap_done` — deletes `BOOTSTRAP.md` after onboarding.
- `send_message` / `read_inbox` / `wait_for_reply` — registered only when a `messagingHost` is supplied (always true in production). The **MessagingHost interface** is the seam between the worker (which uses an IPC-backed implementation) and the daemon (which uses a DB-backed implementation):

  ```ts
  // apps/daemon/src/runtime/worker/ipc-protocol.ts
  export interface MessagingHost {
    agentExists(agentId: string): boolean | Promise<boolean>
    sendMessage(input: {...}): {messageId} | Promise<{messageId}>
    listInbox(agentId, opts: {unreadOnly}): Message[] | Promise<Message[]>
    markRead(messageId: string): void | Promise<void>
    findReplies(agentId, replyTo): Message[] | Promise<Message[]>
  }
  ```

  Worker-side IPC hosts in `worker/entry.ts` serialize args, send `process.send({type:'rpc', id, method, args})`, and await the matching `rpc-reply` (correlation by `id`). Daemon-side messaging passes through `createDbMessagingHost`; shell approval is owned by the daemon's ephemeral command-approval registry. `spawnWorkerTurn` wires both dispatch paths and injects approval state into the streamed turn frames.

The coding-tool surface is mode-dependent:

- **Off (default):** `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` come from
  pi-coding-agent's `createCodingTools(cwd, …)`, with the Team directory as `cwd`. This preserves
  existing host behavior.
- **Docker:** every host-backed Pi coding tool is removed. A custom tool still named `bash` runs
  each command in a fresh container with `/workspace` read/write, `/workspace/memory` read-only,
  optional `/inputs` and attached `/skills/...` mounts read-only, recursive bind propagation
  disabled, a scrubbed environment, a read-only root plus tmpfs `/tmp`, and network disabled.
  The image must already exist locally (`--pull never`), provide `/bin/bash` and `/usr/bin/env`,
  and declare no Docker `VOLUME`s; non-local Docker contexts and Docker/image/mount errors fail
  closed.

BAZ-006 adds both controls for the next release. `BAZILION_BASH_SANDBOX=docker` selects the hard
container boundary. Independently, `BAZILION_BASH_APPROVAL=dangerous` wraps either host or Docker
`bash`: safe commands continue immediately, while classified commands emit one turn-scoped
approval event. Web and TTY CLI turns can allow once or deny; scheduled, Telegram, background, and
non-TTY turns auto-deny without waiting. Timeout, cancellation, and disconnect all clear pending
state before the command can execute.

## 7. Cancellation end-to-end

```
POST /api/agents/:id/cancel
→ apps/daemon/src/lib/agent-cancel.ts: cancelAgent(id) → controller.abort()
→ parent's spawnWorkerTurn abort handler: child.kill('SIGTERM'), arm 3s → SIGKILL
→ child's SIGTERM handler: aborts its internal controller (calls session.abort())
→ pi unwinds the in-flight provider fetch via AbortSignal
→ translator emits {type:'error', error:'cancelled'} on the next event
→ worker emits the corresponding ChatFrame {kind:'event', event:{type:'error',…}}
→ then on `done` (or fatal), the worker disconnects IPC and exits 0
→ parent's runAgentTurn unregisters the agent in `finally`
```

There is no per-run row to update — pi's session JSONL records the partial assistant message + the error event as the last entries on the branch. The next chat turn picks up from there (or `bazilion agent chat-reset` clears it).

## 8. Scheduler (`apps/daemon/src/lib/scheduler.ts`)

Not strictly the engine, but it's the other caller of `runAgentTurn`. A `setInterval` (5s default, unrefed, pinned on `Symbol.for('bazilion.scheduler')` to survive module reloads) reads enabled triggers from `agent_triggers` each tick:
- `interval`: due when `now - (lastFiredAt ?? createdAt) ≥ intervalSec*1000`.
- `cron`: a 5-field parser (`apps/daemon/src/lib/cron.ts`) matched at minute resolution, with OR semantics on DOM/DOW. Guard: don't refire within the same minute-floor as `lastFiredAt`.

For a due trigger, the scheduler idempotently materializes a row in `trigger_dispatches` keyed
by `(trigger_id, scheduled_at)`, then advances `last_fired_at` to that scheduled occurrence.
That field is a scheduling watermark, not an execution-success flag. If the trigger already
has pending, running, or retrying work, later interval occurrences coalesce instead of creating
an unbounded queue.

Claimable dispatches are pending/retrying rows whose retry time has arrived plus running rows
whose lease expired after an interrupted daemon. A transactional claim creates a running
lease. A busy Agent causes the dispatch to be deferred without consuming an attempt; otherwise
the scheduler revalidates authorization and drains `runAgentTurn`. An approval-required result
keeps the dispatch pending; operator approval records a durable grant, and a later scheduler tick
still owns the turn, lease, retries, and final status. Worker `fatal` frames and Pi provider
`event:error` frames are both dispatch failures. Success is recorded as `succeeded`; failures use
bounded exponential retry and eventually become terminal `failed`.
The in-memory `firing` guard only prevents duplicate work inside one process—the dispatch row,
unique occurrence key, and lease are the durable recovery mechanism. Recent status is visible
through the trigger-history HTTP, CLI, and web surfaces.

The scheduler also runs an **inbox auto-deliver loop** each tick: `messageRepo.listRecipientsWithUnread(db)` returns idle agents with unread mail; for each, the scheduler drains the inbox into the agent's wake-up prompt and fires `runAgentTurn`. The agent-cancel registry's `isActiveAgent(agentId)` check prevents double-firing while a turn is in flight.

The turn's transcript lands in pi's session JSONL identically to HTTP chats;
`trigger_dispatches` stores delivery metadata only and does not duplicate conversation content.

## The shape that matters

Three layers, one contract:
- **`Provider.chat`** — pi-adapter + retry. Everything below it.
- **`session.prompt(message)`** — pi-coding-agent's own loop. Bazilion subscribes to its events via `session.subscribe(...)` and translates them into wire events.
- **NDJSON stdout** — what the worker writes is what the HTTP client reads, byte-for-byte. No translation between worker→daemon and daemon→client.

Plumbing around those three is invisible to callers: both the HTTP route and the scheduler see the same `AsyncGenerator<ChatFrame>` shape from `runAgentTurn`. The subprocess + IPC boundaries are an implementation detail.
