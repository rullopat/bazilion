---
id: BAZ-038
title: Opt-in Telegram delivery of existing Attention items
status: draft
size: M
created: 2026-09-07
priority: medium
note: Independent candidate alongside BAZ-034 through BAZ-037; consumes the existing Attention projection.
---

# BAZ-038 — Opt-in Telegram delivery of existing Attention items

## User stories

- **As an operator using Telegram**, I want to hear when a review, approval, or background failure
  needs me, so I do not have to poll the web dashboard.
- **As an operator**, I want quiet hours and deduplicated delivery, so one unresolved item does not
  repeatedly interrupt me.
- **As an operator receiving a notification**, I want a link to the existing decision screen,
  so I can resolve the source with its normal authentication and policy checks.

## Goal

Deliver an optional, bounded notification for an eligible existing Attention item to the configured
paired Telegram destination. Keep Attention's source lifecycle and decision surfaces authoritative.

## Why and current baseline

Verified against Bazilion `13c3a63` (v0.14.2) on 2026-09-07:

- [BAZ-026](../done/BAZ-026-operator-attention-center.md) already supplies the queue, badge, filters,
  and acknowledgement contract, and explicitly deferred outbound notifications.
- The [Attention projection](../../../apps/daemon/src/core/attention.ts) includes pending
  communication approvals and lesson proposals, terminal review/trigger failures, and loop breaks.
  It does not represent every foreground error or successful Agent turn.
- [Telegram outbound pacing](../../../apps/daemon/src/lib/telegram/outbound-queue.ts) and
  [single-owner pairing](../done/BAZ-029-single-owner-telegram-pairing.md) already exist. The
  [Agent mirror](../../../apps/daemon/src/lib/telegram/mirror.ts) already reports some turn errors;
  this story must account for overlap rather than claim Telegram currently reports no failures.

OpenClaw's [2.0 announcement](https://openclaw.ai/blog/openclaw-2-accidentally) describes narrow
monitoring workflows delivering useful notices to Telegram. This is a Bazilion-specific application
of that product idea, not a claim that upstream has the same Attention model.

## Scope

### Settings and selection

- Default off. Enable through authenticated web and CLI management with explicit destination,
  included Attention kinds, quiet hours, and an IANA timezone. Do not create another Telegram bot
  or an arbitrary recipient/address-book feature.
- Require a current owner pairing and valid configured private supergroup/service topic. Surface
  missing pairing, invalid destination, and disabled transport in settings before enablement.
- For first enablement, recommend only newly eligible items; expose an explicit option to include
  currently open items with a count preview. Re-enabling must not replay all historical failures.
- Consume the existing projection/source IDs directly in the daemon. Use only its five current
  kinds and recheck that each source remains eligible just before sending; do not notify for a
  resolved, expired, acknowledged, or deleted source that waited through quiet hours.
- All enabled kinds respect quiet hours in this slice. Release deferred notices at a bounded rate,
  including windows spanning midnight and timezone/DST changes.

### Delivery and recovery

- Maintain narrow delivery receipts keyed by source kind/id and destination identity. Keep attempt
  state, timestamps, bounded diagnostics, and Telegram message ID when known; do not copy approval
  payloads, lessons, transcripts, tool output, or secret data into the receipt.
- Serialize through existing Telegram outbound pacing. Bound retries and account for transport
  rate-limit responses; repeated polling or a clean restart must not resend a confirmed delivery.
- Treat a crash or timeout after a possible Telegram send as uncertain. Telegram sendMessage does
  not provide a sender-controlled idempotency key: do not claim exactly-once external delivery.
  Recommended first behavior: expose uncertainty and require explicit retry, accepting a possible
  duplicate instead of silently retrying an ambiguous send forever.
- Notification delivery does not acknowledge Attention, approve a communication, decide a lesson,
  retry a trigger, or start an Agent turn. Failures appear in notification settings/delivery status
  without generating recursive Attention notifications about themselves.
- Revalidate destination/pairing and applicable shared egress policy at dispatch. Revocation,
  disablement, Team changes, or rebinding must invalidate stale pending destinations. Keep a stable
  original source reference; do not route old notices into an unrelated newly configured chat.
- Resolve how system notices map to existing egress authorization before implementation. Do not
  bypass a denied Agent egress edge by relabelling an Agent reply as an operator notification.

### Message and operator surfaces

- Use short deterministic templates: kind, minimal Agent/Team context where authorized, source
  reference, and a next-action label. Omit raw error strings and pending content from Telegram.
