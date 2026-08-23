---
id: BAZ-028
title: Secure personal web and mobile gateway
status: draft
size: L
created: 2026-08-23
priority: high
note: Single-operator private deployment; expose the web gateway only and keep the daemon loopback-only.
---

# BAZ-028 — Secure personal web and mobile gateway

## User stories

- **As Bazilion's only operator**, I want the complete web UI available from my own devices over a
  private encrypted network, so I can administer Agents away from the server without publishing an
  admin API to the internet.
- **As a browser user**, I want login to exchange my long-lived device credential for a short-lived,
  revocable server session, so the bootstrap bearer is not retained in a browser cookie.
- **As the owner of several devices**, I want one credential per laptop or phone with last-use,
  expiry, and independent revocation, so losing one device does not force me to rebuild the server.
- **As a future native-mobile user**, I want pairing and credential validation to target the same
  private web gateway as the browser, so the mobile app never needs direct network access to the
  daemon.
- **As an operator deploying on a small online server**, I want startup and health checks to fail
  loudly when the daemon or gateway has an unsafe exposure posture, so a configuration mistake is
  visible before I rely on Telegram or remote access.

## Goal

Provide one supported single-user remote-access topology that retains the complete web UI and
leaves room for the native mobile app:

```text
operator browser ─┐
                  ├─ private tailnet HTTPS ─> web gateway on loopback ─> daemon on loopback
future mobile app ┘                                      │                    │
                                                        │                    ├─> OpenAI
                                                        │                    └─> Telegram Bot API
                                                        └─ same-origin UI and /api proxy
```

Only the web origin is published to the private tailnet. The daemon remains bound to
`127.0.0.1`, and `/api/*` continues through the web application's same-origin reverse proxy.
Tailscale Serve is the reference private-HTTPS deployment; Tailscale Funnel and a publicly
reachable reverse proxy are explicitly unsupported by this story.

This is authentication for one person with several devices, not an account or authorization
system for multiple people. Every accepted device credential and browser session represents the
same owner and has the same authority.

## Why

The current browser login stores the submitted long-lived token directly in the `bz_token`
cookie. The cookie is `HttpOnly`, but it is neither a bounded server-side session nor independently
revocable from its source token. The mobile and remote-CLI pairing checks also call the public
`/api/health` endpoint, so a successful response proves reachability rather than proving that the
supplied credential is valid.

The public health response currently contains installation and runtime details useful to the
operator. That information should not be the unauthenticated liveness contract on a remotely
reachable gateway. Cookie-authenticated mutations also need an explicit browser-origin and CSRF
boundary at the web gateway before it rewrites requests for the loopback daemon.

## Product and architecture decisions

- **Web is the gateway:** remote browser, mobile, and optional remote CLI traffic uses the private
  HTTPS web origin. No remote client is instructed to connect to daemon port 4321.
- **Daemon ownership remains canonical:** the daemon owns device credentials, browser sessions,
  their hashes and revocation state, and all authentication decisions. The web server proxies; it
  does not grow a second auth database.
- **The bootstrap token stays local:** the non-revocable `bootstrap` row and plaintext in
  `auth.json` remain the daemon's PBKDF2 seed and local CLI credential. Normal browser and mobile
  setup mints a separate device credential instead of copying the bootstrap token to a device.
- **Sessions, not bearer cookies:** browser login accepts a device credential once and returns an
  opaque session secret. Only its hash is stored by the daemon. The browser cookie contains the
  session secret, never the source device or bootstrap bearer.
- **Bearer auth remains for native clients:** CLI and mobile continue to use
  `@bazilion/client` with one device credential held in their existing platform-appropriate store.
  They do not receive a browser cookie or share one device credential with each other.
- **No roles or scopes:** all authenticated principals are the one operator. Credential kind,
  expiry, revocation, and provenance limit credential lifetime and aid recovery; they do not form
  an RBAC model.
- **Exact private origin:** one configured external HTTPS origin is canonical for production. The
  gateway validates the incoming `Host` and browser `Origin` before proxying and then performs the
  existing internal origin rewrite for the daemon.
- **Isolated hosted turns:** the personal-server profile depends on BAZ-027 and refuses readiness
  unless every normal Agent turn, including authenticated web/API chat, receives BAZ-027's
  credential-minimal worker boundary and mandatory Docker coding surface.
