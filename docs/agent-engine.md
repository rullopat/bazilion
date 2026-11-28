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
   workspace `AGENTS.md` files and saves non-image attachments to `uploads/`, transcribing audio
   when a Transcription model is chosen (`lib/transcription.ts`). Trigger and inbox
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

- **stdin**: one `WorkerInput` JSON document (`runtime/worker/runtime.ts`), an `agent_turn`
  listing the daemon hosts that serve it. The worker offers a tool only when its host is listed.
- **stdout**: NDJSON `ChatFrame`s (`packages/api-types/src/events.ts`): `{kind:'event', event}`
  per `SessionEvent`, then exactly one `{kind:'done', messages}` or `{kind:'fatal', error}`.
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
- Pi settings held in memory: cache warming off, two provider retries, and Pi's compaction: a
  turn summarizes older messages when the conversation comes within 16,384 tokens of the model's
  window, keeping about the last 20,000 verbatim, and redoes a reply the full window cut short. A
  window under 80,000 tokens keeps at most a quarter of it each way (`compactionFor`), so a
  summary leaves room to grow and to reply. The window is Pi's catalog's. For a local server's
  model it is the one the server says it loaded the model with, asked each turn with a 2-second
  limit: llama.cpp's `meta.n_ctx` in `GET /v1/models`, LM Studio's
  `loaded_instances[].config.context_length` in `GET /api/v1/models`, Ollama's `context_length`
  in `GET /api/ps`. Otherwise it is the one set by hand (`ResolvedAgent.contextWindowSetting`,
  from the `MODEL_CONTEXT_WINDOWS` config row), and with none the turn is refused. A reply may
  use what the window leaves: Pi fits each request's limit into it. The daemon keeps the window
  each turn's model was given for its own reads, such as the meter (`turnContextWindow`). The
  summarized messages stay in the file, and `recall` reads them (section 5);
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
   onboarding is complete, and not to ask what the Team's USER.md already says. Only in a turn you
   started (a chat, a follow-up, Telegram): a schedule or a teammate's message gets a note to do the
   work instead, since nobody is there to answer.
3. **Agent Home**: what the private home is for, and `home_*` versus `memory_write`.
4. **Available Skills**: each attached skill's `SKILL.md` body and its runtime directory (the host
   directory, or its read-only `/skills/...` mount in Docker mode).
5. **Web research**, **Connections** (the MCP connections whose tools wait to be found, with
   their tool counts) and the **browser guide** (the browser this conversation uses, and when to
   switch), when those tools are present.
6. **Team**: the workspace path (`/workspace` in Docker mode), the rule that an `AGENTS.md`
   governs its directory and everything below it, and **Your teammates**: every other Agent of the
   Team by name and id, split by whether Team Policy lets this Agent message it, plus the Agents of
   other Teams it may reach (`lib/team-host.ts:agentContacts`, read when the turn starts). A
   teammate that calls itself something else in its IDENTITY.md is listed with that name too, and
   `send_message` takes either name.
7. **About the User**: the Team's USER.md, and how to update it with `user_md_get` /
   `user_md_write`.
8. **Memory**: the Team-shared memory and when to use it, and `recall` for a detail a summary of
   the conversation left out.

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
- `recall`: the messages of the conversation that its latest compaction summarized, read from
  the session file as it stands, so a compaction made during the turn counts at once
  (`runtime/tools/recall.ts`). `query` lists the latest 12 that hold every word, tool calls and
  results included, with their numbers; `from` and `count` (at most 20) read them in full, about
  20,000 characters a call, cutting a long message less when fewer are read. Stored credentials
  are taken out. Before any compaction it says there is nothing to recall. With
  `everywhere: true`, `query` also searches every message of the Agent's other conversations, and
  `conversation` with `from` reads one of them; only the Agent's own, read by the daemon
  (`lib/recall-host.ts`).
- `home_read|write|list`: the Agent's own documents, by name only; `BOOTSTRAP.md` is read-only.
- `bootstrap_done`: removes `BOOTSTRAP.md`.
- `web_fetch`: a guarded page fetch (no private addresses, also after redirects) turned into
  Markdown. `web_search`, when a search backend is ready, runs in the daemon.
