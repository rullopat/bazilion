# Telegram integration — user story

Living design doc. Captures decisions made and the user story we've agreed on so far. Implementation has not started — this PR is the kickoff. Update this file as the story evolves.

## Problem

Bazilion agents today are reachable from the web UI, the CLI, and (over LAN) the mobile app. None of those are good for the "ping me from the bus" case. We want a phone-friendly external surface — Telegram first — that lets a single user talk to **any** of their agents and groups from one app.

A naive "one bot per agent" approach is unworkable (a BotFather token and chat per agent). A naive "one bot, one chat" approach loses the ability to switch context cleanly. The right primitive is Telegram's **forum supergroup**: one supergroup with topics enabled, one topic per conversation thread. The bot is admin in that supergroup, creates/closes topics on demand, and routes messages by `message_thread_id`.

## Decisions so far

1. **Topic granularity: one topic per agent.** Each bazilion agent is bound to exactly one forum topic; the topic is permanent for the agent's lifetime. Matches the proven "agent-persona-per-topic" pattern from existing open-source forum bots.
2. **Topic creation: auto-create on first traffic.** When an agent needs to send to Telegram (heartbeat fires, user replies via web, etc.) and isn't bound to a topic yet, the daemon calls `createForumTopic` lazily and persists the returned `message_thread_id`. Inbound human-initiated binding happens via a `/talk <agent>` slash command in the General topic.
3. **Pairing: one bot, one supergroup, global per install.** The user configures `{ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID }` once in `/config`; every agent in this bazilion install shares that supergroup. Cross-group agents land in the same forum, distinguished by topic name + icon.

## User story walkthrough

### Setup (one-time, in `/config`)

1. User creates a bot via `@BotFather`, copies the token.
2. User creates a Telegram supergroup, enables **Topics** in group settings.
3. User adds the bot to the supergroup and promotes it to admin with `can_manage_topics` (and `can_delete_messages` if they want bazilion-driven topic cleanup).
4. In bazilion's web UI: `Config → Integrations → Telegram` → paste bot token + supergroup chat ID. Token goes to the encrypted `secrets` table as `TELEGRAM_BOT_TOKEN`; chat ID goes to the plaintext `config` table as `TELEGRAM_CHAT_ID`.
5. Daemon registers the webhook (`setWebhook` with a secret token header) pointing at `https://<bazilion-host>/api/telegram/webhook`.

**Public URL requirement.** Webhooks need a publicly reachable URL. For LAN-only installs (the default `bazilion serve` on `127.0.0.1`), the user needs a tunnel — Tailscale Funnel, Cloudflare Tunnel, or ngrok. We will document a recommended Tailscale Funnel recipe. **Long-polling is the documented fallback** for purely-local installs, opt-in via `bazilion telegram poll` (a foreground process that drives `getUpdates`).

### Binding an agent to a topic

Two paths reach the same end-state — an `agents.telegram_topic_id` populated and a forum topic alive:

- **Daemon-initiated (auto).** Agent has unread outbound (heartbeat, scheduler trigger, assistant turn from the web chat). Daemon checks `telegram_topic_id`. If null, calls `createForumTopic({ name: agent.name, icon_color, icon_custom_emoji_id })` against the configured supergroup, persists the returned `message_thread_id`, then sends the message into the new topic.
- **Human-initiated (explicit).** Human is in the supergroup, posts `/talk <agent-name>` (or `/talk <agent-id>`) in the **General topic**. Bot resolves the name, creates the topic if not already bound, posts a deep-link to it in General, and the human taps in.

In both cases, the topic name is `agent.name`, the icon color is derived from the agent's profile (so all "researcher" agents are green, all "coder" agents are blue), and the icon emoji can be customized later via `bazilion agent set-topic-icon`.

### Steady-state traffic