- **Clean-install schema:** any schema work edits
  `apps/daemon/src/core/db/migrations/0001_init.sql`; no compatibility migration or legacy cookie
  adapter is added during the alpha clean-install contract.

## Credential and session model

Extend the canonical `web_tokens` contract for device credentials with:

- an explicit immutable kind (`bootstrap` or `device`) rather than inferring bootstrap behavior
  from a mutable label;
- optional `expires_at` and existing created, last-used, and revoked timestamps;
- a human-readable device label, with plaintext still shown only once;
- active lookup that rejects expired and revoked credentials before updating last use.

Add daemon-owned `web_sessions` containing only server-side session metadata:

- random session id and a hash of a separately generated high-entropy session secret;
- source device-token id;
- created, last-seen, absolute-expiry, idle-expiry, and revoked timestamps;
- no copied bearer, bootstrap token, device secret, user profile, role, or scope.

Revoking or expiring a device credential invalidates all sessions derived from it. Logout revokes
the current session only. Session rotation replaces the cookie secret without extending the
absolute lifetime. Expired and revoked rows may be retained for bounded diagnostics until a later
explicit prune policy is chosen.

The production browser cookie uses a host-only name such as `__Host-bz_session` with `Path=/`, no
`Domain`, `HttpOnly`, `Secure`, and `SameSite=Strict`. Login, logout, expiry, and session rotation
must produce explicit browser behavior rather than silently falling back to the long-lived bearer.

## HTTP and wire contract

Add canonical API types in `@bazilion/api-types` for device-token metadata, session metadata, the
authenticated-owner response, and typed login/logout errors.

Authentication surfaces:

- `POST /api/login` validates a bootstrap/device bearer supplied in the request body, creates a
  bounded browser session, and sets the session cookie. It never reflects or persists the bearer
  in the response or cookie.
- `POST /api/logout` revokes the current browser session and expires its cookie.
- `GET /api/auth/whoami` is protected and returns bounded credential/session metadata. Mobile and
  CLI use this endpoint to prove that their supplied bearer was authenticated.
- Existing token create/list/revoke endpoints expose kind, optional expiry, last use, and active
  state. Token revocation cascades logically to derived sessions.
- Browser-session list/revoke endpoints are available to the authenticated owner so a lost browser
  can be signed out without revoking unrelated devices.

Health surfaces:

- `GET /api/health` becomes a minimal unauthenticated liveness response without filesystem paths,
  entity counts, provider state, policy state, token counts, or configuration diagnostics.
- Detailed installation and runtime health moves behind authentication under one canonical route.
  The web diagnostics and `bazilion doctor` consume that protected contract.
- No client treats public liveness as authentication evidence.

The daemon authentication middleware recognizes a hashed active device bearer or an active browser
session and attaches bounded principal metadata for downstream audit context. It preserves the
existing first-run gate; setup-open endpoints must be reviewed individually rather than retaining a
broad prefix exemption by accident.

## Web gateway hardening

- Keep the web and daemon listeners on loopback in the reference server profile. Publish only the
  web listener with private HTTPS through Tailscale Serve.
- Reject unexpected `Host`, `Origin`, and forwarded-host/protocol combinations before proxying.
  Never trust Tailscale identity headers from a listener reachable outside loopback.
- Require an exact configured browser origin plus a session-bound CSRF value for cookie-authenticated
  unsafe methods. Bearer-authenticated CLI/mobile requests are not converted into cookie auth and
  do not use the browser CSRF mechanism.
- Strip untrusted forwarding and hop-by-hop headers, set the daemon target internally, and preserve
  streaming chat and approved upload paths with explicit request-size limits.
- Send a production security-header baseline: HSTS on the HTTPS origin, CSP, `frame-ancestors
  'none'`, `X-Content-Type-Options: nosniff`, a restrictive referrer policy, and an explicit
  permissions policy. The CSP must retain only resources the current web UI actually needs.
- Return generic unauthenticated errors and redact secrets, token material, internal paths, and
  detailed failures from gateway logs.
