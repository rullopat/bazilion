---
id: BAZ-029
title: Telegram owner pairing
status: done
created: 2026-08-23
shipped: 2026-08-26
release: v0.13.0
---

# BAZ-029 — Telegram owner pairing

## Outcome

The Telegram bot answers its owner and the people the owner allows, nobody else. The owner pairs
with a one-time code from the web UI or the CLI; until then the bot answers nobody.

## Scope

- A pairing code is valid for ten minutes; `/pair <code>` in the service topic makes the sender
  the owner. Creating a new code, cancelling it or resetting the pairing is done from the web or
  CLI.
- The owner allows others by Telegram user id (`/allow`, `/deny`, `/allowed`, or the web and CLI
  allowlist). Only the owner can allow and deny. Someone not on the list gets a reply with their
  user id; messages from other bots and anonymous admins are ignored.
- Removing someone cancels their waiting follow-ups; resetting the pairing or clearing the bot
  credentials does so for everyone.
- The bot keeps long polling; the daemon needs no public address.

## As built

- CLI: `bazilion telegram pairing create|status|cancel`, `telegram pairing reset --yes`,
  `telegram allow <user-id> [--label …]`, `telegram deny <user-id>`, `telegram allowed`.
- Web: the pairing and allowlist cards on `/config/integrations/telegram`.
- HTTP: `GET /api/config/telegram/pairing`, `POST|DELETE /api/config/telegram/pairing/challenge`,
  `POST /api/config/telegram/pairing/reset`, `GET|POST /api/config/telegram/acl`,
  `DELETE /api/config/telegram/acl/:userId`.
- Tables: `telegram_pairing_challenge`, `telegram_allowed_users`.
- Guide: [Telegram](../../telegram.md).

## Known limits

- Anyone in the supergroup can read the topics; keep the group to people you trust.
- One bot and one supergroup per home.
