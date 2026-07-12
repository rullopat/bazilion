# Telegram integration v2 — user story

Living design doc, written 2026-05-28. This is the **v2 roadmap**: it takes every
item deferred during the v1 build (PRs #11–#17, see `docs/telegram.md`) and folds
them into one sequenced plan, tackled phase by phase, one PR per phase — the same
shape that drove v1.

**Phases are ordered smallest → largest** (effort, not value): knock out the quick,
self-contained wins first to build momentum, leave the heavy infra reshapes for last.
The one deviation from pure size order: **Per-user ACLs (Phase 7) is pulled slightly
ahead of Per-topic overrides (Phase 8)** even though it's marginally bigger, because
overrides depends on the ACL allowlist primitive — a hard dependency wins over size.

**Baseline (what v1 shipped).** Telegram is a working surface: long-polling bot in
a configured forum supergroup, a `⚙ bazilion` service chat with 7 slash commands,
one forum topic per agent (auto-created), outbound mirror of every assistant turn
(typing indicator + 👀 reactions + minimal/verbose modes), inbound chat from bound
topics (queued + concatenated mid-turn), topic-context commands (`/close`,
`/rebind`, `/unbind`), a self-healing pinned directory message, and CLI + web
surfaces for binding/health/mirror-mode. Read `docs/telegram.md` for the v1 design
record — this doc does not re-derive v1 decisions.

**Two corrections to the v1 record, verified 2026-05-28:**
- **Bot-loop protection never shipped.** It's listed in `docs/telegram.md` as a
  "borrowed from OpenClaw" lesson and as polling-robustness invariant #4, but there
  is no implementation in `apps/daemon/src/lib/telegram/`. It re-enters the backlog
  here as Phase 2 (small, and a safety item, so it goes near the front).
- **Profile-derived topic emojis never shipped.** Migration 0003 created
  `profiles.telegram_icon_emoji` and `agents.telegram_icon_emoji`, but nothing
  seeds or reads them — topics get color-only icons. The only `icon_custom_emoji_id`
  use is the service chat's gear sticker. Phase 3 finishes this.

## The deferred backlog (nothing dropped)

Grouped by theme so it's clear the roadmap covers everything. The "Phase" column
maps each item to where it lands below (numbered by the size order).

**Safety / correctness**
| Item | Source | Phase |
|---|---|---|
| Bot-loop protection (sliding-window budget per bot-pair) | v1 invariant #4, never shipped | 2 |
| Per-agent outbound throttle (rate limit is per-supergroup today) | risk #2 | 2 |
| Team-migration resilience (`migrate_to_chat_id`) | risk #8 | 5 |

**Security / access control**
| Item | Source | Phase |
|---|---|---|
| Per-user ACLs (`command_allow_from`, keyed on Telegram user_id) | deferred | 7 |
| Per-topic config overrides (`requireMention`, `allowFrom`, `silent`) | deferred | 8 |
| Cross-channel access teams | deferred | *beyond v2* |

**Noise / visibility controls**
| Item | Source | Phase |
|---|---|---|
| Per-trigger silence toggle (heartbeats always mirror today) | step-2 decision | 4 |
| Per-message visibility controls (hide a turn) | deferred | 4 |
| Streaming modes (partial via `editMessage`) | deferred | 9 |

**UX polish**
| Item | Source | Phase |
|---|---|---|
| Per-team topic-name format template (`telegram_topic_name_format`) | deferred | 1 |
| Profile-derived topic emojis (schema exists, unwired) | step-3 decision | 3 |
| Per-agent topic-icon override (`bazilion agent set-topic-icon`) | v1 sketch | 3 |

**Capability expansion**
| Item | Source | Phase |
|---|---|---|
| `/spawn <profile> in <team>` (cross-team targeting) | deferred | 6 |
| `/spawn-team <profile-team>` | deferred | 6 |
| Multimodal inbound (files / photos / voice) | deferred | 11 |
| DM ingress + pairing codes + `bazilion://pair-telegram` | deferred, risk #9 | 12 |
| Multi-account (multiple bot identities per install) | deferred | 13 |
| Telegram WebApp UI (Mini App) | deferred | 14 |

**Infrastructure**
| Item | Source | Phase |
|---|---|---|
| Webhook ingress (the old "Step 8") | deferred | 10 |

**Not fixable from the bot side** (tracked, not a phase): iOS cannot deep-link into
private-supergroup forum topics (v1 step-4 decision). Revisit only if Telegram
closes the gap.

## Build status (2026-05-28)

**Shipped in this PR (one branch, per-phase commits): Phases 1–3, 5–7, 11.**
Phases 4 and 8 were built, then **removed at the operator's request** (judged
not useful). Phases 9, 10, 12 remain as ready-to-build user stories; Phases
13–14 are design spikes (open scoping questions to resolve before code). Status
legend: ✅ built · ❌ dropped · 📋 ready user story · 🔬 spike.

