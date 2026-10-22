# Telegram user-story roadmap

These are retained **future user stories**, not implemented capabilities or permission to open
public endpoints. Current behavior is documented in [Telegram integration](telegram.md).
Refine a bounded numbered backlog item before starting any of these changes.

## Streaming replies

As a Telegram user, I want to see an Agent's reply develop rather than wait for a final block.

- Debounced edits must respect outbound queue/rate limits and roll over at Telegram text limits.
- Tool summaries cannot overwrite assistant text. Deletion/edit failure must preserve final content
  without blindly duplicating uncertain sends.
- Decide whether streaming and minimal/verbose mirroring are independent settings; retain CLI/web parity.

## Webhook ingress

As an operator with a separately approved supported ingress, I want push delivery instead of polling.

- This is **not currently supported**. The daemon and normal private gateway remain loopback/private;
  Tailscale Funnel or public daemon exposure is not an implementation shortcut.
- Refine the deployment/security boundary first: request authentication, bounded bodies, rate limits,
  replay handling and an explicit polling/webhook lifecycle. Never silently change modes on failure.
- Require actual authorized ingress evidence before claiming hosted compatibility.

## Direct-message Agent chat

As a paired owner, I want to choose an Agent in a DM without navigating the forum supergroup.

- Existing service-topic owner pairing is not DM chat support. Unknown senders remain closed.
- Refine principal binding, selected-Agent state, queue/policy checks, revocation and safe switching.
- Do not copy the old mobile deep-link flow or add a second roster/identity model by assumption.

## Multiple bot identities

As an operator, I want separate personal/work bots routing to explicitly chosen Teams.

- This needs a deliberate account dimension in configuration, secrets, routing, bindings and lifecycle.
- Prevent cross-account callbacks, disclosure and credential substitution; preserve uncertainty
  across restart/restore. One configured bot remains the current supported model.
- Resolve migration, scope and management UX before implementation; this is not a ready-made plan.

## Telegram Mini App

As a user, I want richer management inside Telegram than slash commands and keyboards.

- Decide whether a thin UI or shared web components solve an actual need.
- Define the hosting boundary and Telegram `initData` validation/replay protection separately from
  existing browser session auth. No public exposure or implicit Telegram-to-owner grant.
- Treat as an uncommitted design question, not a current dashboard capability.

## Retained exclusions

Per-trigger silence, per-message suppression markers and per-topic access/mention overrides were
removed at the operator's request; they are not pending implementation. Cross-channel access groups
remain deferred until another concrete channel requires them. Private-forum iOS deep links are a
Telegram client limitation, not a promised bot-side repair.
