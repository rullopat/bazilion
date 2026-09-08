---
id: BAZ-038
title: Opt-in Telegram delivery of existing Attention items
status: done
shipped: 2026-09-08
release: v0.15.0
size: M
created: 2026-09-07
refined: 2026-09-07
priority: medium
note: Shipped in v0.15.0 through PRs 44 and 45; includes guided acceptance and UI follow-up.
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

## Refinement inputs (resolved below)

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

## Refined implementation contract (2026-09-07)

- **Destination:** one explicit selection of the existing configured private supergroup's service
  topic. Capture chat/topic, owner grant and bot credential identity; never store the bot token in
  a receipt. Enablement checks the live transport and existing private-group preflight. Revalidate
  captured identity before dispatch and after pacing; configuration changes invalidate pending
  notices instead of moving them to a new destination. No second bot or recipient registry.
- **Authorization:** attribute each source to its canonical current Agent and Team. Missing or
  changed relations suppress the notice. With Team Policy enforcement on, evaluate the existing
  shared Agent-to-user egress path and send only on `allow`. Both `deny` and `approval_required`
  suppress; notification dispatch never captures an approval. This avoids approval-notification
  recursion while respecting Agent egress. Enforcement-off retains identity/destination checks.
  Do not include source payloads or use an operator label to publish a denied Agent reply.
- **Selection:** default disabled, all five existing kinds selected, no quiet window, UTC timezone.
  Enabling or re-enabling normally sets a fresh future-eligibility cutoff. Including existing open
  items requires an explicit count preview and confirmation bound to that preview. New kinds added
  later must not silently replay old history. Use canonical source keys, and retain deduplication
  keys even if a source is acknowledged then reopened. Source eligibility is rechecked at send time.
- **Quiet hours:** local `HH:mm` start/end and an IANA timezone; equal endpoints are invalid rather
  than ambiguous all-day silence. The interval includes start and excludes end. Overnight windows
  are supported. Compare each actual instant's local clock, so both repeated DST hours are quiet
  and nonexistent clock minutes create no fabricated delivery time. Re-evaluate on each tick.
- **Receipts:** persist source kind/id, captured Agent/Team, destination identity, state, attempt
  count, timestamps, bounded fixed diagnostics and known Telegram message ID only. Internal sending
  claims become uncertain on restart; confirmed delivery survives restart without resend. Expose
  deferred/delivered/failed/uncertain/suppressed states and explicit retry for failed/uncertain sends.
  A retry warns of possible duplication and revalidates current source and original destination.
- **Bounds:** at most 100,000 retained source/destination keys per home; fail admission visibly at
  capacity rather than evicting deduplication keys for still-existing sources. Read lists in bounded
  pages. Admit/process bounded batches and serialize actual sends through the existing per-chat
  pacing queue. One known 429 retry is allowed; ambiguous send failures are never auto-retried.
  Use a bounded API timeout. Notification failures remain metadata in settings, not Attention items.
- **Restore:** staged backup recovery pauses notifications independently of ordinary restart,
  preserving receipts and making any in-flight send uncertain. Explicit re-enable defaults to a
  current cutoff and suppresses saved pending work. Including open items uses the same preview plus
  a possible-duplicate explanation because external Telegram history may be newer than the backup.
- **Messages:** fixed kind/action labels, authorized bounded display names and source IDs, with
  escaped HTML and no raw diagnostic or content. Link only through the existing approved private
  HTTPS gateway origin to canonical resolution paths; otherwise give web navigation instructions.
  No inline decisions, credentials, local paths or localhost links. Opening a notice resolves nothing.
- **Mirror overlap:** current turn mirrors do not persist reliable Attention source/message receipt
  correlation. Preserve both surfaces and document possible intentional duplicate failure notices;
  do not infer identity from matching text or suppress unrelated events.
- **Management:** one daemon contract for authenticated web and CLI settings, destination readiness,
  open-count preview, receipts and explicit retry. The daemon owns polling and all mutation; native
  notification controls and a new Attention source remain out of scope.

This contract is the implementation target, not completion evidence. All nine acceptance criteria
and the original test scope above remain required.

### Eligibility and client acceptance refinement

Each selected kind retains its own eligibility cutoff. Adding a kind starts only that kind at the
current cutoff; unchanged kinds retain admitted pending notices and missed eligible sources.
Removing a kind suppresses its pending notices, and re-adding does not replay them automatically.
Already-open items at the exact cutoff instant are retained as excluded baseline receipts, allowing
a distinct new source in the same millisecond to be admitted safely. An explicit preview can include
eligible baseline or configuration-suppressed records; confirmed receipts retain their deduplication.

Web and actual CLI demonstrations now pass against a disposable daemon and fake Telegram transport.
See [the progress log](../BAZ-035-038-progress.md) for exact integrated acceptance evidence,
and [the operator guide](../../attention-notifications.md) for controls and recovery semantics.
The implementation is committed in PR #44 at `4f34efc`, with passing integrated checks and CI.
The story shipped in v0.15.0.

## Acceptance evidence for PR #44

| Criterion | Evidence |
| --- | --- |
| 1. Disabled/invalid pairing sends nothing | Default-off authenticated route checks, transport owner/credential revocation tests, and browser future-only enablement. Live destination validation rejects public aliases, non-forum groups, absent/restricted non-member owners and insufficient bot permissions. |
| 2. One confirmed notification without changing its source | `notification-source-acceptance.test.ts` exercises all five canonical kinds, repeated ticks and unchanged Attention projection/approval count. Receipt tests preserve delivery through restart and deduplicate stable source/destination keys. |
| 3. Quiet hours and resolved sources | Timezone tests cover overnight windows and both DST transitions. Dispatcher tests defer and suppress a source resolved during quiet hours. Per-kind tests preserve unchanged pending notices through settings edits. |
| 4. Current destination and policy after pacing | Dispatcher tests change source, policy and destination behind a blocked outbound queue. Control/transport tests revoke settings, credentials and pairing during validation; current Agent/Team attribution is checked before every send. |
| 5. Confirmation versus uncertainty | Fake API tests distinguish known rejection, bounded 429 retry, ambiguous timeout and shutdown after possible send. Browser keyboard retry and receipt persistence demonstrate explicit duplicate acknowledgement. |
| 6. Metadata and links only | All five template tests omit source payloads/diagnostics and source-provided URLs, escape display names and use canonical authenticated gateway paths. Missing, invalid, credential-bearing and loopback origins produce navigation guidance. |
| 7. No recursive effects | Five-source dispatch leaves the source projection unchanged. Policy evaluation is read-only and tests assert no additional approval. Failures are terminal or deferred receipt/settings metadata; no notification source is added to Attention. |
| 8. Web/CLI parity | Shared authenticated settings/preview/receipt/retry API and typed client. Styled desktop/390px browser and actual CLI demonstrations cover settings, quiet hours, inclusion preview, paginated receipts, reload and explicit retry. |
| 9. Restore reconciliation | A snapshot taken before confirmed sends is restored: no automatic replay, fresh-cutoff re-enable still sends nothing old, and explicit preview includes a possible-duplicate warning before old-item inclusion. The historical uncertainty flag persists after re-enable. |

The repeatable fixture is `scripts/demo-notifications.mts`; all external Telegram responses are
simulated. Final integration logs, commit/push and CI status remain in the milestone progress log.

## As-built release record

Shipped in [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0) on 2026-09-08
through PR #44 and version PR #45. Earlier implementation checkpoint notes are historical.
The complete first-slice scope above is delivered; stated exclusions remain deferred.
See the milestone ledger for integrated, guided browser and release verification evidence.