| # | Phase | Effort | Status |
|---|---|---|---|
| 1 | Per-team topic-name template | 1 | ✅ built |
| 2 | Inbound safety guards (drop-bot + rate budgets) | 1.5 | ✅ built |
| 3 | Profile-derived emojis + per-agent override | 2 | ✅ built |
| 4 | Granular mirror / visibility controls | 2 | ❌ dropped |
| 5 | Team-migration resilience | 2 | ✅ built |
| 6 | `/spawn ... in <team>` + `/spawn-team` | 2.5 | ✅ built |
| 7 | Per-user ACLs (TOFU + Flat) | 3.5 | ✅ built |
| 8 | Per-topic config overrides | 3 | ❌ dropped |
| 9 | Streaming via `editMessage` | 4 | 📋 ready user story |
| 10 | Webhook ingress | 4 | 📋 ready user story |
| 11 | Multimodal inbound (bounded slice) | 4.5 | ✅ built |
| 12 | DM ingress + pairing | 4.5 | 📋 ready user story |
| 13 | Multi-account | 5 | 🔬 spike |
| 14 | Telegram WebApp UI | 5 | 🔬 spike |

Notes on what shipped vs. the original specs:
- **Phases 4 & 8 removed.** Per-trigger silence / per-message `[[no-telegram]]`
  (4) and per-topic `require_mention`/`allow_from`/`silent` overrides (8) were
  implemented then reverted — the operator found them not worth the surface.
  Their specs are kept below for the record, marked dropped.
- **Phase 2** reframed from OpenClaw's multi-bot "bot-loop protection" to the
  single-bot-correct guards (drop bot inbound + per-agent rate/noise budgets) —
  see the premise correction in the Phase 2 section.
- **Phase 11** shipped a *bounded slice*: inbound media is downloaded + referenced
  by path in the turn (no longer silently dropped), but native provider image
  content blocks are deferred (see Phase 11).
- Within Phase 3, profile-level emoji *editing* (the `profiles.telegram_icon_emoji`
  column) is deferred; the zero-config BUILTIN-by-profile-name map + per-agent
  override shipped.

Each phase below is a self-contained PR. The format mirrors v1: **User story →
Design decisions → Schema & code sketch → Depends on → Open questions.** Open
questions are decisions to lock *during* the phase's PR review, not now.
The features described below shipped originally as incremental migrations. BAZ-018 later folded
all surviving columns and tables into the clean-install-only `0001_init.sql`; the old migration
filenames are retained in this roadmap only as historical references.

---

## Phase 1 — Per-team topic-name format template

### User story
An install prefers `Home Reno / Researcher` (display names) over the hardcoded
`home-reno › researcher` (slug-arrow). The user wants to set the format per team.

### Design decisions
- **`teams.telegram_topic_name_format` column**, nullable; null = today's hardcoded
  format. Template tokens: `{team.name}`, `{team.slug}`, `{agent.name}`.
- **Rendered in `topicNameFor`** — the one place topic names are computed. The
  `telegram_topic_name_locked` sticky bit (human-renamed topics) still wins over any
  template.
- **Changing a team's template re-propagates** to all non-locked topics in that
  team via the existing name-sync path.

### Schema & code sketch
- Migration `0005_group_topic_name_format.sql`: `ALTER TABLE teams ADD COLUMN
  telegram_topic_name_format TEXT`.
- `naming.ts:topicNameFor` reads the column, falls back to the default.
- CLI: `bazilion team edit <slug> --topic-format "..."`. Web: a field on the team
  detail page.

### Depends on
Nothing. Smallest phase — good warm-up.

### Open questions
- Token escaping / validation (reject unknown tokens vs render literally). Proposed:
  validate on write, reject unknown tokens with a clear error.

---

## Phase 2 — Telegram inbound safety: drop-bot + rate budgets (safety)