- `send_message`, `read_inbox`, `wait_for_reply`: the mailbox. `wake: false` sends a quiet
  message, which waits in the inbox without starting a turn; the recipient's next turn is told
  how many are unread. `wait_for_reply` takes several message ids and returns each reply as it
  comes. `to` is an id or a name, a
  teammate's name first (`lib/messaging-host.ts:recipientOf`). Every message carries its exchange
  (`causal_chain_id`) and step (`causal_hop`), with no limit on steps. The daemon refuses a message
  its sender already sent the same Agent in the exchange, and any message in an exchange the user
  stopped (`lib/agent-loop-guard.ts`), recording the stop; an inbox wake shows the exchange so far
  (`lib/exchanges.ts`). See [Team Policy](team-policy.md#exchanges-between-agents).
- `agent_create`: adds an Agent to the Agent's own Team (name, role, optional template and model,
  by default its own), only in a turn you started and at most six per turn
  (`lib/team-host.ts`). The new Agent's `AGENTS.md` starts with its role and who made it, it gets
  no first-run ritual, and in a restricted Team it is connected with its creator both ways.
- `secret_request` (where `ask_user` is) and `secret_list`: secrets by name; the value goes from a
  masked card to the daemon's store and reaches the Agent's commands as an environment variable
  and `web_fetch` headers written `{{secret:NAME}}` (`lib/agent-secrets.ts`); see
  [questions](questions.md#secrets-an-agent-asks-for). Tool results go to the model with secrets
  and Bazilion's credentials taken out (`redactToolResults` in `runtime/pi/session.ts`). A
  command's output loses them as it arrives, so the file Pi writes the whole of a long one to,
  in the system's temporary folder, holds none either (`redactedOutput` in
  `runtime/shell/tooling.ts`).
- `view_image` shows the model pictures: files in the workspace or uploads, URLs (through the
  `web_fetch` guard) and saved results, PNG, JPEG, GIF or WebP up to 25 MiB each; a model that
  takes no images gets Pi's note instead. `pdf_read` gives a PDF's text page by page (`pages`
  such as `2-5`), in parts of a snapshot's size (`part`), and marks a page without text; it has no
  OCR (`runtime/tools/documents.ts`, with unpdf). Both read files as the file tools do: container
  paths in Docker, the workspace and uploads on the host.
