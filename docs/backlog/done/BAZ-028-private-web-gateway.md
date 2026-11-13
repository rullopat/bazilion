---
id: BAZ-028
title: Private web gateway
status: done
created: 2026-08-23
shipped: 2026-08-26
release: v0.13.0
---

# BAZ-028 — Private web gateway

## Outcome

You can use Bazilion from a laptop or phone through the web UI published on your tailnet, while
the daemon stays on loopback. Each device has its own revocable token, browsers never hold a
bearer token, and a lost device is cut off with one revoke.

## Scope

- One topology: Tailscale Serve (tailnet-only HTTPS) in front of the loopback web UI. Funnel, a
  public reverse proxy and exposing the daemon are not supported.
- `BAZILION_PUBLIC_ORIGIN` sets the exact HTTPS origin: the daemon refuses a non-loopback bind,
  cookies become `__Host-` cookies and the web UI accepts only that host.
- Login takes a token (the bootstrap token or a device token) and returns a hashed session
  cookie plus a session-bound CSRF cookie; writes need the CSRF header. A session ends after 30
  days without use or when its token is revoked.
- Device tokens have full access and expire only when created with an expiry. The bootstrap token
  cannot be revoked.
- The gateway checks Host and Origin, strips forwarding headers and caps request bodies.

## As built

- CLI: `bazilion token create <label> [--expires-days N]`, `token list [--all]`,
  `token revoke <id>`, `token show-local`; `bazilion session list|revoke`;
  `bazilion login --server <url> --token <token> | --clear` for a remote CLI (saved in the local
  `auth.json`, so it needs a local home; `BAZILION_SERVER` with `BAZILION_TOKEN` works without one).
- Web: `/login`, **Setup → Tokens** (`/config/tokens`) for tokens and browser sessions.
- HTTP: `POST /api/login`, `POST /api/logout`, `GET|POST /api/tokens`, `DELETE /api/tokens/:id`,
  `GET /api/sessions`, `DELETE /api/sessions/:id`, `GET /api/auth/whoami`.
- Tables: `web_tokens`, `web_sessions`; the request boundary is `apps/web/src/start.ts`.
- Guide: [private gateway](../../private-gateway.md).

## Not built

- Token scopes and pairing codes (removed); a native mobile app ([BAZ-053](BAZ-053-remove-expo-mobile-app.md)).