> **Premise correction (2026-05-28).** The original framing was OpenClaw's
> *multi-bot* "bot-loop protection." It does not map to bazilion: we run **one**
> bot, and Telegram **never redelivers a bot's own messages** to itself — so the
> two-bots-echoing loop (and single-agent self-echo) **cannot occur** via
> Telegram. The actually-dangerous runaway (two agents replying forever) is
> driven by the **internal `send_message` / heartbeat machinery**, not Telegram;
> those turns merely *mirror* out. A Telegram-ingress window can't stop it, so it
> is explicitly **out of scope here** (candidate for its own non-Telegram phase).
> This phase implements the guards that *are* correct + useful for a single bot.

### User story
Another bot in the supergroup (or a human/script hammering a topic) drives an agent
into a flood; or a heartbeat-heavy agent spams its topic with verbose tool-line
noise that eats the shared per-supergroup send quota. The user wants safe, automatic
backstops that never lose the agent's actual replies.

### Design decisions (as built)
- **Drop bot-authored inbound.** `routing.ts` returns `{kind:'ignored_bot'}` for any
  `m.from.is_bot` message, before classification. This is the real single-bot loop
  guard: it stops *other* bots from driving agent turns (bazilion never sees its own
  messages anyway).
- **Per-agent inbound budget** (`loop-guard.ts`, keyed on `agentId`). Default
  `20 events / 60s window / 60s cooldown` via `BAZILION_TELEGRAM_LOOP_BUDGET`
  (`max/windowSec/cooldownSec`). The cooldown **latches** — once tripped, inbound for
  that agent is dropped for the full cooldown, not just until the rolling window
  drains. On the first drop of a window the router posts **one** "slow down" notice
  (`shouldNotifyInboundThrottle`), suppressed for the rest of the cooldown.
- **Per-agent outbound NOISE budget** (`loop-guard.ts`, keyed on `agentId`). Default
  `30 / 60s` via `BAZILION_TELEGRAM_AGENT_THROTTLE`. Applies **only** to non-essential
  mirror frames (verbose `tool_call`/`tool_result`/`tool_error`). Essential frames —
  `assistant_message`, `error`, `fatal` — always pass: we never drop the agent's reply
  or an error, only the verbose scaffolding. (Minimal-mode agents emit no noise, so
  they're unaffected.)
- **Loud-but-local**: every trip logs; inbound posts one notice; nothing crashes the
  turn. Budget state is in-memory (same lifetime as the General-redirect map +
  `spawn-state.ts`); reset hooks fold into `_resetRouterStateForTest` /
  `_resetMirrorDepsForTest`.

### Schema & code sketch (as built)
- No migration. New `apps/daemon/src/lib/telegram/loop-guard.ts` — sliding-window
  `tryConsume` + `allowTelegramInbound` / `allowTelegramOutboundNoise` /
  `shouldNotifyInboundThrottle`. Env parsed once at module load.
- `routing.ts`: `is_bot` drop + inbound-budget branch; new `RouteOutcome` kinds
  `ignored_bot`, `rate_limited`; logging in `bot.ts`.
- `mirror.ts`: `isEssentialFrame` gate + noise-budget check before send.

### Depends on
Nothing. Self-contained.

### Deliberately deferred to a separate (non-Telegram) item
- **Internal agent-to-agent loop guard** — a budget at the `send_message` / heartbeat
  seam in the messaging/scheduler layer. This is the one that actually prevents
  cost-runaway; it belongs outside the Telegram roadmap.
- **Pausing triggers on trip** (vs just dropping traffic) — bigger blast radius;
  dropping is sufficient for the Telegram-side guard.

---

## Phase 3 — Profile-derived topic emojis + per-agent override

### User story
Every agent topic looks the same (color-only icon). The user wants `researcher` to
show 📚, `coder` 💻, etc., automatically, and wants to override a specific agent's
icon.

### Design decisions
- **Finish what migration 0003 started.** The columns exist; this phase seeds and
  wires them.
- **Resolve sticker ids at activation** via `getForumTopicIconStickers` (Telegram
  returns the ~70-emoji set with their `custom_emoji_id`s). Map curated built-in
  profile names → emoji char → resolved sticker id; cache the resolution.
- **Lookup order at topic creation** (already specced in v1): `agents.telegram_icon_
  emoji` → `profiles.telegram_icon_emoji` → color-only fallback.
- **Seed built-ins** (`BUILTIN_PROFILE_EMOJI`): `researcher → 📚`, `coder → 💻`,
  `notes-archivist → 📝`, `analyst → 📊`, … (final mapping lives in seed data, chosen
  from the available sticker set; profiles whose chosen emoji isn't in Telegram's set
  fall back to color-only).
- **Per-agent override** via `bazilion agent set-topic-icon <agent> <emoji>` + web
  control; clearing it falls back to the profile default.
- **Apply to existing topics** opportunistically via `editForumTopic` when the agent
  or profile icon changes (cheap, same propagation path as name sync).

### Schema & code sketch
- No migration (columns exist).
- New `apps/daemon/src/lib/telegram/profile-emojis.ts`: `BUILTIN_PROFILE_EMOJI` map +
  `resolveStickerId(api, emojiChar)` with activation-time caching.
- `topic-autocreate.ts` + `naming.ts` consult the lookup order.
- Seed step in `ensureSetupSeeded` writes built-in defaults into
  `profiles.telegram_icon_emoji`.
- CLI `set-topic-icon`; web control in the agent detail Telegram section.

### Depends on
Nothing. Quick, visible win.

### Open questions
- Final emoji choices for built-ins (cosmetic; pick from the live sticker set during
  implementation).

---

## Phase 4 — Granular mirror / visibility controls

> **Status: ❌ dropped** — built then removed at the operator's request (per-trigger
> silence + per-message `[[no-telegram]]` judged not useful). Spec kept for the record.

