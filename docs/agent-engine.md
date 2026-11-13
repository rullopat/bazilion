# Agent engine

How one Agent turn runs, from the request to the streamed reply. Pi
([`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent))
owns the agent loop, provider calls and retries, compaction and the session JSONL. Bazilion owns
Agents and Teams, credentials, the tool list, the worker processes and the long-lived resources.

## 1. From request to worker

A turn starts from web or CLI chat (`POST /api/agents/:id/chat`), a queued follow-up, a Telegram
message, a scheduled trigger or an inbox wake. Each origin builds a `TurnRequest` and calls the
same two functions:

1. `prepareAgentTurn` (`apps/daemon/src/lib/turn-preparation.ts`) admits the turn before
   anything streams, so the chat route can still answer 4xx. It refuses a busy Agent (one with
   a running turn, or a change such as compaction or archiving in progress), resolves the Agent
   and its conversation, refuses a
   disabled provider or a disconnected ChatGPT account, registers the turn's `AbortController`
   under the Agent id, prepares the Docker settings when `BAZILION_BASH_SANDBOX=docker`, reads the
   workspace `AGENTS.md` files and saves non-image attachments to `uploads/`. Trigger and inbox
   turns arrive already registered by the scheduler.
2. `runAgentTurn` (`apps/daemon/src/lib/agent-turn.ts`) builds the daemon hosts behind the
   worker's tools, starts the worker with `spawnWorkerTurn`, relays its frames (mirroring them to
   Telegram) and ends the registration in `finally`.

Every origin gets the same tools and the same environment: the daemon's process environment over
stored secrets over stored config, minus Bazilion's own credentials (ChatGPT sign-in, MCP tokens,
the Telegram bot token, the bootstrap token). The origins differ in two ways only: `ask_user` is
offered when someone is there to answer (a foreground web or terminal chat, or a Telegram
message), and dangerous-command approval auto-denies when nobody can answer. Teammates' turns run
concurrently.

`apps/daemon/src/runtime/worker/spawn.ts` starts `entry.ts` with Node's type stripping (a packed
install runs `dist/worker.js`), detached into its own process group, with stdio
`['pipe', 'pipe', 'pipe', 'ipc']`:

- **stdin**: one `WorkerInput` JSON document (`runtime/worker/runtime.ts`), either an
  `agent_turn` or a `restricted_review`, listing the daemon hosts that serve it. The worker
  offers a tool only when its host is listed.
- **stdout**: NDJSON `ChatFrame`s (`packages/api-types/src/events.ts`): `{kind:'event', event}`
  per `SessionEvent`, then exactly one `{kind:'done', messages}` or `{kind:'fatal', error}`. A
  learning review ends with `{kind:'review_result', proposals}` instead.
- **stderr**: read into a bounded, redacted diagnostic.
- **IPC**: the worker calls `{type:'rpc', id, method, args}` and the daemon answers
  `{type:'rpc-reply', id, ok, result|error}`. `RpcMethods` in `ipc-protocol.ts` is the whole
  protocol; `RPC_HANDLERS` in `spawn.ts` answers each method from its host.

Frames, replies and stderr are redacted for the turn's access tokens, refreshed ones included.
While it serves an `askUser` or `bashApproval` call, the daemon adds its own `agent_question` or
`command_approval` event to the stream it relays.

## 2. The worker

`worker/entry.ts` installs its SIGTERM, SIGINT and IPC-disconnect handlers first, reads the input,
creates an IPC client and opens the session with `createBazilionSession`
(`apps/daemon/src/runtime/pi/session.ts`). The worker has no handle on Bazilion's database: every
daemon-backed tool (messages, USER.md, results, questions, web search, image generation, browser,
MCP, shell approval, ChatGPT token refresh) is a proxy over IPC. Only Team memory is opened
directly, as the qmd index inside `<team>/memory/`.

`createBazilionSession` opens the conversation file the daemon chose (a missing or unreadable one
is an error, never a silent fresh start) and builds a Pi `AgentSession` with:

- the model from `createPiModel` (credentials in memory, see section 7);
- Pi settings held in memory: cache warming off, compaction only on request, two provider retries;
- a resource loader with every discovery switched off (no extensions, skills, prompt templates,
  themes or context files), so a repository's `.pi/` cannot run code;
- the system prompt from section 3, appended to Pi's own;
- the repository `AGENTS.md` files as Pi project instructions;
- the tool list from section 5.

On a ChatGPT (`openai-codex`) model, Pi asks for an API key before each provider request and the
worker sends `refreshApiKey`. The daemon serves only the turn's own provider while the turn runs
and refreshes from the secrets table; only the access token comes back.

## 3. The system prompt

`runtime/session/prompt.ts:buildSystemPrompt` joins these sections, in order, when they apply:

1. **Agent instructions**: the Agent's `AGENTS.md`, `SOUL.md`, `TOOLS.md` and `IDENTITY.md`,
   copied from its Profile at spawn.
2. **First-Run Ritual**: while `BOOTSTRAP.md` exists, with the rule to call `bootstrap_done` when
   onboarding is complete.
3. **Agent Home**: what the private home is for, and `home_*` versus `memory_write`.
4. **Available Skills**: each attached skill's `SKILL.md` body and its runtime directory (the host
   directory, or its read-only `/skills/...` mount in Docker mode).
5. **Web research** and the **browser guide**, when those tools are present.
6. **Team**: the workspace path (`/workspace` in Docker mode) and the rule that an `AGENTS.md`
   governs its directory and everything below it.
7. **About the User**: the Team's USER.md, and how to update it with `user_md_get` /
   `user_md_write`.
8. **Reviewed lessons**: private lessons you approved, up to 8,000 characters.
9. **Memory**: the Team-shared memory and when to use it.

## 4. The turn loop

The worker calls `session.prompt(text, {images})` and `session.agent.waitForIdle()`. The user
message is in the session JSONL as soon as `prompt()` runs, so a killed worker does not lose it;
the next turn continues from the file.

A `session.subscribe` listener passes each Pi event through `runtime/pi/events.ts:translatePiEvent`,
which redacts known credential values and yields `SessionEvent`s:

- `user_message`, `assistant_delta` (streamed text), `assistant_message` (the full text);
- `tool_call`, then `tool_progress` (a cumulative tail of a running tool's output, at most every
  250 ms and 8 KiB), then `tool_result` (with optional images) or `tool_error`;
- `error` (`'cancelled'` after a cancel).

The worker also emits `file` when a tool saves a result, and the daemon adds `agent_question` and
`command_approval` (section 1).

On a clean end the worker emits `done` with the conversation as `ProviderMessage[]`, so a client
can reconcile its view. The JSONL file is the only record of the conversation.

## 5. Tools

`runtime/pi/tools.ts:createBazilionCustomTools` builds Bazilion's tools and adapts each to Pi:

- `memory_write|read|search|list`: the Team's shared qmd (BM25) store in `<team>/memory/`; keys
  are Markdown paths such as `notes/topic.md`.
- `home_read|write|list`: the Agent's own documents, by name only; `BOOTSTRAP.md` is read-only.
- `bootstrap_done`: removes `BOOTSTRAP.md`.
- `web_fetch`: a guarded page fetch (no private addresses, also after redirects) turned into
  Markdown. `web_search`, when a search backend is ready, runs in the daemon.
- `send_message`, `read_inbox`, `wait_for_reply`: the mailbox. Every message carries a causal chain
  and hop count; the daemon refuses a send past `BAZILION_AGENT_LOOP_MAX_HOPS` (default 8) and
  records the stop.
- `user_md_get` / `user_md_write`, `deliver_file`, `image_generate`, `ask_user`, `browser_*` and
  `mcp__<server>__<tool>`: each present when its host is.

The coding tools depend on `BAZILION_BASH_SANDBOX` and `BAZILION_BASH_APPROVAL`
(`runtime/shell/tooling.ts`):

- **off**: Pi's own `read`, `bash`, `edit`, `write`, `grep`, `find` and `ls` run on the host, in
  the Team directory.
- **docker**: the host tools are removed; a custom `bash` runs each command in a fresh container
  (`runtime/shell/docker.ts`) with the Team directory at `/workspace`, `memory/`, `/inputs` and
  attached skills read-only, no network and no host environment. A Docker failure is the
  command's error, never a host fallback.
- **approval**: with `BAZILION_BASH_APPROVAL=dangerous`, `bash` (host or Docker) first classifies
  the command (`runtime/shell/security.ts`). A flagged command asks the daemon, which streams a
  `command_approval` event and waits up to two minutes for `POST /api/shell-approvals/:id`, or
  denies at once when nobody can answer.

## 6. Conversation commands

These run in the daemon, not in a worker.

- **Compact** (`POST /api/agents/:id/chat/compact`, `bazilion agent chat-compact <id>
  [--instructions "..."]`, `/compact` in the web chat) opens the session and calls Pi's
  `compact()`: older messages become one summary and the recent part stays verbatim. This is a
  model call; the Agent counts as busy until it ends.
- **Context** (`GET /api/agents/:id/chat/context[?detail=1]`, `bazilion agent chat-context <id>`,
  `/context`): the prompt sections, tool schemas, skills, USER.md and history size the next turn
  would carry, computed by `describeTurn` without starting a model.
- **Truncate** (`POST /api/agents/:id/chat/truncate`, `bazilion agent chat-trim <id> --keep N`, the
  web chat's edit of the last message) keeps the first N messages for the next turn by moving the
  conversation's leaf back and appending a `bazilion.truncate` marker; the file stays
  append-only.
- **New conversation** (`POST /api/agents/:id/conversations`, `bazilion conversation new <agent>`,
  `/new`) starts an empty history and keeps the old ones. See [conversations](conversations.md).

## 7. Providers and Pi

The daemon and the packed CLI pin `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent` and
`pi-mcp` to the same version (1.4.0). An operator's own Pi install is not touched.

- **Provider table.** `apps/daemon/src/core/providers.ts` has one `PROVIDERS` entry per provider:
  its `/config` card, key and credential variables, Pi's id where it differs, an endpoint the
  operator may set, local servers (LM Studio, Ollama, llama.cpp) and live `/models` listings.
  Pi's bundled catalog supplies the model ids. Model strings are `provider:model`.
- **Model runtime.** `runtime/providers/pi-runtime.ts:createPiModel` builds a Pi `ModelRuntime`
  whose credentials live in memory only; Pi reads no auth or model files and fetches no catalog.
  An id that is not in the catalog goes only to an endpoint the provider declares, otherwise it
  fails as "Unknown model", so a typo never sends a key to another vendor's default URL.
- **Enabled providers.** A provider is usable once it is enabled on `/config` or with
  `bazilion provider enable <id>`; turns, compaction and the provider test refuse a disabled one.
- **Provider test.** `POST /api/providers/test` (`bazilion provider test <provider:model>`) sends
  one short request through the same runtime and reports the reply or the provider's error.
- **MCP** runs in the daemon with `pi-mcp`; workers only proxy calls. See [MCP](mcp.md).
- **Web search and image generation** are daemon hosts, not Pi extensions. See
  [web research](web-research.md) and [image generation](image-generation.md).
- **Upgrading Pi.** Bump the four packages together in `apps/daemon` and `apps/cli`, keep the
  settings above, and run the gates. A catalog change can add or drop model ids; saved Agent model
  choices are not rewritten. Upstream:
  [SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md),
  [models](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/models.md),
  [MCP client](https://github.com/earendil-works/pi/blob/v1.4.0/packages/mcp/README.md).

## 8. Cancellation and shutdown

```text
POST /api/agents/:id/cancel  (bazilion agent cancel <id>, Stop in the web chat, /stop in Telegram)
→ lib/agent-cancel.ts: cancelAgent(id) aborts the turn's controller
→ spawn.ts: SIGTERM to the worker's process group, SIGKILL after 3 s
→ the worker's handler calls session.abort(); Pi aborts the provider request
→ the worker emits {type:'error', error:'cancelled'}, disconnects IPC and exits
→ runAgentTurn removes the turn's Docker containers and unregisters the Agent
```

When a worker exits, whatever is left in its process group is killed and its pipes are read for
one more second at most. A command that detached into another process group is not tracked. Docker
containers carry a per-home, per-turn name prefix; they are removed when the turn ends and, by the
home prefix, when the daemon starts. On SIGINT or SIGTERM the daemon stops accepting turns, aborts
the running ones and waits for them before closing browsers, MCP connections and the database.

## 9. Scheduler

`apps/daemon/src/lib/scheduler.ts` ticks every 5 s (`BAZILION_SCHEDULER_TICK_MS`;
`BAZILION_SCHEDULER=off` disables it) and does three jobs:

- **Triggers.** An interval trigger is due when `last_fired_at + every` has passed (the creation
  time counts as the first `last_fired_at`); a cron trigger is due when the current minute matches
  its 5-field expression (`lib/cron.ts`, daemon local time). The due occurrence is recorded in
  `trigger_dispatches` and runs at most once: a busy Agent leaves it pending, then it ends
  succeeded, failed or cancelled, and nothing is retried. While one is open, later interval
  occurrences coalesce, and a minute missed while the daemon was down is not caught up. A run cut
  short by a daemon stop is marked failed at the next start. Failures show in Attention and in
  `bazilion trigger history <id>`.
- **Inbox wakes.** An idle Agent with unread mail gets one turn whose prompt contains the
  messages, marked read in the same transaction. If that turn cannot start, the messages go back to
  unread and the Agent's wakes back off from 10 s, doubling up to 5 minutes.
- **Learning reviews.** Agents with reviewed learning on and enough new turns get a review in a
  restricted worker with a minimal environment, whose only tool is `propose_lesson`.

Scheduled turns are ordinary turns: their transcript is the same JSONL, and
`trigger_dispatches` keeps only delivery state.
