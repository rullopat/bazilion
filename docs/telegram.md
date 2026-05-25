# Telegram integration — user story

Living design doc. Captures decisions made and the user story we've agreed on so far. Implementation has not started — this PR is the starting point for the work. Update this file as the story evolves.

## Problem

Bazilion agents today are reachable from the web UI, the CLI, and (over LAN) the mobile app. None of those are good for the "ping me from the bus" case. We want a phone-friendly external surface — Telegram first — that lets a single user talk to **any** of their agents and groups from one app.

A naive "one bot per agent" approach is unworkable (a BotFather token and chat per agent). A naive "one bot, one chat" approach loses the ability to switch context cleanly. The right primitive is Telegram's **forum supergroup**: one supergroup with topics enabled, one topic per conversation thread. The bot is admin in that supergroup, creates/closes topics on demand, and routes messages by `message_thread_id`.

## Decisions so far

1. **Topic granularity: one topic per agent.** Each bazilion agent is bound to exactly one forum topic; the topic is permanent for the agent's lifetime. Matches the proven "agent-persona-per-topic" pattern from existing open-source forum bots.
2. **Topic creation: auto-create on first traffic.** When an agent needs to send to Telegram (heartbeat fires, user replies via web, etc.) and isn't bound to a topic yet, the daemon calls `createForumTopic` lazily and persists the returned `message_thread_id`. Inbound human-initiated binding happens via a `/talk <agent>` slash command in the General topic.
3. **Pairing: one bot, one supergroup, global per install.** The user configures `{ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID }` once in `/config`; every agent in this bazilion install shares that supergroup. Cross-group agents land in the same forum, distinguished by topic name + icon.
4. **Ingress: long-polling, daemon-internal.** No public URL required; the daemon runs grammY's `bot.start()` driver as a long-lived task inside its own process. Webhook is a deferred v2 opt-in for users who already have a public URL. Matches OpenClaw's default — see `docs/openclaw-reference.md` and §"Lessons from OpenClaw" below.

## User story walkthrough

### Setup (one-time)

Telegram-side first, then bazilion-side. Order matters — each step unlocks the next.

**Telegram-side checklist:**

1. **Create the bot** via `@BotFather` → `/newbot` → save the bot token.
2. **Disable Privacy Mode** for the bot: `@BotFather` → `/mybots` → select bot → `Bot Settings` → `Group Privacy` → `Turn off`. **This is the silent-failure trap.** A bot in a group with Privacy Mode on only sees commands that mention it directly (e.g. `/talk@mybot`) — *not* plain chat in a topic. Topic-bound conversations will look broken with no obvious error. (Alternative: promote the bot to admin in the supergroup, which also bypasses Privacy Mode. We recommend turning Privacy Mode off explicitly because it works whether or not the bot is admin.)
3. **Create the supergroup** and enable **Topics** in group settings (this is the irreversible forum-mode toggle; it can only be done by the supergroup owner, not the bot).
4. **Add the bot to the supergroup** and promote it to admin with `can_manage_topics` (required for `createForumTopic`) and optionally `can_delete_messages` (only if you want bazilion-driven topic cleanup; without it, `closeForumTopic` still works to archive).
5. **Capture the supergroup chat ID.** The setup wizard exposes a probe — forward any message from the supergroup to the bot and the daemon extracts the chat ID and prefills the form.

**Bazilion-side:**

6. In the web UI: `Config → Integrations → Telegram` → paste bot token + paste/confirm supergroup chat ID.
7. Token goes to the encrypted `secrets` table as `TELEGRAM_BOT_TOKEN`. Chat ID goes to the plaintext `config` table as `TELEGRAM_CHAT_ID`.
8. Daemon spawns the bot singleton (`ctx.telegramBot`) and starts the long-polling loop. No webhook, no public URL, no tunnel.
9. Daemon runs preflight checks against the supergroup: `getChat` (confirms `is_forum: true`), `getMe` (confirms `can_read_all_group_messages: true` — i.e. Privacy Mode is off), `getChatMember(bot_id)` (confirms `can_manage_topics`). All three must pass; failures surface as red errors on the config page with the exact remediation step.

### Binding an agent to a topic