### User story
Heartbeat-driven turns flood a topic with routine status pings the user doesn't want
to see, and occasionally an agent does internal bookkeeping it shouldn't surface at
all. The user wants to silence specific triggers and let an agent mark a turn as
not-for-Telegram.

### Design decisions
- **Per-trigger silence** (`agent_triggers.silent_in_telegram`): a heartbeat/cron
  trigger flagged silent runs the turn normally but skips the outbound mirror. Today
  *every* trigger mirrors (v1 step-2 decision); this is the opt-out.
- **Per-message visibility**: a lightweight marker the agent can emit to suppress
  mirroring of the current turn — implemented as a recognized sentinel/tool rather
  than a new event type, so the ChatFrame stream stays unchanged. The mirror checks
  for the marker and short-circuits.
- **Errors/fatals still always mirror** regardless of silence flags — consistent with
  the v1 step-6 decision that errors are too important to hide.

### Schema & code sketch
- Migration `0006_trigger_silence.sql`: `ALTER TABLE agent_triggers ADD COLUMN
  silent_in_telegram INTEGER NOT NULL DEFAULT 0`.
- Mirror seam reads the trigger-origin flag (threaded through `runAgentTurn`'s trigger
  path) + scans for the per-message suppress marker.
- CLI: extend `bazilion trigger add/edit` with `--silent`. Web: a checkbox on the
  trigger form (`/agents/:id/triggers`).

### Depends on
Nothing structural; complements Phase 8's per-topic `silent`.

### Open questions
- Mechanism for per-message suppression: a dedicated tool (`telegram_suppress`) vs a
  magic prefix in the assistant message vs a frame annotation. Tool is cleanest but
  costs a tool slot; decide at PR time.

---

## Phase 5 — Team-migration resilience

### User story
Telegram upgrades the user's basic team to a supergroup (or migrates the chat id);
the bot's configured `TELEGRAM_CHAT_ID` is suddenly stale and everything silently
stops routing.

### Design decisions
- **Detect `migrate_to_chat_id`** in the update stream (it arrives as a service
  message on the old chat).
- **v1 doc chose "surface a reconnect banner," not auto-update.** This phase ships the
  banner: a health-card warning + web banner + a one-line note, with a one-click
  "use new chat id" action rather than a silent DB mutation from an external event.
- **Optional auto-rewrite behind a setting** for users who'd rather it just heal —
  off by default (no DB writes from runtime events is a v1 principle; this makes it
  opt-in, not the default).

### Schema & code sketch
- No migration. Router recognizes the migration service message, records the proposed
  new chat id in config (e.g. `TELEGRAM_MIGRATED_CHAT_ID`), surfaces it.
- Health endpoint + web integration page show the reconnect prompt; a
  `POST /api/config/telegram/reconnect` applies the new id.

### Depends on
Nothing.

### Open questions
- Default to banner-only (safe) — confirm we don't want opt-in auto-rewrite in the
  same PR.

---

## Phase 6 — `/spawn` cross-team targeting + `/spawn-team`

### User story
From Telegram the user can only `/spawn` into the `default` team, one agent at a
time. They want `/spawn coder in home-reno` and `/spawn-team frontend-squad` (a
Team Template) without leaving the app.