**Inbound (Telegram → bazilion).** Webhook hits `POST /api/telegram/webhook` (publicly accessible, gated by `X-Telegram-Bot-Api-Secret-Token` rather than the daemon's bearer auth). Daemon routes the update:

- `is_topic_message && (chat_id, message_thread_id) → agentId`: enqueue as a user-message on that agent, kick off `runAgentTurn`, stream the assistant's reply back into the same topic via `sendMessage(chatId, text, { message_thread_id })`.
- General topic (no `message_thread_id`, or `<= 1`): only respond to slash commands (`/talk`, `/list`, `/help`, `/health`). Plain text in General is ignored — General is a control channel, not a chat surface.
- Unknown topic (orphan, mapping cleared): respond with a one-liner "this topic isn't bound to an agent" and offer `/adopt <agent-name>` to re-bind.

**Outbound (bazilion → Telegram).** Every assistant message and tool-emitted message that an agent produces gets mirrored to its bound topic, *if* a topic is bound. The mirror happens in the daemon's NDJSON stream consumer inside `runAgentTurn`, downstream of the existing messaging tools. Mirror policy is "everything by default, agent-level opt-out flag for later" — we are not building per-message visibility controls in v1.

### Lifecycle

- **Agent deleted in bazilion.** Daemon calls `closeForumTopic` by default (preserves history, agent can be "restored" later). A `bazilion agent delete --purge-telegram` flag would call `deleteForumTopic` (destructive).
- **Topic deleted in Telegram by a human.** No webhook fires. Daemon discovers it lazily on the next outbound send when `sendMessage` returns `400 Bad Request: message thread not found`. Reconcile logic: clear `agents.telegram_topic_id`, log the orphan, recreate on next traffic (which will trigger the auto-create path again).
- **Bot loses `can_manage_topics`.** Existing topics keep working (sends still route), but `createForumTopic` calls 403. Daemon surfaces this via a health check on `/config/integrations/telegram` and a banner on agents that have no `telegram_topic_id` yet.

### Multi-user in the supergroup

The supergroup membership *is* the auth boundary. If the user adds family/teammates to the supergroup, those people can talk to every agent. There is no per-user authorization layer. This will be loudly documented; finer-grained access control is deferred to a later iteration.

## What this lands in the codebase (sketch)

Not committing to these paths yet — this is a shape preview, not the implementation plan.

- **Migration.** `apps/daemon/src/core/db/migrations/0003_agent_telegram.sql` adds `agents.telegram_topic_id INTEGER NULL UNIQUE` (one topic ↔ one agent).
- **Config & secrets keys.** `TELEGRAM_BOT_TOKEN` (secrets), `TELEGRAM_CHAT_ID` (config), `TELEGRAM_WEBHOOK_SECRET` (secrets, auto-generated on setup). All added to `apps/daemon/src/core/services.ts`.
- **Runtime module.** `apps/daemon/src/lib/telegram/{bot.ts,webhook.ts,routing.ts,commands.ts}`. Singleton on `ctx.telegramBot`. Built on **grammY** with its built-in `webhookCallback(bot, 'hono')` adapter.
- **HTTP routes.**
  - `POST /api/telegram/webhook` — public, secret-token-authed via header. Bypasses `middleware-auth`. Whitelisted in the first-run gate.
  - `PUT|DELETE /api/config/telegram` — bearer-authed CRUD for credentials.
  - `GET /api/config/telegram/health` — admin-rights ping, returns `{ botUsername, chatTitle, hasManageTopics, hasDeleteMessages, webhookSet }`.
- **CLI surfaces.** `bazilion telegram setup`, `bazilion telegram health`, `bazilion telegram bind <agent-id>` (manual fallback), `bazilion telegram poll` (long-polling daemon mode for non-public hosts).
- **Web UI.**
  - `/config/integrations/telegram` — setup form + health card.
  - Per-agent: a small "Telegram: bound to topic #N" indicator on the agent card and detail page, with a "Rebind" / "Unbind" action.
- **Messaging-host extension.** `MessagingHost` grows a `telegramMirror(agentId, text)` capability; the daemon's NDJSON consumer in `runAgentTurn` calls it when a bound agent emits an assistant message or a tool-driven user-facing message.
- **Outbound queue.** Per-supergroup serialization (token-bucket) inside the messaging host. Telegram's broadcast rate limit (~20 msg/min per group) is shared across all topics in the supergroup, *not* per topic — so the queue is keyed on `chat_id`, not on `(chat_id, message_thread_id)`.

## Risks & open questions

1. **Public webhook is the awkward bit.** The default bazilion install is loopback-only. We need a smooth answer for "user wants Telegram but doesn't want to run a tunnel." Long-polling via `bazilion telegram poll` is the fallback but it ties up a foreground process. Open: does long-polling go into the daemon itself (auto-detect "no public URL set, start polling") or stay a separate command?
2. **Rate limit is per-supergroup, not per-topic.** 20 active heartbeat agents firing in the same minute share one ~20 msg/min broadcast quota. The outbound queue handles this, but heavy installs might want a per-agent throttle on the agent side too. Defer until we see it bite.
3. **No `forum_topic_deleted` webhook.** Stale `telegram_topic_id` rows are discovered lazily on send failure. Acceptable as long as the reconcile path is robust (clear the column, recreate, don't crash the turn).
4. **General-topic phantom thread IDs.** Some Telegram clients echo a `message_thread_id <= 1` on inbound messages from General. The routing layer must normalize `message_thread_id <= 1` to "no thread" before reflecting it on outbound, or replies escape to the wrong place. Easy to get wrong, will need a focused test.
5. **Forum-mode toggle is owner-only.** A bot with `can_manage_topics` can't turn the forum on/off; the human owner must do this during setup. The setup wizard must check `chat.is_forum` and refuse to proceed with a helpful error if it's false.
6. **Multi-user authorization is membership-only.** Adding someone to the Telegram supergroup grants them full agent access. We should at minimum show "supergroup members: N" in the health card so the user sees the blast radius.
7. **Bound topics across bazilion groups all live in one forum.** With many groups + many agents, topic count grows quickly (1M is the Telegram hard cap, but UX breaks down well before that). The "one supergroup per bazilion group" alternative was considered and rejected for setup-friction reasons. Revisit if installs hit >50 active topics.
8. **OAuth-style bot pairing.** Long-term, we may want a `bazilion://pair-telegram` deep link analogous to the existing mobile pairing flow, so adding Telegram is "scan QR" instead of "paste two strings." Out of scope for v1.

## Explicitly deferred

- Inline keyboards / Telegram WebApp UI for agent picking. The forum-topic UI *is* the agent picker.
- Per-message visibility controls (mirror this assistant turn, hide that one). v1 mirrors everything.
- Topic-icon customization beyond a fixed profile-derived default.
- Per-user authorization within a supergroup.
- A pairing/relay service for users behind double-NAT with no tunnel option.
- Forwarding files/photos/voice (we'll do text-only first).
- Multi-account support (a user with two bazilion installs talking to two different bots).

## Library pick: grammY

Decision rationale captured here so we don't re-litigate it.

- Actively maintained (monthly releases through May 2026); Telegraf has stalled (no npm release in ~14 months) and `node-telegram-bot-api` has no first-party TS or middleware.
- First-class Hono webhook adapter (`webhookCallback(bot, 'hono')`) — slots into the daemon's existing Hono stack with zero glue.
- `ctx.reply` auto-propagates `message_thread_id`, so we can't accidentally escape a topic.
- Session plugin's `getSessionKey` hook is the natural seam for thread-scoped state if we ever need it: `${ctx.chat.id}/${ctx.msg?.message_thread_id ?? 'main'}`.

## Next moves

- This PR establishes the user story. No code yet.
- Follow-ups, likely in order:
  1. Migration + secrets/config keys + setup form (no bot running yet).
  2. grammY bot singleton + webhook route + `/talk` command + auto-create flow.
  3. Outbound mirror from `runAgentTurn`.
  4. CLI + web UI for binding/health.
  5. Long-polling mode.
  6. Docs: setup recipe with Tailscale Funnel.
