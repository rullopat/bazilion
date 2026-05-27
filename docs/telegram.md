# Telegram integration — user story

Living design doc. **The v1 user story is complete as of 2026-05-25** — six decisions, end-to-end walkthrough, command vocabulary, codebase sketch, polling-robustness invariants, risk register, OpenClaw prior art, and an ordered list of implementation PRs. Code starts next. Update this file as implementation surfaces new design questions.

## Problem

Bazilion agents today are reachable from the web UI, the CLI, and (over LAN) the mobile app. None of those are good for the "ping me from the bus" case. We want a phone-friendly external surface — Telegram first — that lets a single user talk to **any** of their agents and groups from one app.

A naive "one bot per agent" approach is unworkable (a BotFather token and chat per agent). A naive "one bot, one chat" approach loses the ability to switch context cleanly. The right primitive is Telegram's **forum supergroup**: one supergroup with topics enabled, one topic per conversation thread. The bot is admin in that supergroup, creates/closes topics on demand, and routes messages by `message_thread_id`.

## Decisions so far

1. **Topic granularity: one topic per agent.** Each bazilion agent is bound to exactly one forum topic; the topic is permanent for the agent's lifetime. Matches the proven "agent-persona-per-topic" pattern from existing open-source forum bots.
2. **Topic creation: auto-create on first traffic.** When an agent needs to send to Telegram (heartbeat fires, user replies via web, etc.) and isn't bound to a topic yet, the daemon calls `createForumTopic` lazily and persists the returned `message_thread_id`. Inbound human-initiated binding happens via a `/talk <agent>` slash command in the bazilion service chat (see decision #6).
3. **Pairing: one bot, one supergroup, global per install.** The user configures `{ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID }` once in `/config`; every agent in this bazilion install shares that supergroup. Cross-group agents land in the same forum, distinguished by topic name + icon.
4. **Ingress: long-polling, daemon-internal.** No public URL required; the daemon runs grammY's `bot.start()` driver as a long-lived task inside its own process. Webhook is a deferred v2 opt-in for users who already have a public URL. Matches OpenClaw's default — see `docs/openclaw-reference.md` and §"Lessons from OpenClaw" below.
5. **Topic-name and icon convention.** Topic name = `{agent.name}` for the `default` group, `{group.slug} › {agent.name}` for non-default groups (arrow separator; slug source in v1, per-group template-configurable later). Icon color is auto-allocated per bazilion group from Telegram's 6-color enum at first-traffic — wraps round-robin past 5 groups (red is reserved for the service chat — see #6 — leaving 5 colors for groups; color is a visual hint, name prefix is authoritative). Icon emoji is profile-derived (curated default per built-in profile, editable per agent). A human-renamed topic stays renamed — bazilion stops propagating renames once `forum_topic_edited` is observed from a non-bot sender.
6. **Service chat as control plane.** A dedicated pinned topic named `⚙ bazilion` is created at install setup. It owns all control-plane commands (`/talk`, `/spawn`, `/list`, `/groups`, `/help`, `/health`, `/whoami`) and hosts a bot-maintained pinned directory message linking every bound agent's topic. Plain text in the service chat is ignored. Telegram's General topic is hidden via `hideGeneralForumTopic` at setup (reversible). The service chat takes a reserved red icon color from the 6-enum, so it never collides with a group's allocated color.

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
10. Daemon creates the service chat: `createForumTopic({ name: '⚙ bazilion', icon_color: 16478047 /* red */, icon_custom_emoji_id: <gear-emoji-id> })`. Persists the returned `message_thread_id` as `TELEGRAM_SERVICE_TOPIC_ID` in config.
11. Daemon posts a welcome + cheat-sheet message inside the service chat and pins it. Persists the `message_id` as `TELEGRAM_DIRECTORY_MESSAGE_ID` in config. The bot keeps this message live by `editMessageText` as agents come and go.
12. Daemon calls `hideGeneralForumTopic` to remove General from the topic list. Reversible via `unhideGeneralForumTopic` if the user wants it back.
13. Daemon registers the slash-command menu via `setMyCommands` — service-chat commands only. Topic-context commands (`/close`, `/rebind`, `/unbind`) work when typed but stay out of autocomplete.