- `helper_start`, `helper_wait`, `helper_stop`: [helpers](#helpers), not in a helper's own turn.
- `schedule_add`, `schedule_list`, `schedule_remove`: the Agent's own schedules
  (`lib/schedule-host.ts`), in every kind of turn; see [the scheduler](#9-scheduler).
- `video_generate`, `audio_generate`, `speak` and `transcribe`: each while its model is chosen
  under Setup → Models and has its key (`lib/media-host.ts`, the calls in `lib/media/`). A video
  always runs in the background and wakes the Agent when it is saved; music and sound wait, or
  run in the background with `background: true`. What they make is saved as a result at most
  25 MiB. `transcribe` reads a file of the workspace or uploads, up to what the transcription
  model takes, and gives its lines with their times when the model gives them. See
  [video and sound](video-and-sound.md) and [speech](speech.md).
- `progress`, `screen`, `theme` and `canvas`: the Agent in the workspace
  (`runtime/tools/workspace.ts`). `progress` is a card of steps that later calls update by its id
  (one Telegram message, edited); `screen` opens a panel tab, a view or one of the Agent's sheets,
  and `theme` the light or dark theme, in the browser tabs that show the conversation (a live
  event, `lib/workspace-host.ts`); `canvas` saves an HTML page or SVG drawing that the chat shows
  in a sealed frame. See [the workspace](workspace.md#the-agent-in-the-workspace).
- `browser_use`: switches the conversation between the Agent's own browser and your running
  Chrome; the browser tools then work there until it switches back. Moving to your Chrome waits
  for your approval unless it is the default (`lib/browser/host.ts`); see
  [the managed browser](browser-research.md#its-own-or-yours-per-conversation).
- `user_md_get` / `user_md_write`, `deliver_file`, `image_generate`, `ask_user`, `browser_*` and
  `mcp__<server>__<tool>`: each present when its host is. `deliver_file` with `result` shows one of
  the Agent's saved results again. `ask_user` takes a card of `questions` or an `action` (see
  [questions](questions.md)); an action returns at once and the owner's answer wakes the Agent.

The coding tools depend on `BAZILION_BASH_SANDBOX` and `BAZILION_BASH_APPROVAL`
(`runtime/shell/tooling.ts`):

- **off**: Pi's own `read`, `bash`, `edit`, `write`, `grep`, `find` and `ls` run on the host, in
  the Team directory.
- **docker**: a custom `bash` runs each command in a fresh container (`runtime/shell/docker.ts`)
  with the Team directory at `/workspace`, `memory/`, `/inputs` and attached skills read-only, no
  network and no host environment. A Docker failure is the command's error, never a host
  fallback. The file tools are Bazilion's own on container paths (`runtime/shell/file-tools.ts`,
  `container-paths.ts`).
- `apply_patch` in both modes (`runtime/tools/apply-patch.ts`).
- **jobs**: `bash` takes `background: true`, and `job_list`, `job_output`, `job_input` and
  `job_stop` act on the Agent's jobs, which the daemon runs past the turn (`lib/jobs.ts`); see
  [coding environments](coding-environments.md#background-jobs).
- **approval**: with `BAZILION_BASH_APPROVAL=dangerous` or `review`, `bash` (host or Docker) first
  classifies the command (`runtime/shell/security.ts`). A flagged command asks the daemon
  (`lib/bash-approval.ts:createTurnApprovalHost`): an Agent's rule allows it at once; with
  `review`, the review model answers next (`lib/command-review.ts`); otherwise the daemon streams a
  `command_approval` event and waits up to five minutes for `POST /api/shell-approvals/:id` (or a
  tap in Telegram, see [coding environments](coding-environments.md)), or denies at once when
  nobody can answer.

### Tool search and Code Mode

Every turn has Pi's own `codemode` and, when it has MCP tools, `tool_search`, added in code as
Pi extensions (`runtime/pi/tool-reach.ts`); nothing is discovered from disk.

- MCP tools are not declared to the model: the prompt lists their connections, `tool_search`
  loads the ones a task needs (BM25 over names and descriptions), and they stay loaded for the
  rest of the conversation (each turn applies the loads its branch recorded again).
- `codemode` runs a JavaScript script in a QuickJS sandbox with no network, files or timers: it
  reaches the world only through `tools.<name>(args)`, any of the turn's tools, MCP tools that
  are not loaded included, and keeps small values across scripts with `store` and `load`. Only
  what the script prints or returns reaches the model. `ask_user`, `secret_request`,
  `browser_use` and `tool_search` are the model's own and cannot be called from a script.
- Calls a script makes go through the same checks as the model's: a dangerous command or a tool
  that asks first waits for you. The conversation shows the script as one step, **Ran a script**,
  with the calls it made and their state, live and afterwards, and the files and pictures they
  saved; the calls are not steps of their own.
- Scripts get no `models` (Pi's classifiers and image models). A long output is cut, and the
  whole of it written to a file in the system's temporary folder, as a long command output is;
  a Docker turn cannot read it.
- Credentials are taken out of what a script's calls return, structured results included (a call
  resolves to the object its tool declares, such as bash's `exit_code`), and of the record of
  those calls kept with its result (`redactNestedCalls`, an extension, since Pi runs those calls
  with its own hooks); and out of a long output's file once the script returns
  (`redactScriptOutputFile`).

### Helpers

`helper_start` (a task, optionally a `provider:model`) starts a helper: a turn of the same Agent
with origin `helper`, in a new conversation titled `Helper: …` that is not selected, beside the
Agent's own turn, which it neither waits for nor marks busy (`lib/helpers.ts`). Its first message
says it is a helper; it has the Agent's tools except the helper tools, `ask_user` and
`secret_request`, dangerous commands are refused as in any unattended turn, and what it delivers
or schedules belongs to the conversation that started it. Its last message is its answer.
`helper_wait` takes ids and waits until all of them end (or `wait_seconds`), showing each one's
current step as live output; `helper_stop` ends one. Several run at once, each a worker, with no
cap. An answer that comes after the starting turn ended wakes the Agent there, unless a later
`helper_wait` took it; stopping that turn stops its helpers, and so does deleting, archiving or
moving the Agent or closing or resetting its browser. A helper's background jobs and pictures
wake the conversation that started it. The Agent's **Helpers** sheet and `bazilion agent helpers <agent> [--stop
<id>|all]` list them (`GET /api/agents/:id/helpers`, `POST …/helpers/:helperId/stop`), and the
panel counts the ones working. Helpers live in memory: a restart stops them, and their
conversations stay. Usage counts each helper's conversation under its Agent.

## 6. Conversation commands

These run in the daemon, not in a worker.

- **Compact** (`POST /api/agents/:id/chat/compact`, `bazilion agent chat-compact <id>
  [--instructions "..."]`, `/compact` in the web chat) opens the session and calls Pi's
  `compact()`: older messages become one summary and the recent part stays verbatim. This is a
  model call; the Agent counts as busy until it ends. Turns also compact on their own near the
  window (section 4); a compaction during a turn streams as a `compaction` event.
- **History** (`GET /api/agents/:id/sessions/messages`, the `done` frame of a turn, an earlier
  conversation's `GET …/conversations/:id`): every message of the conversation's branch, those a
  compaction summarized included, with `compactions` (where each summary starts and what it says)
  and `context` (the tokens the model reported for its last reply after the latest compaction, and
  the window). The model's own view is only the latest summary and what follows it
  (`runtime/pi/history.ts`).
- **Context** (`GET /api/agents/:id/chat/context[?detail=1]`, `bazilion agent chat-context <id>`,
  `/context`): the prompt sections, tool schemas, skills, USER.md and history size the next turn
  would carry, computed by `describeTurn` without starting a model, and how full the window is.
- **Truncate** (`POST /api/agents/:id/chat/truncate`, `bazilion agent chat-trim <id> --keep N`, the
  web chat's edit of the last message) keeps the first N messages, counted as the history above
  counts them, by moving the conversation's leaf back to just before the first one dropped (a
  compaction in between stays) and appending a `bazilion.truncate` marker; the file stays
  append-only.
- **New conversation** (`POST /api/agents/:id/conversations`, `bazilion conversation new <agent>`,
  `/new`) starts an empty history and keeps the old ones. See [conversations](conversations.md).

## 7. Providers and Pi

The daemon and the packed CLI pin `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent` and
`pi-mcp` to the same version (1.6.0). An operator's own Pi install is not touched.

- **Provider table.** `apps/daemon/src/core/providers.ts` has one `PROVIDERS` entry per provider:
  its fields, key and credential variables, Pi's id where it differs, an endpoint the operator
  may set, local servers (LM Studio, Ollama, llama.cpp), live `/models` listings and the models
  suggested when connecting. Pi's bundled catalog supplies the model ids with their names, sizes
  and list prices. Model strings are `provider:model`.
- **Model runtime.** `runtime/providers/pi-runtime.ts:createPiModel` builds a Pi `ModelRuntime`
  whose credentials live in memory only; Pi reads no auth or model files and fetches no catalog.
  An id that is not in the catalog goes only to an endpoint the provider declares, otherwise it
  fails as "Unknown model", so a typo never sends a key to another vendor's default URL.
- **Connected providers.** Connecting (`POST /api/config/providers/:id/connect`,
  `bazilion provider connect <id>`, `lib/provider-setup.ts`) asks the cheapest chosen model for a
  short reply and only then saves the fields and models and switches the provider on. Turns,
  compaction and the provider test refuse a provider that is switched off, and one cannot be
  switched on without credentials. See [models and providers](models-and-providers.md).
- **Model list.** Each provider's chat models (`bazilion provider models-set <id> <models>`)
  feed the model pickers. `PUT /api/config/models/window` (`bazilion provider window`) sets the
  context window of one whose window neither the catalog nor its server says; taking a model out
  of the list forgets it. Saving it without a model that an Agent template defaults to moves the
  template to the provider's first remaining model, or to the first available model of another
  provider when none remains; the save reports each move. A template on a model that was never
  listed and an Agent's own model override are left as they are.
- **Provider test.** `POST /api/config/providers/:id/test` (`bazilion provider test <id>`) asks
  a provider's cheapest chat model, and `POST /api/providers/test`
  (`bazilion provider test <provider:model>`) one named model, through the same runtime. The
  outcome is kept as the provider's state, with a failure worded for the operator
  (`lib/provider-failure.ts`) beside the provider's own message.
- **MCP** runs in the daemon with `pi-mcp`; workers only proxy calls. See [MCP](mcp.md).
- **Web search and image generation** are daemon hosts, not Pi extensions. See
  [web research](web-research.md) and [image generation](image-generation.md).
- **Upgrading Pi.** Bump the four packages together in `apps/daemon` and `apps/cli`, keep the
  settings above, and run the gates. A catalog change can add or drop model ids; saved Agent model
  choices are not rewritten. Upstream:
  [SDK](https://github.com/earendil-works/pi/blob/v1.6.0/packages/coding-agent/docs/sdk.md),
  [models](https://github.com/earendil-works/pi/blob/v1.6.0/packages/coding-agent/docs/models.md),
  [MCP client](https://github.com/earendil-works/pi/blob/v1.6.0/packages/mcp/README.md).

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
`BAZILION_SCHEDULER=off` disables it) and does four jobs:

- **Triggers.** An interval trigger is due when `last_fired_at + every` has passed (the creation
  time counts as the first `last_fired_at`); a cron trigger is due when the current minute matches
  its 5-field expression (`lib/cron.ts`, daemon local time); a one-time trigger is due once its
  time has come and it has not run since. The due occurrence is recorded in
  `trigger_dispatches` and runs at most once: a busy Agent leaves it pending, then it ends
  succeeded, failed or cancelled, and nothing is retried. While one is open, later interval
  occurrences coalesce, and a minute missed while the daemon was down is not caught up. An
  interval or a one-time trigger whose time passed while the daemon was down runs once at the
  next start. A run cut short by a daemon stop is marked failed at the next start. Failures show
  in Attention and in `bazilion trigger history <id>`. The Schedules sheet and
  `bazilion trigger list` say when each trigger runs next (`nextRuns` in
  `GET /api/agents/:id/triggers`; none while it is paused, once a one-time trigger has run, or
  while the scheduler is off, which they also say).
- **Schedules an Agent sets.** `schedule_add` takes a message and one of `at` (a local time),
  `in_minutes`, `every_minutes` and `cron`; its description gives the current time and time zone.
  The trigger is stored with `set_by = 'agent'` and the conversation it was set in, and runs
  there, or in the selected conversation once that one is gone. Its turn's message says that the
  Agent set it. `schedule_list` shows all the Agent's schedules and who set each;
  `schedule_remove` removes only its own. Agents have these tools in every kind of turn. You
  change or remove any schedule: in the Schedules sheet (**Change…**, **Delete…**), with
  `bazilion trigger edit|rm`, or `PATCH /api/triggers/:id` (`message`, and a new timing as
  `kind` with its field).
- **Inbox wakes.** An idle Agent with unread mail gets one turn whose prompt contains the
  messages, marked read in the same transaction, in the Agent's current conversation. The
  Agent must answer a new message with `send_message`. A reply is not answered back: the Agent
  tells you what it brought back and delivers the files it names (`buildInboxPrompt` in
  `lib/scheduler.ts`). If that turn cannot start, the messages go back to
  unread and the Agent's wakes back off from 10 s, doubling up to 5 minutes. A wake that fails,
  or cannot start, is listed in Attention as a failed turn
  ([Attention](attention-notifications.md#failed-background-turns)).
- **Wakes.** Something an Agent started that ends after its turn (a background job) starts a
  turn of its own when the Agent is free, in the conversation it came from, several of one
  conversation in one turn (`lib/wakes.ts`). The turn's message starts with `[[bazilion:wake]]`
  and the transcript shows it as an update. Wakes are kept in memory; a job's record queues its
  wake again at the next start. One that cannot start waits and backs off like an inbox wake, and
  shows in Attention.

Scheduled turns are ordinary turns: their transcript is the same JSONL, and
`trigger_dispatches` keeps only delivery state.
