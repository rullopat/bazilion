---
id: BAZ-028
title: Secure personal web and mobile gateway
status: done
size: L
created: 2026-08-23
refined: 2026-08-26
shipped: 2026-08-26
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
  setup mints a separate device credential locally over CLI/SSH instead of copying the bootstrap
  token to a device. Browser login accepts device credentials only, including during first-run.
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
- **One deployment source of truth:** production requires `BAZILION_PUBLIC_ORIGIN` as an exact
  origin (`https` scheme, host, optional port, no path/query/fragment/userinfo). The service manager
  supplies the same value to the web gateway and daemon; authenticated config/QR surfaces report
  that validated value rather than deriving a public address from request headers.
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

- random session id plus a hash of a separately generated 256-bit session secret; the cookie is
  `<id>.<secret>` so lookup is indexed without storing or scanning plaintext;
- source device-token id;
- hash of the independently generated 256-bit CSRF value;
- created, last-seen, absolute-expiry, idle-expiry, and revoked timestamps;
- no copied bearer, bootstrap token, device secret, user profile, role, or scope.

Revoking or expiring a device credential invalidates all sessions derived from it. Logout revokes
the current session only. Device credentials default to 90 days, accept a shorter explicit expiry,
and cannot exceed 365 days; only the bootstrap credential is non-expiring. Expired and revoked rows
may be retained for bounded diagnostics until a later explicit prune policy is chosen.

Browser sessions use a 12-hour idle limit and a seven-day absolute limit. Successful authenticated
activity advances the idle deadline up to, but never beyond, the fixed absolute deadline. The first
release does not rotate a live session secret: login always creates a fresh secret, and logout,
expiry, or revocation requires a new login. This avoids cross-tab races while retaining bounded
credential lifetime.

The production browser cookie uses a host-only name such as `__Host-bz_session` with `Path=/`, no
`Domain`, `HttpOnly`, `Secure`, and `SameSite=Strict`. Login, logout, expiry, and revocation must
produce explicit browser behavior rather than silently falling back to the long-lived bearer.
Cookie-authenticated unsafe requests also carry `X-Bazilion-CSRF`. A separate readable
`__Host-bz_csrf` cookie holds a random per-session value whose hash is stored in `web_sessions`;
the gateway requires an exact cookie/header/hash match before proxying.

## HTTP and wire contract

Add canonical API types in `@bazilion/api-types` for device-token metadata, session metadata, the
authenticated-owner response, and typed login/logout errors.

Authentication surfaces:

- `POST /api/login` validates a device bearer supplied in the request body, creates a
  bounded browser session, and sets the session cookie. It never reflects or persists the bearer
  in the response or cookie. Bootstrap credentials are rejected on this route.
- `POST /api/logout` revokes the current browser session and expires its cookie.
- `GET /api/auth/whoami` is protected and returns bounded credential/session metadata. Mobile and
  CLI use this endpoint to prove that their supplied bearer was authenticated.
- Remove the alpha `/api/auth/me` route; web SSR consumes `/api/auth/whoami` and no compatibility
  alias remains.
- Existing token create/list/revoke endpoints expose kind, optional expiry, last use, and active
  state. Token revocation cascades logically to derived sessions.
- `GET /api/sessions` lists bounded metadata and `DELETE /api/sessions/:id` revokes one browser
  session. A stale/already-revoked id is an explicit conflict, and no endpoint returns a hash or
  secret.

Health surfaces:

- `GET /api/health` becomes a minimal unauthenticated liveness response without filesystem paths,
  entity counts, provider state, policy state, token counts, or configuration diagnostics.
- Detailed installation and runtime health moves behind authentication to
  `GET /api/health/details`.
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
- Self-host the current Google font files before enabling the production CSP. The initial policy is
  same-origin by default, allows the existing `data:` SVG texture for images, permits only the
  framework-required inline style behavior proven by the production build, and has no remote font,
  script, frame, object, or connection origin.
- Return generic unauthenticated errors and redact secrets, token material, internal paths, and
  detailed failures from gateway logs.
- Add a deployment preflight that reports the daemon bind address, web bind address, canonical
  origin, HTTPS status, cookie mode, and whether the configured Tailscale route is private Serve
  rather than Funnel. Unsafe posture fails closed in the production server profile.

Setting `BAZILION_PUBLIC_ORIGIN` activates the strict private-server profile; there is no separate
mode flag that can drift from the security settings. Daemon and web startup validate the origin and
their loopback listeners. `bazilion gateway preflight` performs the remaining read-only listener,
Tailscale Serve/Funnel, secure-cookie, and BAZ-027 protected-turn checks before the deployment is
reported ready.

