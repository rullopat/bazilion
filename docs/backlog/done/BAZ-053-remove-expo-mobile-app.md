---
id: BAZ-053
title: Remove the Expo mobile app
status: done
created: 2026-09-17
shipped: 2026-09-17
release: v0.21.0-beta.1
---

# BAZ-053 — Remove the Expo mobile app

## Outcome

The half-finished Expo app (version 0.0.0, four screens) is gone from the repository. On a phone
you use the responsive web UI through the private gateway, which does everything the app did.

## Decision

The owner decided on 2026-09-17 that the Expo wrapper ships neither in a beta nor in 1.0: a thin,
half-verified app costs more in support and platform work than it returns. If dedicated mobile
apps are ever built, they should integrate with the device natively, and they talk to the daemon
over HTTP like every other client.

## As built

- `apps/mobile` and its workspace references were deleted; the daemon had no mobile-specific
  routes.
- Mobile path: phone browser → [private gateway](../../private-gateway.md) HTTPS origin → login
  with a device token from `bazilion token create`.
- Telegram stays the phone-native way to chat with Agents ([BAZ-029](BAZ-029-single-owner-telegram-pairing.md)).

## Not built

- A native iOS or Android app; push notifications outside Telegram.
