# Authn/authz comparison: OpenClaw and Hermes clients

*Researched 2026-09-17 from public sources, following the storage comparison (same repo, same method). Question: how do the two reference projects authenticate and authorize their clients — web, CLI, companion/mobile, desktop — and what should Bazilion adopt instead of reinventing?*

## Bazilion today (the baseline being compared)

- **Authn:** single `auth.json` bootstrap bearer (also the PBKDF2 seed for secret
  encryption) + named, expiring, revocable **device credentials** per browser/phone;
  hashed browser sessions with cookie exchange; loopback-only Tailscale Serve
  preflight on the private gateway (BAZ-028). Telegram ingress is fail-closed
  single-owner pairing (BAZ-029).
- **Authz:** none beyond the first-run/setup gate — every authenticated principal
  (bootstrap or device token) can reach everything. Verified in
  `middleware-auth.ts`: `PUBLIC_PATHS` + `SETUP_OPEN_PREFIXES`, then pass-through.

## OpenClaw: per-device identity, scoped operators, two-layer pairing

Sources: `docs/gateway/authentication.md`, `docs/gateway/trusted-proxy-auth.md`,
`docs/gateway/pairing.md`, `docs/gateway/clients.md`.

### 1. Every client is a device record with its own identity

Dashboards, CLI instances, and companion nodes are all "devices" stored in the
gateway's SQLite state DB. A device pairs once and holds a durable device token
**plus a signing identity** (key-pair; signing is host-owned, browser hosts get
signing callbacks). Device tokens are distinct from bootstrap tokens by design —
their analogy: "a short-lived Tailscale auth key and the durable device identity it
admits."

### 2. Scoped operator authorization (the core adoptable idea)

Client capabilities are granted as **scopes per device**, with method-level rules in
a published scopes reference:

| Scope | Gates |
|---|---|
| `operator.read` | history, session lists/subscriptions, read-only events |
| `operator.write` | sending chat, ordinary session mutations |
| `operator.approvals` | listing/displaying/resolving approvals |
| `operator.questions` | interactive question flows |
| `operator.pairing` | managing paired devices/nodes |
| `operator.admin` | config patches, administrative operations |

A full chat+approval client requests `read + write + approvals`; a read-only
companion requests `read` only. This is what makes "a device that can only approve
or only watch" expressible without new code paths.

### 3. Two-layer pairing: connection ≠ capability

For companion devices ("nodes") there are two independent gates:

- **Device pairing** gates the connection handshake (pairing requests expire in
  5 minutes; trusted-CIDR auto-approval is available for trusted networks).
- **Capability approval** gates *what the node may do*: the node **declares** its
  command/capability surface on connect; anything new or widened stores a **pending
  request** for operator approval (CLI or UI). Until approved: **"An initial
  unapproved surface has no effective commands."** Pending requests persist
  indefinitely (no timeout), survive restarts, and are superseded (not accumulated)
  when the declared surface changes.

### 4. One-paste setup-code pairing (the onboarding UX worth copying)

```
openclaw node run --pair "oc-pair://<setup-code>"
```

The setup code carries: gateway endpoint + a **short-lived (10 min), single-use
bootstrap token** + a **TLS certificate pin** (when the gateway serves a pinnable
leaf). The bootstrap token admits the device exactly once; the device then mints its
own durable credential. Bootstrap token ≠ device credential.

### 5. Trusted-proxy auth mode (optional, deliberately scary-sounding)

For identity-aware proxies (Pomerium/Caddy/nginx+oauth2-proxy): the proxy
authenticates, passes `x-forwarded-user`; the gateway verifies the source IP against
`trustedProxies`, requires explicit `allowLoopback` opt-in for same-host proxies,
checks optional `allowUsers`, and maps identities to scopes. Documented with a
prominent "misconfiguration can expose your gateway" warning. Their default personal
setup stays Tailscale Serve + loopback — same as Bazilion's.

