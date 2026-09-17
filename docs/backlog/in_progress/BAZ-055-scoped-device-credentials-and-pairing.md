---
id: BAZ-055
title: Scoped device credentials and one-paste pairing (OpenClaw's authz model, adapted)
status: in_progress
size: L (1-2 weeks, sequenced as M + S + S)
created: 2026-09-17
refined: 2026-09-17
priority: high
note: Refined 2026-09-17 with the completed OpenClaw + Hermes findings (design/authn-authz-comparison-openclaw-hermes.md). The scopes migration is deliberately the first 0002_*.sql — the production shakedown of the BAZ-047 contract.
---

# BAZ-055 - Scoped device credentials and one-paste pairing (OpenClaw's authz model, adapted)

## User stories

- **As the operator**, I want a device credential that can only read (a wall-tablet
  dashboard, a work phone), so a lost or borrowed device cannot mutate anything.
- **As the operator**, I want an approvals-only credential for the device I keep
  notifications on, so I can resolve agent requests from my pocket without granting
  full access.
- **As the operator pairing a new device**, I want to paste or scan one short setup
  code instead of copying a long-lived token, so onboarding is a 10-second, expiring,
  single-use exchange.
- **As the operator debugging a client that won't connect**, I want a public posture
  probe that says whether the auth gate is engaged and which credential kinds are
  accepted, so "is it the server or my token?" is answerable in one request.

## Goal

Add OpenClaw's proven authorization model to Bazilion's existing device-credential
foundation — per-device scopes with route-level enforcement, a one-paste pairing flow,
and Hermes' introspectable auth posture — without changing the single-operator model,
the gateway, or any authn semantics (BAZ-028).

## Why

The [auth comparison](../design/authn-authz-comparison-openclaw-hermes.md) established:
Bazilion's *authentication* is at parity (named, expiring, revocable device records;
fail-closed ingress), but *authorization* is all-or-nothing — `middleware-auth.ts`
checks identity, not capability. OpenClaw's per-device operator scopes and setup-code
pairing solve exactly this; Hermes' dashboard/desktop layer contributes the posture-
introspection pattern (their #1 support report was "ready but the client can't
connect", which posture probing eliminates). Adopting beats reinventing: the mapping
to Bazilion's route map is nearly mechanical, and both reference implementations are
public.

## Scope — three sequenced slices

### Slice 1 (M): scopes on device credentials + enforcement

**The scopes.** Four, adapted to Bazilion's route map:

| Scope | Gates |
|---|---|
| `read` | GET-only surfaces: agents/teams/templates/profiles/skills/triggers listings and detail, conversations, messages history, results library, activity, attention/queue *views* |
| `write` | Mutations on the above: send chat, create/move/archive agents and teams, edit templates and policies, follow-ups, coding flows (review conclusions, verification requests, **publication** — an operator-initiated mutation with remote side effects) |
| `approvals` | Resolving gates: `/api/approvals`, `/api/shell-approvals`, queue-item resolution, answering structured questions (BAZ-037), acknowledging Attention items |
| `admin` | Configuration surfaces: `/api/config` (reads *and* writes — config is operator-only), Telegram integration routes, MCP servers, `/api/backup*`, `/api/tokens*` (minting/revoking credentials), `/api/auth/openai*`, `/api/providers/test`, communication policy changes |

**Explicit scope decisions** (each is a line in the fixture table, contestable but
decided): config *reads* require `admin`, not `read` — config surfaces never appear
on companion devices; Attention *acknowledge* requires `approvals` even though it is
semantically lightweight — one rule for the whole queue; publication requires `write`
because it is operator-initiated, distinct from `approvals` which resolves
agent-initiated gates.

**Storage + migration.** `web_tokens` gains a `scopes` column via
**`0002_device_token_scopes.sql` — the first forward migration after BAZ-047**,
deliberately: it exercises the new contract end-to-end (in-place upgrade, prefix
ledger, pre-migration snapshot, CI upgrade matrix lights up its data-preservation
assertions). The migration backfills all existing device tokens with the full scope
set; the bootstrap token implicitly holds all scopes and needs no row change.
Existing deployments see zero behavior change.

**Enforcement.** In `middleware-auth.ts`, immediately after authentication: a
scope→route-prefix/method table consulted before `next()`. Denied requests return a
structured 403 naming the missing scope. The table lives in one module and doubles as
the test fixture — route-level tests are generated from it, so adding a route without
a scope decision fails the build.

**Mint/inventory UX.** Token minting (web + CLI) gains scope selection with the full
set as default; the token inventory shows each device's scopes; revocation unchanged.
Hermes' unattended-deny principle applies unchanged: nothing here alters
non-interactive turn behavior (BAZ-006).

### Slice 2 (S): one-paste pairing setup codes

- `bazilion-pair://<code>` carrying: gateway origin, a short-lived (10-minute)
  single-use pairing token, and the gateway TLS certificate fingerprint (the private
  gateway already serves a pinnable leaf — BAZ-028).
- Minted from the web tokens page and CLI ("pair a device"); rendered as copyable
  text *and* QR for the future native apps (BAZ-054). The exchange admits exactly one
  credential mint, which creates a durable scoped device credential with scopes
  chosen at mint time. Pairing token ≠ device credential — the short-lived key that
  admits a durable identity, per OpenClaw's phrasing.
- No new auth surface: the pairing token is a new `web_tokens` kind, gated by
  `admin`, revocable, and inert after use.

### Slice 3 (S): auth-posture introspection (Hermes)

- The public health surface reports posture booleans: gate engaged, credential kinds
  accepted (bootstrap/device), setup-gate state. No secrets, no user data.
- Purpose: kill the "server is up but the client can't connect" support class before
  multiple client kinds exist.

## Out of scope

- **Capability-approval lifecycle** (OpenClaw's second pairing layer: devices declare
  a surface, expansions create persistent pending requests) — moves with BAZ-054,
  because a declaring client only exists once native apps do.
- **Trusted-proxy auth mode** — rejected in the comparison: exists for shared/K8s
  deployments; Bazilion is single-operator, Tailscale-first. Revisit only if
  multi-operator becomes real.
- **Published protocol/client packages** — with BAZ-054.
- Multi-operator accounts, user identity mapping, any change to secret encryption or
  bootstrap semantics.

## Tests

1. Generated from the fixture table: every route × every scope — a `read` token
   gets structured 403 on all mutations and succeeds on all reads; an
   `approvals`-scoped token resolves queue items and questions but cannot send chat
   or touch config; `admin` reaches config/tokens/backups.
2. Bootstrap token passes all routes; pre-migration device tokens pass all routes
   after backfill — **no operator-visible behavior change on upgrade** (asserted by
   the upgrade matrix once this lands: the v0.20.0 entry gains a live forward
   migration).
3. Setup code: expires at 10 minutes, single-use (second exchange fails), refuses a
   certificate-fingerprint mismatch, inert after use, `admin`-gated to mint.
4. Posture endpoint: correct booleans for loopback, gateway, and
   gate-off-but-should-be-on homes.
5. The BAZ-032 security gate still passes — scope denial must not leak token
   existence or scope values in error bodies.

## Progress

**Slice 1 — done on `feat/scoped-device-credentials` (PR A):**

- `0002_device_token_scopes.sql` — the first forward migration after BAZ-047: adds
  `web_tokens.scopes` with a behavior-preserving `DEFAULT 'read write approvals admin'`
  backfill. The upgrade matrix now exercises a real forward migration.
- Scope→route table in `apps/daemon/src/lib/scopes.ts` (`requiredScope`/`scopeAllows`):
  admin carve-outs (config/MCP/backup/tokens/auth-openai/providers/communication — all
  methods), approvals carve-outs (approvals/shell-approvals/notifications mutations,
  queue resolution, question answers, attention acknowledgement), read/write defaults.
  Bootstrap holds all scopes implicitly; session cookies inherit the device token's
  scopes; enforcement in `middleware-auth.ts` returns structured 403s with
  `code: 'insufficient_scope'` and the required scope named.
- Minting: `POST /api/tokens` accepts an optional `scopes` subset (absent = all —
  zero behavior change); web tokens page gains a scope checkbox group and a scopes
  column; CLI `token create --scope` (repeatable) and `token list` show scopes.
- **Backup validator migrated off the hard-coded contract** — `backup-schema.ts` had
  its own copy of the schema contract (exact single-migration ledger assertion + a
  frozen schema fingerprint), which broke on the first new migration — precisely the
  failure mode BAZ-047 predicted. It now delegates to
  `assertSchemaMatchesCanonicalChain` (daemon `migrate.ts`): ledger must equal the
  full chain, schema objects diff per-object against the canonical replay (missing /
  unexpected / altered SQL each get actionable errors), result-blob verification
  unchanged.
- Tests: 50 exhaustive `requiredScope` unit cases over the table + 7 HTTP cases
  (bootstrap full access, read-only, approvals-only, admin-only, mint validation,
  session-scope inheritance, 401 unchanged). Full suite 1,843 passed / 0 failed.

**Slices 2 (pairing codes) and 3 (posture probe) — next, as PR B.**
