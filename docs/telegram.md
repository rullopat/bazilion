# Telegram integration

Telegram is an optional client surface for the same daemon-owned Agents, Team Policy, queues,
questions and Results. It uses one configured bot and forum supergroup, with a service topic
for management and one bound topic per Agent. It does not require exposing the daemon publicly.

## Setup and owner pairing

1. Create a bot with BotFather and add it to a forum-enabled supergroup with the permissions
   needed to create/manage topics and send messages.
2. Set the token and supergroup chat ID through the web Telegram configuration or
   `bazilion telegram config set`. The token is a stored secret, not an Agent document.
3. Inspect `bazilion telegram health` and `bazilion telegram bot status`. Health is a real Bot API
   preflight; do not mistake saved configuration for a successful connection.
4. Create a one-time owner challenge through the web or `bazilion telegram pairing create`.
   Send `/pair <code>` in the configured service topic. An unpaired installation is closed;
   the first arbitrary Telegram sender does not become owner.
5. Use the service topic's `/talk` or `/spawn` flow to open an Agent topic. CLI `telegram bind`,
   `unbind` and `list` provide management fallbacks.

Pairing requires a bounded, expiring, single-use operator-created challenge and the configured
service-topic context. Reset/re-pair is an explicit owner operation, not automatic takeover.
See [BAZ-029](backlog/done/BAZ-029-single-owner-telegram-pairing.md).

## Daily use

- `/talk` opens or creates an existing Agent's topic; `/spawn` creates an Agent from a Profile.
- `/spawn_team` uses a Team Template; `/list` and `/teams` show resources.
- `/health`, `/whoami` and `/help` explain the bot/session and available commands.
- In an Agent topic, `/close`, `/rebind`, `/unbind` and `/queue` manage the binding/follow-up path.
- An active Agent's incoming work uses the durable follow-up queue rather than a second turn
  executing concurrently. Inspect interrupted or paused work instead of repeatedly submitting it.
- Assistant messages, errors and authorized tool-produced images/files mirror to the bound topic.
  Minimal/verbose mirror settings control tool chatter; they are not permission to disclose a
  private Result or bypass Team Policy.

Topic names reflect Team/Agent names, supported templates and human-renamed locks. Topic icons
can use built-in profile defaults or Agent overrides. iOS deep-link behavior for private forum
subtopics can require manual topic navigation; a bot-generated link does not guarantee client support.

## Attachments, questions and attention

Inbound photos enter the normal image-capable turn input. Other files, including audio/video,
are saved as file references; native audio/video understanding/transcription is not promised.
Bounded media retrieval does not imply the selected model can interpret every attachment.

Outbound files/images are captured as durable Results and pass the same disclosure policy as web
and CLI delivery. A pending approval is not an empty or already-shared Result.

Structured questions use bound Telegram choices/Other/Skip and daemon-owned consumption receipts;
a callback or answer send is not proof a worker consumed it. Attention notifications are bounded
lifecycle hints, not another transcript. See [questions](questions.md), [Results](results.md),
[follow-up queue](follow-up-queue.md) and [notifications](attention-notifications.md).

## Safety and lifecycle

- Owner/allowlist checks and Team Policy gate ingress and egress. Owner management does not widen
  an Agent's provider/tool capabilities or let a sender bypass a held communication.
- Bot-authored inbound is ignored. Per-Agent inbound and outbound-noise budgets bound floods;
  essential replies/errors are distinct from verbose tool chatter. Internal Agent-to-Agent loop
  protection is a separate causal-hop mechanism, not a Telegram-only throttle.
- Outbound API operations use the bounded queue and handle rate limits/errors; uncertain external
  sends must not be blindly replayed to manufacture delivery.
- Long polling is the current ingress. `telegram bot restart` reactivates from current settings;
  configuration failures stay visible. Chat-ID migration is surfaced through explicit reconnect,
  not treated as authorization for an arbitrary new destination.
- Never place bot tokens, pairing codes or private payloads in source, user stories or shared logs.

The integration is daemon-owned under `apps/daemon/src/lib/telegram/`, with configuration/routes
in the daemon and CLI/web management parity. Future features live in the
[Telegram user-story roadmap](telegram-v2.md), not implied by current support.
