---
id: BAZ-029
title: Single-owner Telegram pairing and visibility hardening
status: done
size: M
created: 2026-08-23
refined: 2026-08-26
shipped: 2026-08-26
priority: high
note: Secure the intended one-human Telegram deployment; preserve long-polling, the existing flat ACL, and shipped traffic guards.
---

# BAZ-029 — Single-owner Telegram pairing and visibility hardening

## User stories

- **As the sole Bazilion operator**, I want to prove which Telegram account is mine with a
  short-lived one-time code generated from the authenticated web UI or CLI, so another member
  cannot become owner merely by messaging the bot first.
- **As the sole Bazilion operator running it on an online server**, I want Telegram ingress to
  require both my exact Telegram user id and the configured supergroup id, so forwarded buttons,
  foreign chats, anonymous senders, and missing sender identities cannot start Agent work.
- **As the owner of a private supergroup**, I want Bazilion to warn me when the chat is public or
  has unexpected members, because an ACL can stop those members from operating the bot but cannot
  stop them from reading messages already visible in the group.
- **As an operator reviewing server logs**, I want pairing secrets and Telegram content omitted by
  default, so a diagnostic log or support bundle does not become another credential or transcript
  store.

## Goal

Replace the current trust-on-first-use (TOFU) bootstrap with an explicit, single-use owner pairing
ceremony. Until pairing succeeds, the bot is inert except for the pairing command in the configured
chat. Afterwards, the existing Telegram ACL remains the canonical authorization gate, with the
paired account stored as its owner.

The intended secure state is one configured private forum supergroup containing exactly the owner
and the Bazilion bot, with one `owner` ACL row and no `member` rows:

```text
authenticated web / CLI -> mint one-time code
                                 |
configured private supergroup -> /pair <code> from exact Telegram user
                                 |
                    consume code + persist owner atomically
                                 |
       exact chat id + allowed user id -> existing routing / rate guards
```

Telegram continues to use outbound `getUpdates` long-polling. This story does not add a webhook or
require a public Bazilion HTTP endpoint.

## Current risk

- When `telegram_allowed_users` is empty, the first identifiable sender is automatically inserted
  as `owner`. On a restarted or remotely hosted installation, ownership can therefore be won by a
  race rather than an authenticated setup action.
- The current router treats an update without `message.from` as allowed. Anonymous administrators,
  channel-attributed posts, and malformed or newly introduced update shapes must fail closed rather
  than reach commands or Agent turns.
- The ACL controls who may operate the bot, not who can read a supergroup topic. A private group
  that gains another member has crossed the intended confidentiality boundary even when that member
  is not allowlisted.

## Scope

### One-time owner pairing

- Remove automatic owner creation from ordinary Telegram traffic. An empty ACL means **unpaired and
  closed**, not open.
- Add an authenticated web/CLI action that creates one cryptographically random pairing code. Use
  at least 128 bits of entropy, show the plaintext once, store only a SHA-256 digest, expire it after
  a short bounded window, and allow at most one active challenge.
- Accept `/pair <code>` only as a new message in the configured supergroup's `⚙ bazilion` service
  topic. It must never be treated as Agent input, copied into a session transcript, mirrored, or
  included in a log.
- A successful pairing atomically verifies the digest and expiry, consumes the challenge, requires
  a concrete non-bot `from.id`, and inserts that sender as the sole initial `owner` in
  `telegram_allowed_users`. Concurrent attempts cannot both succeed and a consumed code cannot be
  replayed.
- Before pairing, all other messages, edits, commands, media, and callback queries are ignored with
  a generic, rate-limited setup response. The response reveals neither the active code nor any
  owner, bot, or server identifiers.
- Saving a genuinely different bot token or chat id invalidates any active challenge and the old
  owner binding. The existing authenticated supergroup-migration reconnect flow may carry the
  owner forward when it applies Telegram's recorded `migrate_to_chat_id`; an arbitrary chat-id
  replacement may not.
- Provide an authenticated, explicit reset/re-pair action for account-loss recovery. It must be
  clearly destructive, require confirmation in CLI/web, and invalidate active challenges.

### Exact ingress identity