### Design decisions
- **`/spawn <profile> in <team>` (typed form)** extends the existing typed-args path;
  the keyboard flow stays `default`-only (or grows a second team-picker step — decide
  at PR time). Team is resolved by slug; unknown slug → error with `/teams` hint.
- **`/spawn-team <team-template>`** reuses the daemon's canonical transactional
  Team Template spawn. The Telegram surface is a thin keyboard: pick a Team Template →
  confirm target Team → bulk-create →
  auto-bind each new agent's topic → post a directory refresh + a summary with
  deep-links.
- **Topic auto-creation for a team** goes through the same per-supergroup outbound
  queue — the thundering-herd case (N agents created at once) is already bounded by
  the queue (v1 outbound-queue decision).

### Schema & code sketch
- No migration — pure command-surface work over existing spawn primitives.
- Extend `commands/spawn.ts` arg parser for the `in <team>` tail; new
  `commands/spawn-team.ts`; register in `commands/index.ts` + `setMyCommands`.
- New callback prefix for the team-picker keyboard, handled in `routing.ts`.

### Depends on
Nothing structural (builds on shipped spawn + profile-team code).

### Open questions
- Does the `/spawn` keyboard grow a team-picker, or stay `default`-only with
  cross-team reserved for the typed form? (Proposed: typed form for cross-team;
  keyboard stays simple.)

---

## Phase 7 — Per-user ACLs (security foundation)

> Pulled ahead of Phase 8 despite being marginally larger: per-topic overrides
> (Phase 8) intersect with this allowlist, so the foundation must land first.

### User story
The user adds a family member to the supergroup so they can chat with one agent. Today
that grants them the power to `/spawn`, `/close`, and talk to *every* agent. The user
wants an allowlist: only approved Telegram users can issue commands (and, optionally,
chat).

### Design decisions
- **Storage: a dedicated table, not a config blob.** `telegram_allowed_users` carries
  `user_id` (PK), `username`, `label`, `added_at`, `role`. A table (vs a
  comma-separated config key) lets us store who's who and grow toward roles without a
  reshape.