### Binding an agent to a topic

Two paths reach the same end-state — an `agents.telegram_topic_id` populated and a forum topic alive:

- **Daemon-initiated (auto).** Agent has unread outbound (heartbeat, scheduler trigger, assistant turn from the web chat). Daemon checks `telegram_topic_id`. If null, calls `createForumTopic({ name: agent.name, icon_color, icon_custom_emoji_id })` against the configured supergroup, persists the returned `message_thread_id`, then sends the message into the new topic.
- **Human-initiated (explicit).** Human is in the supergroup, posts `/talk <agent-name>` in the **`⚙ bazilion` service chat**. Bot resolves the name (qualified as `group/agent` if ambiguous — see Command vocabulary below), creates the topic if not already bound, posts a deep-link to it in the service chat, and the human taps in.

In both cases, the topic is created with `name = topicNameFor(agent, group)` (see decision #5 — bare `agent.name` for the `default` group, `{group.slug} › {agent.name}` otherwise), `icon_color` pulled from the bazilion group's slot in `groups.telegram_icon_color` (round-robin-allocated on first agent in the group, over 5 non-red colors, wraps at 5), and `icon_custom_emoji_id` derived from `profiles.telegram_icon_emoji` (curated default per built-in profile; editable per agent later via `bazilion agent set-topic-icon`).

### Steady-state traffic

**Inbound (Telegram → bazilion).** grammY's polling driver delivers each update to `route(update)`. Daemon routes by `(chat_id, message_thread_id)`:

- **Service chat** (`message_thread_id == TELEGRAM_SERVICE_TOPIC_ID`): parse slash command, dispatch to command handler. Plain text in the service chat is acknowledged with a "run `/help` for commands" and ignored otherwise.
- **Bound agent topic** (`is_topic_message && (chat_id, message_thread_id) → agentId`): if the message starts with a topic-context command (`/close`, `/rebind`, `/unbind`, `/help`), dispatch to the command handler with the bound agent as implicit context. Otherwise enqueue as a user-message on that agent, kick off `runAgentTurn`, stream the assistant's reply back into the same topic via `sendMessage(chatId, text, { message_thread_id })`.
- **General topic** (no `message_thread_id`, or `<= 1`): General is hidden by default but reachable if the user unhides it. Respond once with a polite redirect: "Run commands in the `⚙ bazilion` topic." Suppress further redirects from the same chat for 60s to avoid spam.
- **Unknown topic** (`(chat_id, message_thread_id)` not in our map): orphan. Respond with "this topic isn't bound to an agent" and offer `/adopt <agent-name>` to re-bind.

**Outbound (bazilion → Telegram).** Every assistant message and tool-emitted message that an agent produces gets mirrored to its bound topic, *if* a topic is bound. The mirror happens in the daemon's NDJSON stream consumer inside `runAgentTurn`, downstream of the existing messaging tools. Mirror policy is "everything by default, agent-level opt-out flag for later" — we are not building per-message visibility controls in v1. **This includes scheduler-triggered heartbeats and cron triggers** — every agent turn mirrors to Telegram regardless of who initiated it. There is no per-trigger silence toggle in v1; if heartbeats feel noisy, the answer is to tune the heartbeat interval, not to suppress its Telegram output. Telegram becomes "the place where I see what my agents are doing."

**General-topic API asymmetry.** Telegram rejects `sendMessage` calls that include `message_thread_id: 1` (the General topic's implicit id). Outbound to General must *omit* `message_thread_id` entirely. Inbound from General sometimes carries a phantom `message_thread_id <= 1` on the `Message` object — normalize to "no thread" before reflecting it on outbound, or replies escape to the wrong place. The routing layer hides both quirks behind a single helper. Mostly moot once General is hidden, but the helper still has to exist for the rare case the user unhides it.

### Command vocabulary

Commands run in two contexts. The bazilion service chat is the control plane; bound agent topics are the context plane. Only service-chat commands appear in Telegram's `/` autocomplete (registered via `setMyCommands`); topic-context commands work when typed but stay hidden.

**Service-chat commands (control plane, in `setMyCommands`):**

| Command | Effect |
|---|---|
| `/talk <agent>` | Bind a topic to the named agent (auto-create if needed); reply with deep-link |
| `/spawn` | Open inline-keyboard profile picker → name prompt → auto-create new agent + deep-link |
| `/list` (alias `/agents`) | List all agents grouped by bazilion group, with deep-links and bound/unbound indicator |
| `/groups` | List bazilion groups with agent counts |
| `/help [<command>]` | Command reference |
| `/health` | Bot identity, supergroup state, polling liveness |
| `/whoami` | Your Telegram user ID (for future per-user ACL configuration) |

**Agent-topic commands (context plane, hidden from menu):**

| Command | Effect |
|---|---|
| `/close` | `closeForumTopic` on this topic (preserves history, agent stays, can reopen) |
| `/rebind <agent>` | Point this topic at a different agent |
| `/unbind` | Clear `agents.telegram_topic_id` for the bound agent; topic becomes an orphan |
| `/help` | Same help, contextualized to the bound agent |

**Disambiguation.** When two agents share a name across bazilion groups, qualify with `group/agent`:

```
/talk researcher                # unambiguous
/talk home-reno/researcher      # qualified
/talk "Patrizio's Coder"        # names with spaces
```

Argument parsing is greedy-after-command: everything after `/talk ` is the agent reference. Bare names that are ambiguous get rejected with a list: `Multiple agents named 'researcher'. Try /talk home-reno/researcher or /talk work/researcher.`

**The `/spawn` keyboard flow.** `/spawn` with no args:

1. Bot replies in the service chat with an inline keyboard of available profiles (built-in + custom).
2. User taps a profile button → `callback_query` arrives with the profile id.
3. Bot edits the original message: "Name for this agent? (reply with `-` to auto-name)".
4. User replies (the next message in the service chat from the same user; tracked via a short-lived state on `(chat_id, user_id)`).
5. Bot creates the agent in the `default` bazilion group (v1 keeps it simple; multi-group spawn is a typed-args feature), auto-binds the topic via the normal `createForumTopic` path, and replies with the deep-link.

For power users, `/spawn <profile> [<name>]` works typed and skips the keyboard entirely.

**The pinned directory message.** A bot-managed message at the top of the service chat:

```
🛟 Available agents

📚 home-reno › researcher   → open
💻 home-reno › coder        → open
📝 work › notes-archivist   → open

Tap an agent name to jump to their topic. Run /help for commands.
```

Each "open" link is a Telegram deep-link (`https://t.me/c/<chat_id>/<topic_id>`). The bot maintains the message via `editMessageText` whenever an agent is created, renamed, deleted, or rebound. If the message is deleted by a human, the daemon recreates and re-pins it on next agent CRUD event.

### Lifecycle

- **Agent deleted in bazilion.** Daemon calls `closeForumTopic` by default (preserves history, agent can be "restored" later). A `bazilion agent delete --purge-telegram` flag would call `deleteForumTopic` (destructive).
- **Topic deleted in Telegram by a human.** No event fires. Daemon discovers it lazily on the next outbound send when `sendMessage` returns `400 Bad Request: message thread not found`. Reconcile logic: clear `agents.telegram_topic_id`, log the orphan, recreate on next traffic (which will trigger the auto-create path again).
- **Bot loses `can_manage_topics`.** Existing topics keep working (sends still route), but `createForumTopic` calls 403. Daemon surfaces this via a health check on `/config/integrations/telegram` and a banner on agents that have no `telegram_topic_id` yet.
- **Service chat or directory message deleted by a human.** Service chat: discovered lazily on next inbound (the bot tries to send a reply, gets thread-not-found; or routing fails to match the configured `TELEGRAM_SERVICE_TOPIC_ID`). Directory message: discovered on next agent CRUD when the bot tries to `editMessageText`. Either way, recreate and re-pin; surface a one-line note in `/help` so users don't think they've broken anything.
- **Topic renamed in Telegram by a human.** Bazilion stops auto-renaming that topic. Detected via `forum_topic_edited` service messages whose sender isn't the bot; daemon sets `agents.telegram_topic_name_locked = 1`. Subsequent agent-name or group-slug changes are no-ops for that topic. Telegram users universally expect "I renamed it, it stays renamed."
- **Agent or group renamed in bazilion.** For every bound topic not flagged `telegram_topic_name_locked`, call `editForumTopic({ name: topicNameFor(agent, group) })` to keep the topic name in sync. Cheap; runs as a background propagation. Also triggers a directory-message refresh.
- **Token rotation.** Updating `TELEGRAM_BOT_TOKEN` in the config UI tears down the running bot instance and starts a fresh one. The daemon's bot singleton is replaceable: `ctx.telegramBot` is null until configured, gets created when credentials land, gets recycled on token change, gets stopped on shutdown or token removal.
- **Bot identity cache.** `getMe` result cached for 24h to avoid burning a call per restart; invalidated on token change. Matches the OpenClaw pattern.

### Multi-user in the supergroup

The supergroup membership *is* the auth boundary. If the user adds family/teammates to the supergroup, those people can talk to every agent and run every command. There is no per-user authorization layer. `/whoami` is the seed for a future ACL system (it returns the inviter's Telegram user_id, which we can persist into a future `command_allow_from` list). v1 is "loudly documented, supergroup-membership is auth."

## What this lands in the codebase (sketch)

Not committing to these paths yet — this is a shape preview, not the implementation plan.

- **Migration.** `apps/daemon/src/core/db/migrations/0003_agent_telegram.sql` adds:
  - `agents.telegram_topic_id INTEGER NULL UNIQUE` (one topic ↔ one agent).
  - `agents.telegram_topic_name_locked INTEGER NOT NULL DEFAULT 0` (sticky bit set when a human renames the topic).
  - `groups.telegram_icon_color INTEGER NULL` (the 5-enum color allocated to this bazilion group, picked once at first-traffic; red is reserved for the service chat).
  - `profiles.telegram_icon_emoji TEXT NULL` (sticker ID from `getForumTopicIconStickers`; curated default per built-in profile, nullable for custom profiles).
  - `agents.telegram_icon_emoji TEXT NULL` (per-agent override of the profile-derived emoji; falls back to `profiles.telegram_icon_emoji` if null, then to color-only if both are null). Survives topic deletion + recreation, unlike a customization that only lives in Telegram.
- **Topic-naming helpers.** `apps/daemon/src/lib/telegram/naming.ts` exports `topicNameFor(agent, group): string` (default-group bypass + `{slug} › {name}` template) and `allocateGroupColor(db, groupId): number` (round-robin over the 5 non-red colors keyed by `groups.telegram_icon_color`, wraps past 5).
- **Profile emoji mapping.** `apps/daemon/src/lib/telegram/profile-emojis.ts` exports `BUILTIN_PROFILE_EMOJI: Record<string, string>` — a curated map from built-in profile name to a sticker ID from `getForumTopicIconStickers` (shape: `researcher → 📚`, `coder → 💻`, `notes-archivist → 📝`, `analyst → 📊`, etc., chosen from the ~70-emoji set Telegram returns). Seeded into `profiles.telegram_icon_emoji` for built-in profiles at install time. Custom profiles default to null (color-only icon). The lookup order at topic-creation time is `agents.telegram_icon_emoji` → `profiles.telegram_icon_emoji` → null. The actual mapping is a one-time choice that lives in the seed data; the doc only locks in the *shape* of the table, not the specific emojis.
- **Config & secrets keys.**
  - `TELEGRAM_BOT_TOKEN` (secrets) — bot credential from BotFather.
  - `TELEGRAM_CHAT_ID` (config) — the supergroup numeric ID.
  - `TELEGRAM_LAST_UPDATE_ID` (config) — long-poll watermark, persisted between restarts; survives daemon kills and Telegram's 24h server-side queue.
  - `TELEGRAM_SERVICE_TOPIC_ID` (config) — `message_thread_id` of the `⚙ bazilion` service chat, created at install setup.
  - `TELEGRAM_DIRECTORY_MESSAGE_ID` (config) — id of the pinned directory message inside the service chat; edited in place on agent CRUD.
  - All added to `apps/daemon/src/core/services.ts`.
- **Runtime module.** `apps/daemon/src/lib/telegram/{bot.ts,polling.ts,routing.ts,service-chat.ts,naming.ts,commands/index.ts,commands/talk.ts,commands/spawn.ts,commands/list.ts,...}`. Singleton on `ctx.telegramBot`. Built on **grammY**, driven by `bot.start()`. The `commands/` directory hosts one file per command. `service-chat.ts` manages the directory-message lifecycle (create, edit-on-CRUD, recreate-on-delete).
- **HTTP routes.**
  - `PUT|DELETE /api/config/telegram` — bearer-authed CRUD for credentials.
  - `GET /api/config/telegram/health` — admin-rights + privacy-mode + polling-liveness ping, returns `{ botUsername, chatTitle, isForum, hasManageTopics, hasDeleteMessages, privacyModeOff, serviceTopicId, directoryMessageId, polling: { running, lastUpdateId, lastSuccessfulPollAt } }`.
  - No webhook route in v1. (Reserved for v2: `POST /api/telegram/webhook`.)
- **CLI surfaces.** `bazilion telegram setup`, `bazilion telegram health`, `bazilion telegram bind <agent-id>` (manual fallback for the auto-create flow).
- **Web UI.**
  - `/config/integrations/telegram` — setup form + health card.
  - Per-agent: a small "Telegram: bound to topic #N" indicator on the agent card and detail page, with a "Rebind" / "Unbind" action.
- **Messaging-host extension.** `MessagingHost` grows a `telegramMirror(agentId, text)` capability; the daemon's NDJSON consumer in `runAgentTurn` calls it when a bound agent emits an assistant message or a tool-driven user-facing message.
- **Outbound queue.** Per-supergroup serialization (token-bucket) inside the messaging host. Telegram's broadcast rate limit (~20 msg/min per group) is shared across all topics in the supergroup, *not* per topic — so the queue is keyed on `chat_id`, not on `(chat_id, message_thread_id)`. **`createForumTopic` calls go through the same queue.** The thundering-herd case (20 agents heartbeating simultaneously on a fresh install, all needing first-traffic topic creation) is bounded by the same per-supergroup quota — no separate topic-creation throttle needed.

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
3. **No `forum_topic_deleted` event.** Stale `telegram_topic_id` rows are discovered lazily on send failure. Acceptable as long as the reconcile path is robust (clear the column, recreate, don't crash the turn). Service chat falls under the same model.
4. **General-topic phantom thread IDs.** Some Telegram clients echo a `message_thread_id <= 1` on inbound messages from General. The routing layer must normalize `message_thread_id <= 1` to "no thread" before reflecting it on outbound, or replies escape to the wrong place. Mostly moot now that General is hidden by default, but the helper still has to exist.
5. **Forum-mode toggle is owner-only.** A bot with `can_manage_topics` can't turn the forum on/off; the human owner must do this during setup. The preflight check must inspect `chat.is_forum` and refuse to proceed if it's false.
6. **Multi-user authorization is membership-only.** Adding someone to the Telegram supergroup grants them full agent access *and* the ability to run every slash command. We should at minimum show "supergroup members: N" in the health card so the user sees the blast radius.
7. **Bound topics across bazilion groups all live in one forum.** With many groups + many agents, topic count grows quickly (1M is the Telegram hard cap, but UX breaks down well before that). The "one supergroup per bazilion group" alternative was considered and rejected for setup-friction reasons. Revisit if installs hit >50 active topics.
8. **Group migration events.** Telegram occasionally fires `migrate_to_chat_id` when a basic group is upgraded to a supergroup — the chat ID changes underneath us. OpenClaw auto-rewrites their JSON5 config; we'll surface a "your chat ID changed, reconnect" banner in the web UI instead. Defer auto-update.
9. **OAuth-style bot pairing.** Long-term, we may want a `bazilion://pair-telegram` deep link analogous to the existing mobile pairing flow, so adding Telegram is "scan QR" instead of "paste two strings." Out of scope for v1.
10. **5-color wrap-around at >5 bazilion groups.** The service chat reserves red from the 6-color enum, leaving 5 colors for group allocation. With 6+ groups, distinct groups share an icon color. Acceptable because the name prefix is authoritative; users will tolerate "loose visual hint" semantics. If this bites at scale, the fallback is "groups 6+ get an uncolored topic icon" — implementable later without a migration.
11. **Service chat deletion is recoverable but disruptive.** If a human deletes the `⚙ bazilion` topic, the daemon recreates it lazily, but the new topic has a new `message_thread_id` — deep-links from past messages stop working. Surface a one-line note in `/help`: "Don't delete the bazilion topic, but if you do, it'll come back."
12. **`/spawn` keyboard state is per-`(chat_id, user_id)`.** Holding "waiting for name input" state in memory between callback_query and the next message is straightforward but races on multi-user supergroups: two people running `/spawn` at the same time need isolated state. In-memory `Map<chat_id+user_id, SpawnState>` with a 60s TTL handles this; persist nothing.

## Explicitly deferred

- **Webhook ingress.** Polling-only in v1. v2 can layer webhook as an opt-in for users who have a public URL (Tailscale Funnel, Cloudflare Tunnel, native VPS). The grammY `webhookCallback(bot, 'hono')` adapter slots into our existing Hono stack with zero glue when we get there.
- **DM ingress.** v1 is supergroup-only. DMs would require OpenClaw-style pairing codes (`dmPolicy`, 8-char approval codes via CLI, 1h expiration) — substantial surface for a feature personal-laptop users won't need.
- **Multi-account.** One bot per install in v1. Multiple bot identities sharing one daemon is plausible later but adds significant config and routing complexity.
- **Per-topic config overrides.** OpenClaw lets you override `requireMention`, `allowFrom`, `systemPrompt`, etc. per topic. A future `agent_telegram_overrides` table could layer this on without changing the auto-bind model.
- **Per-group topic-name format template.** A `groups.telegram_topic_name_format` column (e.g. `"{group.name} › {agent.name}"`) so installs that prefer display names or different layouts can opt in. v1 hardcodes the slug-arrow format.
- **`/spawn-team <profile-group>`** — spawning a whole profile group from Telegram. Single-agent `/spawn` ships in v1; team spawning extends the keyboard primitive naturally and lands in v2.
- **`/spawn` cross-group targeting.** `/spawn <profile> in <group>` typed form. v1 spawns in `default` group only (or the current topic's group when invoked typed-style — the keyboard flow is `default`-only).
- **Per-user ACLs.** `command_allow_from` allowlists keyed on Telegram user_id, populated via `/whoami`. v1 trusts supergroup membership as auth.
- **Streaming modes** (OpenClaw's `off/partial/block/progress`). v1 sends one Telegram message per assistant turn. "Partial" streaming via `editMessage` is a worthwhile UX upgrade later but the outbound design must leave room — don't lock into the single-message-per-turn assumption.
- **Cross-channel access groups.** Reusable sender allowlists shared across Telegram + future Slack/Discord channels. Premature; revisit when a second channel ships.
- **Telegram WebApp UI.** Rich custom UI hosted inside Telegram. The forum-topic UI + inline keyboards already cover v1; WebApp would be for a future richer config/dashboard experience inside Telegram.
- **Per-message visibility controls** (mirror this assistant turn, hide that one). v1 mirrors everything.
- **Topic-icon customization** beyond a fixed profile-derived default.
- **Forwarding files/photos/voice** — text-only first.

## Library pick: grammY

Decision rationale captured here so we don't re-litigate it.

- Actively maintained (monthly releases through May 2026); Telegraf has stalled (no npm release in ~14 months) and `node-telegram-bot-api` has no first-party TS or middleware.
- `bot.start()` is the production-ready long-polling driver — handles reconnect, backoff, graceful shutdown via `bot.stop()`.
- First-class Hono webhook adapter (`webhookCallback(bot, 'hono')`) for when we add webhook mode later.
- `ctx.reply` auto-propagates `message_thread_id`, so we can't accidentally escape a topic.
- Inline-keyboard primitives (`InlineKeyboard` builder, `callback_query` handling) are first-class — natural fit for the `/spawn` keyboard flow.
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
- **General as the control plane.** OpenClaw routes commands through whichever topic the user types in; we own a dedicated `⚙ bazilion` service chat instead. Cleaner UX, hides Telegram's General quirks behind a single special-case, gives us a natural home for the pinned directory message and the `/spawn` keyboard flow.
- **`bindings[]` with 8-level routing precedence** (peer / parent / guild+roles / guild / team / account / channel / default). Overkill for "one supergroup, one topic per agent" — our routing is a hashtable lookup.
- **DM pairing flow with 8-char codes.** Useful when DMs are exposed; our v1 is supergroup-only.
- **Multi-account on one channel.** Powerful but the config cost is steep.
- **Cross-channel access groups.** Reusable allowlists across Telegram + Slack + Discord. Premature.
- **Config writes from runtime events** (auto-update config on `migrate_to_chat_id`). We surface a "reconnect" banner instead — simpler, no DB mutations from external events.

## Step 3 design decisions (locked in during implementation)

- **Agent-topic inbound is log-and-drop.** When a user sends a message into a bound agent topic in Step 3, the router identifies which agent owns the thread but does NOT reply. The actual "kick off `runAgentTurn` → mirror the assistant reply back" wiring lands in Step 6 alongside the outbound mirror + per-supergroup outbound queue. Step 3 to Step 6 transition is clean — no in-flight messages are replayed.
- **Profile-specific topic emojis are deferred.** Step 3 topics created by `/talk` use color-only icons (round-robin over the 5 non-red colors). The schema column `profiles.telegram_icon_emoji` exists from migration 0003; seeding curated defaults for the built-in profiles lands in a later step. Doc-listed shape (researcher→📚, coder→💻, …) is still the target, just not Step-3 scope.
- **`/talk <name>` is resolve-only — does not create new agents.** Mirrors the doc's `/talk` vs `/spawn` split: `/talk` finds and binds, `/spawn` creates. Unknown names get a "No agent matches X. Try /list, or /spawn (next release)." reply.
- **`/help` lists only Step 3 commands + a "coming next" section.** Avoids the menu lying about what's actually wired. When Step 4's `/spawn` ships, it moves into the "Available now" block.
- **`setMyCommands` runs at activation (every restart), not just on first activation.** This way the slash menu picks up any changes to `SERVICE_COMMANDS` when the operator restarts after a release bump — no separate migration needed.
- **General-topic redirect is 60-second-per-chat in-memory suppression.** Avoids the bot spamming "go to the ⚙ bazilion topic" replies if the operator types repeatedly in General. The Map clears on daemon restart, which is fine — restarts are rare and a single redirect reminder isn't harmful even if duplicated.
- **Command parsing strips the `@botname` suffix.** `/talk@bazilion_pat_bot researcher` becomes `{name: 'talk', args: 'researcher'}` — necessary because Telegram appends the suffix when the same command is available to multiple bots in the same chat.

## Step 2 design decisions (locked in during implementation)

Not in the original user story; surfaced when implementation made these choices unavoidable. Captured here so they're not just chat-history facts.

- **Re-save policy is "clear derived state only if creds changed".** A PUT with identical token+chatId is a no-op for `TELEGRAM_LAST_UPDATE_ID` / `TELEGRAM_SERVICE_TOPIC_ID` / `TELEGRAM_DIRECTORY_MESSAGE_ID` — repeated idempotent saves preserve the activated service chat. A real credential change wipes all three (the new bot has no relation to the old service chat).
- **Bot boots in the background, post-bind.** The Hono server binds the port first and prints "listening"; the bot starts asynchronously after that. Boot errors are logged loud but don't crash the daemon — the user can still reach `/config/integrations/telegram` to fix bad credentials even when the bot is misbehaving.
- **Inbound updates in Step 2 are log-and-advance.** The polling loop pulls updates, logs `chat=… thread=… "text"`, advances `TELEGRAM_LAST_UPDATE_ID`, and otherwise drops them. Step 3 replaces the dispatcher with the real routing layer; updates received between Step 2 and Step 3 are intentionally not replayed (the watermark moves forward regardless).
- **Service-chat icon picks a gear sticker from `getForumTopicIconStickers`.** Preference order at activation: `⚙` → `🛠` → `⚒` → `🔧` → `🧰`. If none of those are in Telegram's ~70-sticker set or the API call fails, the topic falls back to red-only.
- **`setMyCommands` is NOT called in Step 2.** Registering a slash menu of commands that don't respond yet is worse UX than no menu at all. Step 3 wires it (and runs it on every activation so command-list changes survive release bumps).
- **Polling loop is hand-rolled, not `bot.start()`.** We call `bot.api.getUpdates` directly so we own the offset arithmetic + can persist `TELEGRAM_LAST_UPDATE_ID` after every fully-dispatched update. grammY's `bot.start()` would manage offset internally but doesn't expose a clean persistence hook. Trade-off: shutdown can wait up to ~25s (long-poll timeout) before the loop exits; acceptable for v1.
- **Stall watchdog auto-restarts the bot.** A `setInterval` ticking at `BAZILION_TELEGRAM_POLLING_STALL_MS / 2` (default 60s) compares `now − lastSuccessfulPollAt` against the threshold (default 120s). On stall, it triggers `restartTelegramBot` via the mutex queue — same path as a manual restart.

## Next moves

- Step 1 shipped in PR #11 (merged): schema, setup form, preflight endpoint. The bot was not yet running.
- Step 2 shipped in PR #12 (merged): grammY singleton, polling loop, first-activation, stall watchdog, webhook-conflict recovery, live polling state on the health endpoint.
- Step 3 is in flight: routing helper + 6 service-chat commands + topic auto-create primitive + `setMyCommands` at activation.
- Follow-ups, in order:
  1. ✅ **Schema + setup UI + health endpoint, no live bot.** (PR #11)
  2. ✅ **Bot singleton + polling loop + first activation.** grammY bot on a module-scoped handle + watermark persistence + stall watchdog + webhook-conflict recovery. (PR #12)
  3. **Routing helper + service-chat commands.** `(chat_id, message_thread_id)` classifier dispatching to service-chat command handler / agent-topic identifier / General redirect / unknown-topic reply. Six commands: `/talk`, `/list` (+ `/agents` alias), `/groups`, `/help`, `/health`, `/whoami`. `setMyCommands` runs at activation. Topic auto-create primitive used by `/talk` (and future `/spawn`).
  4. `/spawn` keyboard flow (profile picker → name prompt → auto-create + deep-link) + shared auto-create primitive used by `/talk` too.
  5. Topic-context commands (`/close`, `/rebind`, `/unbind`) + directory-message lifecycle (create / edit-on-CRUD / recreate-on-delete).
  6. Outbound mirror from `runAgentTurn` + per-supergroup outbound queue + bot-loop protection.
  7. CLI + web UI for binding/health.
  8. Webhook mode as opt-in (v2).