### 6. Versioned wire protocol as a published package

Third-party clients build against `@openclaw/gateway-protocol` (schemas, validators,
device-identity/capability registries, protocol version constants) and
`@openclaw/gateway-client` (reference connection implementation), pinned exactly,
with documented wire-version rules.

## Hermes: deliberately thin client authz, strong unattended-surface defaults

Sources: `website/docs/user-guide/features/api-server.md`,
`website/docs/user-guide/security.md`.

- **Client authn is one static bearer key** (`API_SERVER_KEY`) on the
  OpenAI-compatible API server, localhost-bound by default, optional CORS. No
  per-device identity, no scopes — Hermes is effectively single-user, and its client
  story is "any OpenAI-compatible frontend."
- The eight-layer security model is about *agent* security (command approval, file
  safety, container isolation, MCP env filtering, context scanning, session
  isolation, input sanitization) and *messaging ingress* authorization (allowlists,
  DM pairing) — not operator-client authz.
- **The adoptable bit — deny-by-default for unattended surfaces:** approval behavior
  is configurable per context (`cron_mode`, `single_query_mode`, `unattended_mode`),
  and all unattended contexts **default to `deny`** — an unattended surface that
  hits a dangerous command blocks instantly instead of waiting out an approval
  timeout. Clean, explicit treatment of "no human is here to answer."

## Verdict

| Aspect | OpenClaw | Hermes | Bazilion today |
|---|---|---|---|
| Client identity | Per-device record + signing keys | None (one shared key) | Named device credentials, no signing |
| Authorization | Scoped per device (method-level) | None | All-or-nothing |
| Companion pairing | Two layers (connect / capability), pending-approval lifecycle | — | Token mint + show-once |
| Onboarding UX | One-paste setup code, 10-min single-use token, TLS pin | — | Manual token copy, shown once |
| Unattended defaults | Per-surface command policy | Deny-by-default per context | Fail-closed non-interactive turns (BAZ-006) |
| Personal-network path | Tailscale + loopback | localhost default | Tailscale + loopback (BAZ-028) |

Bazilion's foundation (device records, revocation, fail-closed ingress) is at parity
with OpenClaw's *pairing* layer. What's missing is the **authorization** layer — and
OpenClaw's design shows exactly how to add it without breaking the single-operator
model.

## What Bazilion should adopt (→ BAZ-055)

1. **Scopes on device credentials** (high value, low cost). Add a `scopes` column to
   device tokens with an operator scope set mapped to route groups: `read`, `write`,
   `approvals`, `questions`, `admin` (Bazilion needs no `pairing` scope while
   single-owner). Enforced in `middleware-auth.ts` per path prefix; bootstrap token
   keeps implicit `admin`. Existing device tokens migrate to full scopes — zero
   behavior change on upgrade, but "read-only phone" or "approvals-only tablet"
   becomes possible immediately.
2. **One-paste pairing setup code** (needed by BAZ-054, harmless before it).
   `bazilion-pair://` code carrying endpoint + 10-minute single-use bootstrap token +
   gateway TLS cert pin (the gateway already serves a private leaf certificate it can
   pin). Native app scans/pastes once, exchanges for a durable scoped device
   credential. The show-once property Bazilion already has, made paste-able.
3. **Capability-approval lifecycle** (with BAZ-054, not before): a device declares
   the scope surface it wants; grants beyond the minted scope create a persistent
   pending request the operator approves in the web UI. "Initial unapproved surface
   has no effective commands" is the invariant to copy verbatim.
4. **Unattended deny-by-default** — Bazilion already fails closed on non-interactive
   turns (BAZ-006); worth an audit line in BAZ-051 rather than new work.
5. **Trusted-proxy mode** — not adopted. It exists for shared/Kubernetes-style
   deployments; Bazilion's single-operator, Tailscale-first stance makes it scope
   creep. Revisit only if multi-operator becomes real.
6. **Published protocol package** — with BAZ-054, not before.