- **Bootstrap model — OPEN QUESTION, two candidates** (decide at PR review):
  - *TOFU (trust-on-first-use):* while the table is empty, the first user to message
    the bot is auto-added as `owner` and announced; enforcement begins immediately
    after. Zero-config; the setup operator is naturally first; locks down on first
    touch.
  - *Explicit, open-until-seeded:* bot stays open (today's behavior) while the table
    is empty; the operator opts into enforcement by adding the first user via
    CLI/web/`/allow`. No surprises, but it's open until you remember to lock it.
- **Enforcement scope — OPEN QUESTION, two candidates:**
  - *Flat:* one allowlist gates BOTH commands and agent chat. Not on the list = bot
    ignores you (one suppressed "not authorized" reply, 60s-per-user like the
    General redirect). Simplest, strongest.
  - *Tiered:* allowlist gates admin commands only; anyone in the supergroup can chat
    with bound agents. The `role` column makes this cheap later even if we ship Flat
    first.
- **Self-protection:** the `owner` row cannot be removed by `/deny` (mirrors the
  bootstrap-token non-revocation invariant in the daemon auth model). At least one
  `owner`/admin must always remain.
- **`/whoami` is the existing seed** — it already returns `user_id`; the new
  management commands consume it.

### Schema & code sketch
- Migration `0007_telegram_acl.sql`: `telegram_allowed_users(user_id INTEGER PRIMARY
  KEY, username TEXT, label TEXT, role TEXT NOT NULL DEFAULT 'member', added_at
  INTEGER NOT NULL)`.
- Repo `apps/daemon/src/core/repos/telegram-acl.ts`: `list`, `isAllowed(userId)`,
  `add`, `remove`, `count`, `hasOwner`.
- Enforcement hook in `routing.ts` — a single `authorize(deps, m.from, surface)`
  gate at the top of `routeUpdate`, before command dispatch and before inbound
  enqueue. Returns an outcome `{ kind: 'unauthorized'; userId }` (new RouteOutcome).
- New commands `/allow <user_id|@username>`, `/deny <user_id>`, `/allowed` (list),
  all `context: 'service'`, themselves gated to admins.
- CLI: `bazilion telegram allow|deny|list-allowed`.
- Web: an "Access control" card on `/config/integrations/telegram`.
- Wire types: `TelegramAllowedUser`, `TelegramAclState` in `@bazilion/api-types`.

### Depends on
Nothing structural; foundational for Phase 8 and the beyond-v2 cross-channel item.

### Open questions
Bootstrap model + enforcement scope (above). Both are genuine product forks — lock
them before writing the enforcement hook.

---

## Phase 8 — Per-topic config overrides

> **Status: ❌ dropped** — built then removed at the operator's request
> (`require_mention` / `allow_from` / `silent` per-topic overrides judged not
> useful). Spec kept for the record.

### User story
The user wants one specific agent's topic to require an @-mention before it responds
(it's a noisy reference agent), and another topic restricted to just themselves even
though others are allowed globally.

### Design decisions
- **`agent_telegram_overrides` table layered on the auto-bind model** — does not
  change how topics get created/bound, only how an already-bound topic behaves.
- **Three knobs in v1 of this phase:** `require_mention` (bool — topic only responds
  when the bot is @-mentioned or replied-to), `allow_from` (JSON array of user_ids
  that *narrows* the Phase-7 allowlist for this topic), `silent` (bool — suppress
  outbound mirror for this topic; complements per-agent mirror mode).
- **Overrides are nullable and compose with globals:** `allow_from` is an
  intersection with the Phase-7 allowlist (you can only narrow, never widen — a
  topic can't grant access the global list denies).
- **Keyed on agent, not topic id**, so the override survives topic deletion +
  recreation (same rationale as `telegram_icon_emoji` in the v1 sketch).

### Schema & code sketch
- Migration `0008_telegram_topic_overrides.sql`: `agent_telegram_overrides(agent_id
  TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE, require_mention INTEGER
  NOT NULL DEFAULT 0, allow_from TEXT, silent INTEGER NOT NULL DEFAULT 0, updated_at
  INTEGER)`.
- Router consults overrides in the agent-topic branch: mention-gate before enqueue,
  per-topic `allow_from` intersection in the `authorize` gate, `silent` short-circuit
  in the mirror.
- CLI: `bazilion telegram topic-config <agent> [--require-mention] [--allow ...]
  [--silent]`. Web: a small overrides block inside the agent detail page's Telegram
  section.

### Depends on
Phase 7 (uses the allowlist primitive for `allow_from` intersection).

### Open questions
- Does `require_mention` apply only to plain chat, or also to typed commands in the
  topic? (Proposed: chat only — commands are explicit intent.)

---

## Phase 9 — Streaming modes (partial via editMessage)

> **Status: 📋 ready user story** — not built in this PR. Spec below is implementation-ready.

### User story
On the web UI the user watches the agent type in real time. On Telegram they wait,
then a finished block appears. They want the live feel.

### Design decisions
- **Per-agent streaming mode**, extending `telegram_mirror_mode`'s spirit:
  `final` (today — one message per turn), `partial` (a placeholder message edited in
  place as `assistant_delta` events arrive), and keep `off` via the silence controls.
- **Rate-limit-aware editing.** Telegram allows ~30 edits/min per chat; debounce
  edits (e.g. min 1.5–2s between `editMessageText` calls, flush on turn end). Edits
  go through the same per-chat outbound queue so they interleave correctly with other
  topics' sends.
- **4096-char rollover.** When streamed text crosses the limit mid-turn, finalize the
  current message and start a new one — the outbound design was explicitly told (v1
  step-6) not to lock into one-message-per-turn, so this is the payoff.
- **Tool-call interleaving.** In verbose mode, tool summary lines and streamed deltas
  must not stomp each other — deltas edit the *current* assistant bubble; tool lines
  are separate messages. Lock the interleaving rule at PR time.
- **Fallback.** If `editMessageText` fails (message too old, deleted), fall back to a
  fresh final message — never lose content.

### Schema & code sketch
- Migration `0009_telegram_stream_mode.sql`: `ALTER TABLE agents ADD COLUMN
  telegram_stream_mode TEXT NOT NULL DEFAULT 'final' CHECK (... IN
  ('final','partial'))`. (Or reuse/extend `telegram_mirror_mode` — decide whether
  verbosity and streaming are one axis or two.)
- `mirror.ts` grows a streaming path: open a placeholder on first delta, debounced
  edits, finalize on `assistant_message`/`done`.
- CLI + web mode selector alongside the existing mirror-mode control.

### Depends on
Phase 2 (the throttle/queue interactions matter once edits are frequent).

### Open questions
- One axis or two: is streaming orthogonal to minimal/verbose, or a third mirror
  mode? (Proposed: orthogonal — `stream_mode` × `mirror_mode`.)
- Edit debounce interval — tune against the 30 edits/min ceiling.

---

## Phase 10 — Webhook ingress (the old "Step 8")

> **Status: 📋 ready user story** — not built in this PR. Needs a public URL to test.

### User story
The user runs the daemon behind a public URL (Tailscale Funnel, Cloudflare Tunnel,
VPS) and wants the efficiency of push delivery instead of long-polling.

### Design decisions
- **Opt-in, polling stays the default.** Webhook is for users who already have a
  public URL. Config gains `TELEGRAM_WEBHOOK_URL` + `TELEGRAM_WEBHOOK_SECRET`.
- **grammY's Hono adapter** (`webhookCallback(bot, 'hono')`) slots into the existing
  Hono stack — the library was picked partly for this (v1 library-pick note). New
  route `POST /api/telegram/webhook`, secret-token validated
  (`X-Telegram-Bot-Api-Secret-Token`).
- **Mode switch tears down polling** cleanly (reuse the existing bot-singleton
  recycle path) and `setWebhook`; switching back `deleteWebhook` + restart polling.
- **Conflict recovery** is the mirror image of v1's polling startup: if a webhook is
  set but the user reverts to polling, `deleteWebhook` first.
- **Failover:** if webhook delivery looks dead (no updates past a threshold) surface
  it on the health card; don't silently fall back (silent mode-switching hides
  misconfiguration).

### Schema & code sketch
- No migration (config keys only).
- `bot.ts` grows a webhook lifecycle alongside the polling lifecycle; the singleton
  picks mode from config at start.
- New webhook route; health endpoint reports `mode: 'polling' | 'webhook'` +
  liveness.
- CLI: `bazilion telegram webhook set <url>` / `clear`. Web: a mode toggle on the
  integration page.

### Depends on
Nothing structural; benefits from Phase 5's health-surface work.

### Open questions
- Auto-failover webhook → polling on delivery stall, or banner-only? (Lean
  banner-only to avoid hiding misconfig.)

---

## Phase 11 — Multimodal inbound (files / photos / voice)

### User story
The user wants to send a photo or a voice note into an agent topic and have the agent
actually receive it, not have it silently ignored (today non-text inbound is dropped).

### Design decisions
- **Download via `getFile` + the file API**, then hand to the agent turn. Photos/docs
  attach as content; voice notes either attach (if the provider supports audio) or get
  transcribed first — gated on provider capability.
- **Bounded by provider multimodality.** Only forward what the agent's model can
  consume; otherwise reply with a clear "this agent's model can't read images" note.
- **Size + type guards** (reuse the spirit of the web_fetch SSRF/size hardening):
  cap download size, allowlist mime types, time-box the fetch.
- **Storage:** transient — fetch, pass to the turn, don't durably persist the blob in
  `~/.bazilion` unless the agent's tools choose to.

### Schema & code sketch
- No migration (likely). New `apps/daemon/src/lib/telegram/media.ts`: `fetchTelegram
  File(api, fileId)` + mime/size guards.
- Router agent-topic branch: detect `photo`/`document`/`voice`/`audio` on the message,
  fetch, attach to the enqueued turn input.
- Inbound-queue input shape grows from `string` to `{ text, attachments[] }`.

### Depends on
Provider multimodal support (already present for some models). Larger PR than the
polish phases.

### Open questions
- Voice: transcribe (which engine?) vs pass raw audio to audio-capable models. Decide
  per provider capability.
- How attachments concatenate with queued text when an agent is mid-turn (today text
  concatenates with `\n\n`).

---

## Phase 12 — DM ingress + pairing

> **Status: 📋 ready user story** — not built in this PR. Depends on Phase 7 (shipped).

### User story
The user wants to DM the bot directly (1:1, no supergroup) and have it reach a
specific agent — useful on the go without opening the forum.

### Design decisions
- **OpenClaw-style pairing codes.** A DM from an unknown user is rejected until they
  send a short-lived code (`bazilion telegram pair-code` mints an 8-char code, ~1h
  TTL). Pairing binds the Telegram user to an access identity (ties into Phase 7's
  ACL).
- **`bazilion://pair-telegram` deep link / QR** analogous to the existing mobile
  pairing flow (v1 risk #9) — "scan to pair" instead of paste.
- **DM ↔ agent routing.** A DM has no `message_thread_id`; bind the DM to a chosen
  agent (a per-user "active agent" pointer, switchable via a command).
- **dmPolicy** (`closed` / `code` / `open`) config, default `closed`.

### Schema & code sketch
- Migration for pairing codes + DM bindings (`telegram_pairings`,
  `telegram_dm_bindings`).
- Router learns a DM branch (today DMs are `foreign_chat` and dropped).
- CLI pair-code mint/list; web pairing card.

### Depends on
Phase 7 (pairing populates / references the ACL). Larger surface.

### Open questions
- Whether DM access reuses the supergroup ACL identity or is a separate principal.

---

## Phase 13 — Multi-account

> **Status: 🔬 spike** — not built. This is a cross-cutting reshape of the
> single-account assumption (all `TELEGRAM_*` config/secret keys → per-account
> rows, plus an `accountId` dimension on every router/mirror/scheduler lookup).
> Resolve the open questions below and write a focused design before coding;
> don't fold it into a feature PR.

### User story
A power user wants two bot identities on one daemon (e.g. a personal bot and a
work bot) routing to different teams.

### Design decisions
- **Multiple `(token, chat_id, service_topic)` tuples**, each its own bot singleton +
  polling/webhook lifecycle. The single-account assumption is baked into a lot of
  config keys today, so this is a real reshape (config keys become per-account rows).
- **Routing keys grow an account dimension** — every `chat_id` lookup becomes
  `(accountId, chat_id)`.
- Acknowledged in v1 as "plausible later but adds significant config and routing
  complexity." Sequenced late for that reason.

### Schema & code sketch
- Migration: `telegram_accounts` table; the flat `TELEGRAM_*` config/secret keys
  migrate to per-account rows (a data migration, not just a schema add).
- `bot.ts` manages a map of singletons; the scheduler/mirror/router thread `accountId`.

### Depends on
Touches the ACL (Phase 7), overrides (Phase 8), and webhook (Phase 10) surfaces
(per-account ACLs, per-account webhook). Do after they stabilize.

### Open questions
- Migration path for existing single-account installs (auto-create `account#1` from
  the current flat keys).

---

## Phase 14 — Telegram WebApp UI (Mini App)

> **Status: 🔬 spike** — not built. Genuine v3 territory: needs a public URL,
> `initData` HMAC auth, and a scoping decision (reuse apps/web wholesale vs a
> Telegram-specific thin UI). Run the design spike first.

### User story
The user wants a richer config/dashboard experience inside Telegram than slash
commands + inline keyboards can offer — a real UI for managing agents/teams without
leaving the app.

### Design decisions
- **A Telegram Mini App** (WebApp) served by the daemon (or apps/web), launched from a
  service-chat button. Reuses the existing web UI components where possible behind
  Telegram's WebApp auth (`initData` HMAC validation against the bot token).
- **Capstone, genuine v3 territory.** The forum-topic UI + inline keyboards already
  cover daily use; this is for power management. Listed for completeness so the
  roadmap is exhaustive.

### Schema & code sketch
- New web surface + `initData` validation middleware; a launch button in the service
  chat.

### Depends on
A public URL (overlaps Phase 10's webhook infra) and a stable web component layer.

### Open questions
- Whether to reuse apps/web wholesale behind WebApp auth or build a Telegram-specific
  thin UI. Big scoping question — defer the decision to its own design spike.

---

## Still deferred beyond v2

- **Cross-channel access teams.** Reusable sender allowlists shared across Telegram +
  a future Slack/Discord channel. Genuinely premature — it needs a second channel to
  exist before the abstraction pays for itself. Phase 7's `telegram_allowed_users`
  table is deliberately Telegram-scoped; generalizing it is the first step when a
  second channel ships.
- **iOS deep-link into private-supergroup topics.** Not a phase — it's a Telegram
  client limitation with no bot-side fix (v1 step-4 decision). Tracked; revisit only
  if Telegram closes the gap.

## Cross-cutting notes

- **Migration numbering below is historical.** Surviving v1/v2 shapes are now declared directly
  in `0001_init.sql`. New alpha schema changes edit that canonical file and require a clean
  rebootstrap; they do not continue the old numbered chain.
- **CLI/web parity is mandatory** (project invariant): every phase that adds an HTTP
  endpoint adds both a CLI surface and a web UI surface.
- **The live-deps-resolver pattern** (`installXDepsResolver`) is the established way to
  give a telegram submodule access to the running bot's `{api, chatId, db, paths}`
  without a static import cycle — new modules (loop-guard, media, etc.) follow it.
- **Each phase is one PR**, manually tested in a real supergroup before merge — the
  same discipline that carried v1.