- Add a deployment preflight that reports the daemon bind address, web bind address, canonical
  origin, HTTPS status, cookie mode, and whether the configured Tailscale route is private Serve
  rather than Funnel. Unsafe posture fails closed in the production server profile.

## CLI and web parity

- Extend `bazilion token create|list|revoke` for device kind, expiry, last use, and session
  invalidation. Human output never prints a token after its one-time creation response; JSON uses
  the canonical wire envelope.
- Add CLI session list/revoke/logout diagnostics matching the web Config security surface.
- Update remote `bazilion login` to validate against the protected owner endpoint, not public
  health, while preserving the Node-local `auth.json` helper boundary.
- Add a web security page/card for device credentials and browser sessions, including current
  session, created/last-used/expires state, and independent revocation with clear confirmation.
- Keep the non-revocable bootstrap credential identifiable but do not offer it as the normal QR or
  browser-pairing credential.

## Mobile foundation

- Pairing URLs continue to contain a separately minted device credential and the private HTTPS web
  origin; they never point at the loopback daemon or carry the bootstrap token.
- `verifyCredentials()` calls the protected owner endpoint and treats 401, expiry, revocation,
  wrong origin, and network failure as distinct user-facing states.
- Device credentials remain in Expo SecureStore. A 401 clears or quarantines the rejected
  credential and returns to pairing without erasing unrelated application state.
- No additional native screens beyond the authentication, pairing, expiry, and revocation behavior
  required to establish this gateway contract are part of this story.

## Reference private deployment

Document and verify one reproducible small-server setup:

1. Run Bazilion as a dedicated unprivileged OS user.
2. Bind the daemon and web application to loopback on separate ports.
3. Join the server and operator devices to one tailnet.
4. Use Tailscale Serve to publish the loopback web listener over tailnet-only HTTPS.
5. Confirm that no Bazilion port is listening on a public or LAN interface and that Funnel is not
   enabled for the Bazilion origin.
6. Mint one named device credential locally, use it for the first browser login or mobile pairing,
   and verify login/logout/revocation remotely.

Deployment support must not edit the operator's tailnet policy or replace an existing Serve
configuration without an explicit command and confirmation. A read-only inspection and exact
copy/paste commands are sufficient for the first slice if safe automatic reconciliation is not.

## Scope

- Daemon-owned device-token expiry/kind and revocable browser-session persistence.
- Browser login exchange, logout, session expiry/rotation, and session/device management.
- Protected owner-identity and detailed-health contracts; minimal public liveness.
- Exact Host/Origin validation, browser CSRF protection, secure cookies, security headers, header
  sanitization, and bounded request bodies at the web gateway.
- Loopback-only daemon enforcement and a supported Tailscale Serve reference deployment.
- CLI and web management parity for every new auth endpoint.
- Mobile pairing/verification changes needed to consume the protected gateway correctly.
- Backup/restore schema inventory updates required for the new auth tables and columns; sessions
  themselves may be deliberately excluded if the chosen restore policy revokes them all.

## Out of scope

- Multiple users, invitations, organizations, roles, permissions, RBAC, or per-route token scopes.
- A public SaaS control plane, Tailscale Funnel, public reverse-proxy deployment, or exposing the
  daemon directly on a LAN/tailnet/public interface.
- Password accounts, email login, social login, passkeys, MFA, OIDC, SSO, or Tailscale identity as
  a replacement for Bazilion authentication.
- Sharing a Bazilion installation with another human, guest access, or delegated administration.
- General VPN installation, tailnet account/policy management, or automatic firewall ownership.
- Agent-worker credential isolation and unattended shell sandboxing (BAZ-027).
- Telegram owner pairing and sender authorization (BAZ-029).
- Backup encryption and credential-rotation recovery (BAZ-030).
- Full native-mobile feature parity, push notifications, or mobile product work unrelated to auth.
- Stable-schema migration compatibility while Bazilion retains its alpha clean-install contract.

## Acceptance tests

- A browser login with an active device credential returns a host-only secure session cookie; the
  source bearer is absent from the cookie, response, session row, and logs.
- Browser sessions are stored only by hash, obey idle and absolute expiry, rotate safely, and are
  invalid immediately after logout, explicit session revocation, source-device revocation, or
  source-device expiry.