- Apply one shared Telegram ingress gate to messages, edited messages, callback queries, and any
  future actionable update type before command dispatch, pending UI state, media download, or Agent
  enqueue.
- Require the update to belong to the configured chat and to carry a concrete, non-bot sender id.
  Missing `from`, anonymous-admin attribution, `sender_chat`, foreign-chat callbacks, inline-mode
  callbacks without the configured message context, and bot-authored input fail closed.
- After pairing, require the sender to pass the existing flat `telegram_allowed_users` check. The
  pairing flow creates only the owner; it does not introduce a second role or a second authorizer.
- Keep last-owner self-protection and the existing explicitly authenticated ACL administration
  surfaces. The web/CLI health view must call out any additional ACL member as a departure from the
  recommended single-user posture; redesigning multi-user roles is not part of this story.

### Private-supergroup visibility warnings

- Extend preflight/health to verify that the configured chat is a forum supergroup, has no public
  `@username`, and reports the expected member count for one human plus the bot.
- Make the UI and CLI state the actual Telegram boundary: every supergroup member can read content
  posted to visible topics even when they cannot command the bot. Telegram supergroups are not
  end-to-end encrypted conversations with Bazilion.
- Subscribe the existing long-poll loop to the membership update kinds needed to notice the paired
  owner leaving and another member joining. Surface a durable health warning and one rate-limited
  warning in the service topic without persisting the other member's identity.
- If the paired owner is no longer a current member, mark Telegram degraded and reject ingress
  until the operator resolves or resets pairing. Do not silently transfer ownership.
- Do not claim that the Bot API can enumerate or remove every member. Member count and observed
  membership changes are warnings around a human-managed private group, not a confidentiality
  guarantee.

### Log and secret minimization

- Never persist or log the plaintext pairing code, bot token, raw Telegram update, message/caption,
  media bytes or filename, owner username, or unauthorized sender details.
- Default Telegram logs to bounded event/reason codes and operational timestamps. Where correlation
  is necessary, prefer the Telegram update id and Bazilion's internal Agent id over chat/user
  identity.
- Ensure Bot API errors are sanitized so a request URL containing the bot token cannot reach logs,
  HTTP errors, or web/CLI diagnostics.
- A consumed `/pair` message may remain in Telegram history unless the bot already has permission
  to delete it. Best-effort deletion is allowed, but adding broader delete-message privileges is
  not required because the code is single-use and immediately invalidated.

### Existing behavior to preserve

- `getUpdates` long-polling, persisted update watermark, retry behavior, and stall watchdog.
- The existing `telegram_allowed_users` flat authorization gate and last-owner protection.
- Bot-authored-input rejection, per-Agent inbound rate/cooldown budget, per-Agent outbound-noise
  budget, and essential reply/error delivery.
- Team Policy enforcement, communication approvals, Agent causal-loop protection, topic binding,
  media handling, and Telegram's service/Agent-topic command split.

## HTTP, CLI, and web surfaces

- Add canonical wire shapes for pairing status and the one-time challenge response. Status may
  expose `unpaired | challenge_active | paired | degraded`, expiry, and redacted owner/chat health;
  it must never return a challenge digest or previously issued plaintext code.
- Add authenticated endpoints to create/cancel a challenge and explicitly reset pairing. Challenge
  consumption remains an internal Telegram routing operation, not an unauthenticated HTTP route.
- CLI: add `bazilion telegram pair-code`, `pair-status`, `pair-cancel`, and an explicitly confirmed
  `pair-reset --yes` recovery command.
- Web: replace all "first user claims owner" copy with a pairing card that generates/copies the code
  once, counts down expiry, shows paired/degraded state, and explains group visibility. Show public
  chat, unexpected member count, missing owner membership, and extra ACL rows as separate warnings.
- Preserve CLI/web parity and the existing Telegram setup, preflight, health, restart, migration,
  and ACL-management surfaces.

## Non-goals

- Multi-user identity, invitations, roles, RBAC, per-topic permissions, or cross-channel accounts.
- General Telegram DM ingress or a Telegram chat flow outside the configured supergroup.
- Telegram webhooks, Tailscale/public-server setup, TLS termination, or opening a daemon/web port.
- Automatically kicking members, managing invite links, or promising private-topic visibility
  inside a shared supergroup.
