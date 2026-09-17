---
id: BAZ-055
title: Scoped device credentials and one-paste pairing (OpenClaw's authz model, adapted)
status: draft
size: L (1-2 weeks, as one slice — scope-1 alone is M)
created: 2026-09-17
priority: medium
note: Adopts OpenClaw's per-device scopes and setup-code pairing, adapted to single-operator Bazilion. Grounded in design/authn-authz-comparison-openclaw-hermes.md. Part 3 (capability-approval lifecycle) deliberately moves with BAZ-054.
---

# BAZ-055 - Scoped device credentials and one-paste pairing (OpenClaw's authz model, adapted)

## User stories

- **As the operator**, I want a device credential that can only read (a wall-tablet
  dashboard, a work phone), so a lost or borrowed device cannot mutate anything.
- **As the operator**, I want an approvals-only credential for the device I keep
  notifications on, so I can resolve agent questions from my pocket without granting
  full access.
- **As a future native-app operator**, I want to pair a new device by pasting or
  scanning one short setup code instead of copying a long-lived token, so onboarding
  a device is a 10-second, expiring, single-use exchange.

## Goal

Add OpenClaw's two proven authorization ideas to Bazilion's existing device-credential
model — per-device scopes with route-level enforcement, and a one-paste setup-code
pairing flow — without changing the single-operator model, the gateway, or the authn
foundations (BAZ-028).

## Why

The [auth comparison](authn-authz-comparison-openclaw-hermes.md) found Bazilion's
*authentication* at parity with OpenClaw (named, expiring, revocable device records;
fail-closed ingress) but its *authorization* all-or-nothing: any authenticated
principal reaches every route (`middleware-auth.ts` has no scope concept). OpenClaw
solves this with per-device operator scopes (`operator.read/write/approvals/
questions/admin`) enforced at method level, plus a setup-code pairing flow carrying a
10-minute single-use bootstrap token and a TLS certificate pin. Hermes, by contrast,
has no client authz at all — and its one good idea (deny-by-default for unattended
surfaces) is already Bazilion's shipped behavior (BAZ-006). Copying OpenClaw's model
is the don't-reinvent-the-wheel move; the mapping is nearly mechanical.

## Scope

### 1. Scopes on device credentials (the core; M on its own)

- Scope set adapted to Bazilion's route map: `read` (GET-only surfaces: dashboards,
  libraries, activity, results), `write` (conversations, agents, teams mutations),
  `approvals` (approval/queue resolution, structured questions), `admin` (config,
  tokens/credentials, backups, provider changes).
- `web_tokens` gains a scopes column; **bootstrap token implicitly holds all
  scopes** (single-owner unchanged). Existing device tokens migrate to the full set —
  zero behavior change on upgrade, satisfying the BAZ-047 no-wipe contract.
- Enforcement in `middleware-auth.ts` as a scope→path-prefix/method table, the same
  place the setup gate lives. Denied responses are structured (403 with required
  scope named), not bare.
- Token mint UI/CLI gains scope selection; token inventory shows each device's
  scopes; revocation unchanged.

### 2. One-paste pairing setup code (S)

- `bazilion-pair://<code>` carrying: gateway origin, a short-lived (10-minute)
  single-use pairing token, and the gateway TLS certificate fingerprint (the
  private gateway already serves a pinnable leaf — BAZ-028).
- Minting via CLI/web ("pair a device" flow); the code admits exactly one
  credential exchange, which creates a durable scoped device credential. Pairing
  token ≠ device credential, one-shot, expiring — the properties are already the
  product's stance, made paste-able/QR-able.

### 2b. Auth-posture introspection (S, from Hermes)

- The public health surface (`/api/health` or a sibling status endpoint) reports
  whether the auth gate is engaged and which credential kinds are accepted — the
  Hermes pattern that kills the "server is up but the client can't connect" support
  class. No secrets, no user data: just posture booleans.

### 3. Capability-approval lifecycle (with BAZ-054, not here)

- A paired device *declares* the scope surface it wants; requests beyond the minted
  scopes become persistent pending requests approved in the web UI. Adopt OpenClaw's
  invariant verbatim: **an initial unapproved surface has no effective commands.**
  Held out of this story because a declaring client only exists once native apps do.

## Out of scope

- Trusted-proxy auth mode (rejected in the comparison: exists for shared/K8s-style
  deployments; Bazilion is single-operator, Tailscale-first).
- Multi-operator accounts or user identity mapping.
- Published protocol/client packages (with BAZ-054).
- Any change to secret encryption or bootstrap semantics.

## Tests

1. A `read`-scoped token gets 403 (with required scope named) on every mutating
   route, and succeeds on every read route.
2. An `approvals`-scoped token resolves queue items and questions but cannot send
   chat or touch config.
3. Bootstrap token passes all routes; existing device tokens (pre-migration) pass
   all routes after the scopes backfill — no operator-visible behavior change.
4. A setup code expires after 10 minutes, is single-use (second exchange fails),
   and refuses a certificate-fingerprint mismatch.
5. Scope enforcement is covered by route-level tests generated from the
   scope→route table itself (the table is the test fixture, so adding a route
   without a scope decision fails the build).
6. The posture endpoint reports gate state correctly for loopback, gateway, and
   misconfigured (gate-off-but-should-be-on) homes.