## CLI and web parity

- Extend `bazilion token create|list|revoke` for device kind, expiry, last use, and session
  invalidation. Human output never prints a token after its one-time creation response; JSON uses
  the canonical wire envelope.
- Add `bazilion session list|revoke` matching the web Config security surface. Browser logout
  remains `POST /api/logout` and has no misleading native-CLI equivalent.
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

Deployment support is read-only in this story: it inspects listeners plus `tailscale serve status
--json`, rejects an observed Funnel/public route or ambiguous state, and prints exact copy/paste
commands. It must not edit tailnet policy, firewall state, or Serve configuration.

## Scope

- Daemon-owned device-token expiry/kind and revocable browser-session persistence.
- Browser login exchange, logout, bounded session expiry, and session/device management.
- Protected owner-identity and detailed-health contracts; minimal public liveness.
- Exact Host/Origin validation, browser CSRF protection, secure cookies, security headers, header
  sanitization, and bounded request bodies at the web gateway.
- Loopback-only daemon enforcement and a supported Tailscale Serve reference deployment.
- CLI and web management parity for every new auth endpoint.
- Mobile pairing/verification changes needed to consume the protected gateway correctly.
- Backup/restore schema inventory updates required for the new auth tables and columns. Device
  credentials are preserved; every browser session is revoked during restore before installation.

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
- Browser sessions are stored only by hash, obey idle and absolute expiry, and are
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

## Refined implementation decisions

- Browser sessions have a 12-hour idle lifetime and immutable seven-day absolute lifetime. There is
  no mid-session secret rotation in the first release; every login mints a fresh session.
- Device credentials default to 90 days and have a 365-day maximum. The bootstrap remains the only
  non-expiring credential because it is also the local secrets-encryption seed.
- Public `GET /api/health` is liveness-only. Authenticated operational diagnostics live at the new
  canonical `GET /api/health/details`; `GET /api/auth/whoami` is the credential proof endpoint.
- Restore preserves active device credentials but revokes all browser sessions before installing
  the restored home.
- `BAZILION_PUBLIC_ORIGIN` is the production source of truth shared by daemon and web gateway.
  Request and forwarding headers never define it.
- Browser login never accepts the bootstrap token. The operator mints the first named device token
  locally with the CLI before logging in from either a local or remote browser.
- Loopback HTTP development uses `bz_session_dev` and `bz_csrf_dev` without `Secure`, only when both
  listener and request host are loopback and `BAZILION_PUBLIC_ORIGIN` is unset. Production requires
  the `__Host-` secure cookies and has no automatic downgrade.
- Private-deployment support is a read-only preflight plus exact Tailscale Serve commands. Ambiguous
  or unavailable Serve/Funnel evidence fails the production preflight; Bazilion does not mutate
  Tailscale or firewall state.
- The web fonts are self-hosted. Production CSP has no third-party origins and is tightened against
  the built application rather than preserving the current Google Fonts dependency.

## As built

- Added explicit bootstrap/device credential kinds, 90-day default and 365-day maximum device
  expiry, active-state diagnostics, and immediate derived-session invalidation on revocation or
  expiry. The bootstrap remains local, non-expiring, non-revocable, and rejected by browser login.
- Browser login now exchanges a device secret for separately random session and CSRF values. Only
  hashes are persisted; sessions enforce 12-hour idle and seven-day absolute deadlines and support
  logout, list, and independent revocation across HTTP, CLI, and web Config.
- Public health is liveness-only. Protected identity and detailed-health endpoints are canonical,
  and CLI/mobile verification no longer mistakes reachability for authentication.
- `BAZILION_PUBLIC_ORIGIN` activates exact HTTPS Host/Origin checks, production `__Host-` cookies,
  session-bound CSRF, forwarding/hop-header stripping, bounded bodies, response hardening, local
  fonts, and a same-origin CSP. Hosted operator HTTP turns select BAZ-027's protected surface.
- Added exact-origin QR/mobile pairing, read-only listener and Tailscale Serve/Funnel preflight,
  loopback-only startup enforcement, and the reproducible private-gateway guide.
- Backup schema validation includes the session table. Restore preserves device credentials while
  revoking all restored browser sessions; bootstrap rotation revokes devices and sessions.
- Verified 1094 passing tests with 3 intentional skips, root/web/mobile typechecks, lint (existing
  warnings only), and the production web build.