- Changes to Telegram message/media capabilities, streaming, topic UX, or rate-limit values.
- Web/mobile session hardening, worker credential isolation, or encrypted backups; those belong to
  their respective security stories.
- Compatibility migrations or TOFU-owner inference for pre-alpha databases. The clean-install
  schema remains canonical.

## Acceptance tests

- With an empty ACL and no challenge, ordinary messages, commands, edits, media, and callbacks do
  not create an owner, mutate state, download media, or start an Agent turn.
- Challenge creation requires authenticated HTTP access, replaces any previous challenge, returns
  plaintext once, persists only a digest, and enforces entropy, expiry, single use, cancellation,
  and bounded failure behavior.
- A valid `/pair` in the service topic creates exactly one owner and consumes the challenge in one
  transaction; expired, cancelled, replayed, malformed, wrong-chat, wrong-topic, bot-authored, and
  concurrent attempts fail without disclosing why to an untrusted sender.
- Pairing content never reaches Agent input, pi session JSONL, mirror output, attention items, logs,
  or a subsequent status response.
- Messages and callback queries are accepted only when both chat id and concrete allowed user id
  match. Missing-sender, anonymous-admin, `sender_chat`, foreign-chat, and message-less inline
  callback cases fail closed.
- Changing bot/chat credentials invalidates the old binding; authenticated migration reconnect
  preserves it only for the recorded Telegram migration target; explicit reset supports recovery
  without reviving a consumed challenge.
- Preflight and health distinguish private/public chat posture, expected/unexpected member count,
  owner-present/owner-missing state, and extra ACL rows. Membership warnings contain no member
  identity or message content and are rate-limited.
- Captured logs and HTTP/CLI errors contain no bot token, pairing code/digest, raw update, message,
  caption, media filename/bytes, username, or unauthorized sender id.
- Regression tests prove that polling offsets, restart/stall recovery, bot-input rejection, inbound
  cooldown, outbound-noise throttling, essential replies, ACL checks, Team Policy, and topic routing
  retain their shipped behavior.
- CLI and web cover challenge creation/cancellation, paired and degraded status, confirmed reset,
  expired-code recovery, setup copy, and every visibility warning.

## Delivery slice

BAZ-029 is complete when a clean single-user install can configure Telegram, generate one code from
an authenticated web or CLI session, pair the operator's exact Telegram account in the configured
service topic, and remain closed to every other or unidentified sender. The operator can see when
the supergroup's visibility or membership no longer matches the one-human posture, while existing
long-polling, ACL, rate, Team Policy, and topic behavior continues unchanged and no pairing secret
or Telegram content is added to Bazilion logs.

## Refined decisions

1. **Unexpected-member response:** public or unexpected membership is a high-severity health
   warning in this release. Automatic outbound suspension remains separately gated until Bot API
   membership reliability is established in production.
2. **Pairing location:** `/pair <code>` is accepted only in the configured service topic. DMs and
   callbacks without configured-chat message context remain closed.
3. **Recovery:** the authenticated reset is the emergency fail-closed operation: it revokes the
   current owner immediately and requires a fresh challenge. An overlap-safe rotation can follow if
   real account-migration usage requires it.

## As built

- Replaced first-message TOFU with a singleton ten-minute challenge containing a SHA-256 digest
  only; 128-bit URL-safe plaintext is returned once through authenticated HTTP, CLI, or web.
- Added atomic consume/replay protection, explicit cancellation, confirmed owner reset, and
  automatic invalidation when bot credentials or configured chat identity changes.
- Applied a fail-closed ingress gate to messages, edits, and callbacks. Missing senders, bots,
  sender-chat attribution, foreign chats, and callbacks without configured-chat context cannot
  reach commands, media download, pending UI state, or Agent enqueue.
- Extended preflight, CLI, and web diagnostics with private-chat, member-count, and paired-owner
  presence checks. Membership is advisory in this release, matching the refined rollout decision.
- Removed Telegram message previews, chat/user identity, and pairing material from daemon logs and
  sanitize Bot API credential-bearing error text.