Two paths reach the same end-state — an `agents.telegram_topic_id` populated and a forum topic alive:

- **Daemon-initiated (auto).** Agent has unread outbound (heartbeat, scheduler trigger, assistant turn from the web chat). Daemon checks `telegram_topic_id`. If null, calls `createForumTopic({ name: agent.name, icon_color, icon_custom_emoji_id })` against the configured supergroup, persists the returned `message_thread_id`, then sends the message into the new topic.
- **Human-initiated (explicit).** Human is in the supergroup, posts `/talk <agent-name>` (or `/talk <agent-id>`) in the **General topic**. Bot resolves the name, creates the topic if not already bound, posts a deep-link to it in General, and the human taps in.

In both cases, the topic name is `agent.name`, the icon color is derived from the agent's profile (so all "researcher" agents are green, all "coder" agents are blue), and the icon emoji can be customized later via `bazilion agent set-topic-icon`.

### Steady-state traffic

**Inbound (Telegram → bazilion).** grammY's polling driver delivers each update to `route(update)`. Daemon routes by `(chat_id, message_thread_id)`:

- `is_topic_message && (chat_id, message_thread_id) → agentId`: enqueue as a user-message on that agent, kick off `runAgentTurn`, stream the assistant's reply back into the same topic via `sendMessage(chatId, text, { message_thread_id })`.
- General topic (no `message_thread_id`, or `<= 1`): only respond to slash commands (`/talk`, `/list`, `/help`, `/health`). Plain text in General is ignored — General is a control channel, not a chat surface.
- Unknown topic (orphan, mapping cleared): respond with a one-liner "this topic isn't bound to an agent" and offer `/adopt <agent-name>` to re-bind.

**Outbound (bazilion → Telegram).** Every assistant message and tool-emitted message that an agent produces gets mirrored to its bound topic, *if* a topic is bound. The mirror happens in the daemon's NDJSON stream consumer inside `runAgentTurn`, downstream of the existing messaging tools. Mirror policy is "everything by default, agent-level opt-out flag for later" — we are not building per-message visibility controls in v1.