- The bootstrap credential remains paired with `auth.json`, non-revocable, and usable locally, but
  normal device/QR creation never returns it.
- Device list/create/revoke and browser session list/revoke have matching authenticated HTTP, CLI,
  and web coverage, including concurrent tabs and stale revocation attempts.
- Cookie-authenticated POST/PUT/PATCH/DELETE requests with a missing/mismatched Origin or CSRF value
  fail before proxying. Exact-origin browser requests succeed. Valid mobile/CLI bearers continue to
  work without the browser CSRF mechanism.
- Unexpected Host and forwarded headers are rejected or stripped. The daemon observes only the
  gateway's internal target and bounded principal context, never client-supplied identity headers.
- Public health exposes liveness only. Detailed health and `/api/auth/whoami` reject absent,
  expired, and revoked credentials; mobile and remote CLI cannot "verify" an invalid token through
  the public probe.
- Security headers are present on production HTML and API responses without breaking login,
  navigation, markdown rendering, streamed chat, downloads, or supported uploads.
- The production preflight refuses a non-loopback daemon, non-HTTPS canonical origin, insecure
  cookie mode, unexpected public/LAN listener, detected Funnel route, or non-isolated Agent-turn
  posture, with an actionable error.
- From a tailnet device, the web UI and `/api/*` proxy work through private HTTPS while port 4321
  cannot be reached directly. From a non-tailnet network, neither web nor daemon endpoint is
  reachable.
- Backup/restore tests prove the selected device/session persistence policy and never restore an
  active session contrary to that documented policy.
- Root tests/typecheck/lint, web typecheck/build, mobile tests/typecheck, and focused browser tests
  cover login, logout, expiry, CSRF, session/device revocation, and narrow/mobile web layout.

## Delivery slices

1. **Auth correctness:** add device expiry/kind, hashed daemon sessions, protected `whoami`, logout,
   minimal public health, detailed protected health, and repository/HTTP contract tests.
2. **Browser boundary:** exchange login, secure session cookie, Origin/Host/CSRF enforcement,
   proxy sanitization, security headers, session management UI, and browser tests.
3. **Native-client parity:** fix CLI/mobile verification, device creation/list/revocation metadata,
   pairing URLs, expiry handling, and CLI/web parity tests.
4. **Private server profile:** loopback/preflight enforcement, Tailscale Serve guide or helper,
   deployment smoke tests, and recovery documentation.

Each slice must leave the existing local-only workflow usable. The story is complete only when the
remote browser and mobile authentication paths use the web gateway and the daemon has no remotely
reachable listener.

## Open questions

- What are the default browser idle and absolute session lifetimes? Suggested starting point: a
  12-hour idle limit and seven-day absolute limit, with no silent absolute-lifetime extension.
- Should device credentials require expiry, or default to a long but finite lifetime such as 90
  days? The bootstrap credential remains non-expiring because it is also the local encryption seed.
- Should session rotation happen on a fixed interval, after privileged mutations, or only at login?
- Should authenticated detailed health remain `/api/health` with public liveness moved to
  `/api/health/live`, or should the current public path become minimal and details move to a new
  route? Choose one canonical contract before refinement.
- Should browser sessions survive backup/restore, or should restore intentionally revoke all
  sessions while preserving device credentials? Default recommendation: revoke sessions on restore.
- Should the canonical external origin live in Bazilion's config table, a service-manager
  environment value, or a generated server-profile file? There must be one source of truth shared
  by Host, Origin, cookie, QR, and mobile-pairing checks.
- Should remote browser login ever accept the bootstrap credential, or must the initial device
  credential always be minted locally over SSH/TTY? The preferred personal-server posture keeps
  the bootstrap credential local.
- How should secure cookies work during loopback-only HTTP development? The production path must
  fail closed; a clearly marked loopback development exception may use a non-`__Host-` cookie.
- Is the first private-deployment slice documentation plus read-only preflight, or should Bazilion
  also offer an opt-in command that installs a Tailscale Serve rule after showing the exact diff?
- Can preflight reliably distinguish Tailscale Serve from Funnel on every supported platform, or
  must it require operator-supplied evidence plus an external reachability check?
- Which current external web resources are essential enough to retain in the initial CSP, and which
  should be self-hosted before this story moves to `todo`?