- Escape display names and labels for Telegram formatting. Never include bearer credentials,
  pairing codes, local filesystem paths, secret-bearing URLs, or private payload excerpts.
- Build web links only from the configured approved private HTTPS origin and canonical relative
  resolution path. If no remotely usable origin exists, show concise navigation guidance instead
  of sending a localhost link or a credential-bearing URL.
- Links use the existing browser login and decision endpoints; notification messages contain no
  new approve/reject buttons. Explain that receiving or opening the message does not resolve it.
- Web and CLI expose the same settings and delivery state, including deferred, delivered, failed,
  uncertain, and suppressed notices. A status view is notification metadata, not another inbox.
- Preserve receipts across daemon restart and backup/restore. If schema changes are needed, edit
  `0001_init.sql` and canonical backup validation under the existing clean-install contract.
- Restoring an older backup also restores older receipts, while Telegram retains messages sent
  after that snapshot. Treat restore separately from ordinary restart: notifications resume paused
  for explicit reconciliation/re-enable and do not automatically replay saved pending/unseen items.

## Acceptance criteria

1. With notifications disabled or pairing invalid, no Attention notification is sent.
2. An enabled newly eligible item produces one confirmed notification under normal operation;
   repeated polls and restart do not duplicate it or change the source's decision state.
3. Quiet hours defer sends in the named timezone; a source resolved during the wait is suppressed.
4. Disabling, revoking pairing, rebinding, and applicable policy denial prevent pending sends from
   reaching stale or unauthorized destinations, including a race with outbound pacing.
5. A successful Telegram API receipt is distinguished from an ambiguous timeout. Operators can
   inspect and explicitly retry uncertain delivery without an exactly-once claim.
6. Messages contain only allowed metadata; links resolve through the approved private gateway and
   canonical authentication. No usable remote origin results in readable non-link guidance.
7. Notification transport failure leaves Attention available on web/CLI and creates no retry loop
   of new notifications, Agent turns, communication approvals, or acknowledgements.
8. Settings, quiet hours, inclusion choices, and delivery diagnostics have CLI/web parity.
9. Restore cannot automatically resend notices already delivered after the backup was captured;
   notifications remain paused until the operator chooses how to reconcile potentially stale state.

## Dependencies and sequencing

- Depends on shipped BAZ-026 and BAZ-029, with BAZ-028 supplying optional private gateway links.
- Independent of BAZ-034 through BAZ-037 and of desktop packaging. It can be selected separately
  after destination, authorization, and mirror-overlap decisions are refined.

## Out of scope

Push/email/native desktop notifications, successful-work activity feeds, generic foreground-turn
receipts, a new Attention source, escalation/reminder workflows, direct Telegram approval actions,
multi-user notification preferences, and automatic replay of interrupted Agent work.

## Tests

- Use fake time and a fake Telegram API for deduplication, retry limits, uncertain delivery,
  restart/restore, source resolution races, and pacing; no live messages are needed for unit tests.
- Restore a snapshot from before a confirmed send and verify no replay occurs on startup; exercise
  explicit reconciliation separately from normal restart and ordinary re-enable behavior.
- Cover overnight quiet hours, DST transitions, timezone changes, first enablement, and re-enable.
- Exercise all five existing kinds, missing/deleted relations, acknowledgement, expired approval,
  pairing/destination/policy changes, and transport disablement while a send is queued.
- Verify templates and links cannot leak source content, paths, credentials, or unescaped names;
  test missing private origin and inaccessible source destinations.
- Check web/CLI settings parity and delivery status, including failed and uncertain outcomes.

## Open Questions

- **Destination and authorization:** use the existing service topic for operator notices, or each
  Agent topic? Recommended: one service topic, with explicit mapping to the shared authorization
  model and generic suppression for sources that cannot be safely attributed. Resolve approval
  recursion and policy denial behavior before moving to todo.
- **Overlap with current mirrors:** should a mirrored terminal failure suppress the matching
  Attention notice? Recommended: suppress only with reliable source correlation; document any
  remaining intentional duplication rather than deduplicating unrelated text by similarity.
- **Defaults and retention:** select initial kinds, quiet-hour defaults, and receipt retention.
  Recommended: no quiet window until configured, a preview of kind selection, and retain delivered
  source keys as long as the source could reappear so cleanup cannot trigger accidental resends.
- **Restore reconciliation:** define the re-enable choice when Telegram has newer history than
  the restored receipts. Recommended: retain a restore pause and offer an explicit cutoff for
  future notices; including old open items requires a preview and a possible-duplicate explanation.