**General-topic API asymmetry.** Telegram rejects `sendMessage` calls that include `message_thread_id: 1` (the General topic's implicit id). Outbound to General must *omit* `message_thread_id` entirely. Inbound from General sometimes carries a phantom `message_thread_id <= 1` on the `Message` object — normalize to "no thread" before reflecting it on outbound, or replies escape to the wrong place. The routing layer hides both quirks behind a single helper.

### Lifecycle

- **Agent deleted in bazilion.** Daemon calls `closeForumTopic` by default (preserves history, agent can be "restored" later). A `bazilion agent delete --purge-telegram` flag would call `deleteForumTopic` (destructive).
- **Topic deleted in Telegram by a human.** No webhook fires. Daemon discovers it lazily on the next outbound send when `sendMessage` returns `400 Bad Request: message thread not found`. Reconcile logic: clear `agents.telegram_topic_id`, log the orphan, recreate on next traffic (which will trigger the auto-create path again).
- **Bot loses `can_manage_topics`.** Existing topics keep working (sends still route), but `createForumTopic` calls 403. Daemon surfaces this via a health check on `/config/integrations/telegram` and a banner on agents that have no `telegram_topic_id` yet.
- **Token rotation.** Updating `TELEGRAM_BOT_TOKEN` in the config UI tears down the running bot instance and starts a fresh one. The daemon's bot singleton is replaceable: `ctx.telegramBot` is null until configured, gets created when credentials land, gets recycled on token change, gets stopped on shutdown or token removal.
- **Bot identity cache.** `getMe` result cached for 24h to avoid burning a call per restart; invalidated on token change. Matches the OpenClaw pattern.

### Multi-user in the supergroup

The supergroup membership *is* the auth boundary. If the user adds family/teammates to the supergroup, those people can talk to every agent. There is no per-user authorization layer. This will be loudly documented; finer-grained access control is deferred to a later iteration.

## What this lands in the codebase (sketch)

Not committing to these paths yet — this is a shape preview, not the implementation plan.

- **Migration.** `apps/daemon/src/core/db/migrations/0003_agent_telegram.sql` adds `agents.telegram_topic_id INTEGER NULL UNIQUE` (one topic ↔ one agent).
- **Config & secrets keys.**
  - `TELEGRAM_BOT_TOKEN` (secrets) — bot credential from BotFather.
  - `TELEGRAM_CHAT_ID` (config) — the supergroup numeric ID.
  - `TELEGRAM_LAST_UPDATE_ID` (config) — long-poll watermark, persisted between restarts; survives daemon kills and Telegram's 24h server-side queue.
  - All added to `apps/daemon/src/core/services.ts`.
- **Runtime module.** `apps/daemon/src/lib/telegram/{bot.ts,polling.ts,routing.ts,commands.ts}`. Singleton on `ctx.telegramBot`. Built on **grammY**, driven by `bot.start()`.
- **HTTP routes.**
  - `PUT|DELETE /api/config/telegram` — bearer-authed CRUD for credentials.
  - `GET /api/config/telegram/health` — admin-rights + privacy-mode + polling-liveness ping, returns `{ botUsername, chatTitle, isForum, hasManageTopics, hasDeleteMessages, privacyModeOff, polling: { running, lastUpdateId, lastSuccessfulPollAt } }`.
  - No webhook route in v1. (Reserved for v2: `POST /api/telegram/webhook`.)
- **CLI surfaces.** `bazilion telegram setup`, `bazilion telegram health`, `bazilion telegram bind <agent-id>` (manual fallback for the auto-create flow).
- **Web UI.**
  - `/config/integrations/telegram` — setup form + health card.
  - Per-agent: a small "Telegram: bound to topic #N" indicator on the agent card and detail page, with a "Rebind" / "Unbind" action.
- **Messaging-host extension.** `MessagingHost` grows a `telegramMirror(agentId, text)` capability; the daemon's NDJSON consumer in `runAgentTurn` calls it when a bound agent emits an assistant message or a tool-driven user-facing message.
- **Outbound queue.** Per-supergroup serialization (token-bucket) inside the messaging host. Telegram's broadcast rate limit (~20 msg/min per group) is shared across all topics in the supergroup, *not* per topic — so the queue is keyed on `chat_id`, not on `(chat_id, message_thread_id)`.

### Polling robustness (daemon-internal invariants)

The polling loop is small but has several robustness invariants we picked up from OpenClaw. Each one corresponds to a real failure mode they've already debugged.

1. **Watermark persistence.** Write `TELEGRAM_LAST_UPDATE_ID` to the `config` table *only after* an update has been fully dispatched (routing + agent turn enqueue completed without a thrown exception). On startup, read it and pass as `offset` to the first `getUpdates`. A daemon restart mid-turn does not lose the update — Telegram redelivers from the persisted offset.
2. **Stall detection.** A watchdog tracks the timestamp of the last completed `getUpdates`. If no completion in `BAZILION_TELEGRAM_POLLING_STALL_MS` (default 120s, range 30s–600s), tear down `ctx.telegramBot` and rebuild. Catches the half-broken-connection case that grammY's own retry doesn't surface.
3. **Webhook conflict recovery on startup.** If a webhook was previously set on the bot token (because the user once enabled it, or because something external did), polling fails with `409 Conflict: terminated by other getUpdates request`. On startup, the daemon issues `deleteWebhook({ drop_pending_updates: false })` once before `bot.start()`; if it still 409s, log loudly — that almost always means another bazilion is running with the same token.
4. **Bot-loop protection.** Sliding-window budget per `(sender_bot_id → recipient_bot_id)` pair. Default `20 events / 60 seconds / 60s cooldown` (configurable via `BAZILION_TELEGRAM_LOOP_BUDGET`). Without this, two heartbeat-triggered bazilion agents that reply to each other in the same topic can loop indefinitely. OpenClaw ships this for the same reason — every multi-agent Telegram integration eventually trips it.
5. **Graceful shutdown ordering.** `bot.stop()` runs *before* `db.close()` in the SIGTERM handler — the in-flight `getUpdates` needs to ack its offset back to SQLite before the handle goes away.
6. **Catch-up burst on resume.** Telegram retains updates server-side for 24h. A laptop asleep for 6h wakes to a batch of queued updates; we process them in order. Probably harmless in practice (humans don't send 50 messages, agents don't either), but worth knowing about when debugging "why did my agent reply to a thing I said yesterday."

## Risks & open questions

1. **Privacy Mode is the silent-failure trap.** If the user skips the BotFather privacy-mode step, the bot only sees slash commands. `/talk` will work, but plain chat in a topic looks broken with no obvious error. Mitigation: preflight `getMe` and refuse to mark setup complete unless `can_read_all_group_messages: true`. Surface the exact BotFather click-path in the error message.
2. **Rate limit is per-supergroup, not per-topic.** 20 active heartbeat agents firing in the same minute share one ~20 msg/min broadcast quota. The outbound queue handles this, but heavy installs might want a per-agent throttle on the agent side too. Defer until we see it bite.
3. **No `forum_topic_deleted` event.** Stale `telegram_topic_id` rows are discovered lazily on send failure. Acceptable as long as the reconcile path is robust (clear the column, recreate, don't crash the turn).
4. **General-topic phantom thread IDs.** Some Telegram clients echo a `message_thread_id <= 1` on inbound messages from General. The routing layer must normalize `message_thread_id <= 1` to "no thread" before reflecting it on outbound, or replies escape to the wrong place. Easy to get wrong, will need a focused test.
5. **Forum-mode toggle is owner-only.** A bot with `can_manage_topics` can't turn the forum on/off; the human owner must do this during setup. The preflight check must inspect `chat.is_forum` and refuse to proceed if it's false.
6. **Multi-user authorization is membership-only.** Adding someone to the Telegram supergroup grants them full agent access. We should at minimum show "supergroup members: N" in the health card so the user sees the blast radius.
7. **Bound topics across bazilion groups all live in one forum.** With many groups + many agents, topic count grows quickly (1M is the Telegram hard cap, but UX breaks down well before that). The "one supergroup per bazilion group" alternative was considered and rejected for setup-friction reasons. Revisit if installs hit >50 active topics.
8. **Group migration events.** Telegram occasionally fires `migrate_to_chat_id` when a basic group is upgraded to a supergroup — the chat ID changes underneath us. OpenClaw auto-rewrites their JSON5 config; we'll surface a "your chat ID changed, reconnect" banner in the web UI instead. Defer auto-update.
9. **OAuth-style bot pairing.** Long-term, we may want a `bazilion://pair-telegram` deep link analogous to the existing mobile pairing flow, so adding Telegram is "scan QR" instead of "paste two strings." Out of scope for v1.

## Explicitly deferred

- **Webhook ingress.** Polling-only in v1. v2 can layer webhook as an opt-in for users who have a public URL (Tailscale Funnel, Cloudflare Tunnel, native VPS). The grammY `webhookCallback(bot, 'hono')` adapter slots into our existing Hono stack with zero glue when we get there.
- **DM ingress.** v1 is supergroup-only. DMs would require OpenClaw-style pairing codes (`dmPolicy`, 8-char approval codes via CLI, 1h expiration) — substantial surface for a feature personal-laptop users won't need.
- **Multi-account.** One bot per install in v1. Multiple bot identities sharing one daemon is plausible later but adds significant config and routing complexity.
- **Per-topic config overrides.** OpenClaw lets you override `requireMention`, `allowFrom`, `systemPrompt`, etc. per topic. A future `agent_telegram_overrides` table could layer this on without changing the auto-bind model.
- **Streaming modes** (OpenClaw's `off/partial/block/progress`). v1 sends one Telegram message per assistant turn. "Partial" streaming via `editMessage` is a worthwhile UX upgrade later but the outbound design must leave room — don't lock into the single-message-per-turn assumption.
- **Cross-channel access groups.** Reusable sender allowlists shared across Telegram + future Slack/Discord channels. Premature; revisit when a second channel ships.
- **Inline keyboards / Telegram WebApp UI.** The forum-topic UI *is* the agent picker; no custom one needed.
- **Per-message visibility controls** (mirror this assistant turn, hide that one). v1 mirrors everything.
- **Topic-icon customization** beyond a fixed profile-derived default.
- **Per-user authorization within a supergroup.**
- **Forwarding files/photos/voice** — text-only first.

## Library pick: grammY

Decision rationale captured here so we don't re-litigate it.

- Actively maintained (monthly releases through May 2026); Telegraf has stalled (no npm release in ~14 months) and `node-telegram-bot-api` has no first-party TS or middleware.
- `bot.start()` is the production-ready long-polling driver — handles reconnect, backoff, graceful shutdown via `bot.stop()`.
- First-class Hono webhook adapter (`webhookCallback(bot, 'hono')`) for when we add webhook mode later.
- `ctx.reply` auto-propagates `message_thread_id`, so we can't accidentally escape a topic.
- Session plugin's `getSessionKey` hook is the natural seam for thread-scoped state if we ever need it: `${ctx.chat.id}/${ctx.msg?.message_thread_id ?? 'main'}`.
- **OpenClaw uses grammY too** — strong external corroboration. They've put it through years of production multi-channel use.

## Lessons from OpenClaw

OpenClaw (`docs/openclaw-reference.md`) ships a multi-channel gateway with Telegram as one of ~20 channels. Their Telegram integration is mature and the docs (`https://docs.openclaw.ai/channels/telegram`, `…/channels/channel-routing`, `…/channels/pairing`, `…/channels/bot-loop-protection`) are dense. We mined them for prior art.

**Borrowed:**

- **Long-polling as the default ingress.** Quoting their docs: *"Default: Long polling via grammY runner is the standard mode."* Webhook is opt-in via `webhookUrl`/`webhookSecret`. Validates our decision #4.
- **grammY as the library.** Same choice for the same reasons.
- **Polling stall detection.** ~120s threshold, configurable, restart bot instance on stall. Pattern adopted directly.
- **Webhook conflict recovery on startup.** Try `deleteWebhook`, fall through to polling, surface the conflict via `getUpdates` if needed.
- **`getMe` 24h identity cache.** Cheap optimization; invalidated on token change.
- **Bot-loop protection.** Sliding-window budget per bot-pair, default 20/60s/60s. We have the same multi-agent-loop exposure.
- **Privacy Mode warning in the setup flow.** They surface it; we will too — without it, the silent-failure mode is brutal.
- **General-topic API asymmetry handling.** Their docs: *"message sends omit `message_thread_id` to general topic (ID=1) since Telegram rejects it, though typing still includes the ID."* We mirror this in our routing helper.

**Deliberately not borrowed:**

- **Config-driven topic-to-agent bindings.** OpenClaw stores `groups.<chatId>.topics.<threadId> = { agentId: "main" }` in JSON5 config; the user pre-creates the topic in Telegram, then edits config to bind it. Bazilion agents are dynamic — spawned via CLI/web, deleted, profile-grouped, scheduler-triggered. Auto-create-on-first-traffic with `agents.telegram_topic_id` keeps the binding lifecycle-coupled to the agent and avoids per-agent config edits.
- **`bindings[]` with 8-level routing precedence** (peer / parent / guild+roles / guild / team / account / channel / default). Overkill for "one supergroup, one topic per agent" — our routing is a hashtable lookup.
- **DM pairing flow with 8-char codes.** Useful when DMs are exposed; our v1 is supergroup-only.
- **Multi-account on one channel.** Powerful but the config cost is steep.
- **Cross-channel access groups.** Reusable allowlists across Telegram + Slack + Discord. Premature.
- **Config writes from runtime events** (auto-update config on `migrate_to_chat_id`). We surface a "reconnect" banner instead — simpler, no DB mutations from external events.

## Next moves

- This PR establishes the user story. No code yet.
- Follow-ups, likely in order:
  1. Migration + secrets/config keys + setup form + preflight checks (no bot running yet).
  2. grammY bot singleton + polling loop + watermark persistence + stall watchdog + webhook-conflict recovery.
  3. `/talk` command + auto-create flow + topic routing helper (handles General-topic asymmetry).
  4. Outbound mirror from `runAgentTurn` + per-supergroup outbound queue + bot-loop protection.
  5. CLI + web UI for binding/health.
  6. Webhook mode as opt-in (v2).
