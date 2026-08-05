---
id: BAZ-026
title: Operator Attention Center — one queue for actionable runtime signals
status: done
size: M
created: 2026-08-04
refined: 2026-08-04
priority: high
shipped: 2026-08-05
note: Replaces the proposed mobile-approval story. Aggregate existing durable sources; do not build a second workflow or audit log.
---

# BAZ-026 — Operator Attention Center — one queue for actionable runtime signals

## User stories

- **As an operator of long-lived Agents**, I want one place showing what needs my attention so I
  do not have to poll Approvals, Learning, Triggers, and every Agent inbox separately.
- **As an operator diagnosing background automation**, I want each item to explain what happened,
  how urgent it is, and where to resolve it without copying message or transcript payloads into a
  second audit store.
- **As an operator returning after time away**, I want to acknowledge informational failures and
  loop stops while actionable items disappear automatically when their source is resolved.

## Goal

Add a web-first **Attention Center** backed by a daemon-owned projection over Bazilion's existing
durable sources:

```text
communication approvals ─┐
learning proposals/reviews├─> normalized attention projection -> HTTP -> CLI + web queue/badge
trigger dispatch failures ┤
agent loop breaks ────────┘
```

The center is a read model and navigation surface, not a new workflow engine. Decisions still use
the canonical source endpoint: approvals are decided by `/api/approvals`, lessons by the Agent
learning endpoints, and trigger configuration/history by their existing routes.

## Product decisions

- **Web first, not mobile:** the immediate problem is fragmented operator state. A future mobile,
  email, Telegram, or push channel can consume the same wire contract after the center proves useful.
- **No copied payloads:** attention items contain identifiers, bounded diagnostics, policy evidence,
  counts, timestamps, and resolution links. They never duplicate chat messages, approval payloads,
  transcript excerpts, or tool arguments/results.
- **Source-owned lifecycle:** pending approvals and lesson proposals disappear from the open queue
  when decided. The Attention Center cannot approve, reject, retry, or revoke them itself.
- **Acknowledgement is presentation state:** terminal failures and loop-break events remain in their
  canonical source tables. Acknowledging one only records that the operator has seen that source id.
- **Stable severity:** `action_required`, `error`, and `warning`. Severity is deterministic by kind,
  not model-generated or operator-configurable in this slice.
- **Foreground turn failures deferred:** ordinary chat failures/cancellations are represented only in
  pi's canonical session JSONL and have no durable indexed occurrence record. This story will not
  add the forbidden runs/events audit layer or scan/copy transcripts on every page load. A later
  notification hook may add a narrow terminal-turn receipt if real usage justifies it.

## Attention sources

| Kind | Included state | Severity | Leaves open queue when |
|---|---|---|---|
| `communication_approval` | pending approval attempt | `action_required` | approved, denied, cancelled, or expired |
| `lesson_proposal` | pending reviewed-learning proposal | `action_required` | approved or rejected |
| `review_failure` | failed or cancelled Agent review | `error` | operator acknowledges it |
| `trigger_failure` | terminal failed/exhausted trigger dispatch | `error` | operator acknowledges it |
| `agent_loop_break` | daemon-stopped causal message chain | `warning` | operator acknowledges it |

Running/retrying reviews and trigger dispatches are visible in their owning screens but are not
attention items until terminal. Disabled learning, zero-proposal reviews, policy denials, and normal
completed work do not create attention.

## Canonical schema

Edit `apps/daemon/src/core/db/migrations/0001_init.sql` only.

Add `attention_acknowledgements`:

- `source_kind TEXT NOT NULL`
- `source_id TEXT NOT NULL`
- `acknowledged_at INTEGER NOT NULL`
- primary key `(source_kind, source_id)`

This table stores no title, diagnostic, payload, Agent id, Team id, or copied source state. Removing
an acknowledgement makes an eligible historical source visible again. Backup/restore must preserve
acknowledgements and the backup schema allowlist/hash must be updated.

## Projection and wire contract

Add canonical wire types in `@bazilion/api-types`:

- `AttentionKind`
- `AttentionSeverity`
- `AttentionItem`
- `AttentionSummary`
- list/query/acknowledgement envelopes

An `AttentionItem` contains:

- stable `key` derived from kind + source id;
- kind, severity, source id, occurred/updated timestamp;
- optional Agent and Team identifiers/names when already available from canonical relations;
- bounded operator-safe title and diagnostic;
- canonical web `href` for resolution;
- `acknowledgeable` and `acknowledgedAt`.

Implement one daemon projection service that queries repositories directly and normalizes/sorts the
results newest first. Do not have the daemon call its own HTTP routes, and do not create a generic
event bus or polymorphic copied-item table.

HTTP:

- `GET /api/attention?state=open|acknowledged|all&kind=...&limit=...`
- `GET /api/attention/summary` — open total plus counts by severity/kind for navigation badges
- `POST /api/attention/:key/acknowledge`
- `DELETE /api/attention/:key/acknowledgement`
- `POST /api/attention/acknowledge-all` — acknowledges only currently acknowledgeable projected
  items; it cannot decide action-required source records

Malformed keys, unsupported kinds/states, stale/deleted sources, and attempts to acknowledge an
action-required item return typed errors. Authentication and the first-run gate apply normally.

## CLI parity

- `bazilion attention list [--state open|acknowledged|all] [--kind KIND] [--json]`
- `bazilion attention summary [--json]`
- `bazilion attention acknowledge <key> --yes`
- `bazilion attention unacknowledge <key> --yes`
- `bazilion attention acknowledge-all --yes`

Human output shows severity, kind, Agent/Team context, age, and the canonical next action. JSON emits
the wire envelope unchanged. Acknowledgement commands require `--yes`.

## Web

- Add canonical navigation item **Attention** near Approvals.
- Show an open-count badge sourced from `/api/attention/summary`; zero renders no badge.
- `/attention` includes open/history tabs, severity and kind filters, newest-first cards/table, and
  grouped counts.
- Action-required items link to the existing decision screen and use explicit labels such as
  **Review approval** or **Review lesson**.
- Acknowledgeable events offer **Acknowledge**; history offers **Restore to open**.
- **Acknowledge all informational items** clearly excludes approvals and lesson proposals.
- Loading, empty, partial-source failure, stale item, authentication failure, and acknowledgement
  conflict states are explicit.
- Use the shared `<Button>` component and preserve keyboard/focus/accessibility behavior.
- Responsive target: desktop information density with a usable narrow/mobile browser layout; no
  native mobile implementation in this story.

## Failure and consistency behavior

- Build each source projection independently. If one source query fails, return a typed degraded
  section and the remaining sources rather than turning the whole center blank.
- Summary and list share the same projection/filter semantics so badge counts cannot disagree with
  the open tab.
- Source changes win over acknowledgement state: a decided approval never remains open merely
  because its attention item was loaded in another tab.
- Acknowledgement writes are idempotent and safe under concurrent tabs.
- Apply hard list limits and bounded diagnostics; do not expose secrets or message payloads.

## Out of scope

- Native mobile screens or push notifications.
- Email, Telegram, desktop, webhook, or OS notification delivery.
- Approving/rejecting work directly inside the Attention Center.
- Automatic retries, remediation, escalation policies, snoozing, assignment, priorities, or SLAs.
- A generic event bus, runs/events tables, provider-cost analytics, or copied transcript history.
- Foreground Agent turn failure/cancellation aggregation until a narrow durable source contract is
  separately justified.

## Acceptance tests

- Each eligible canonical source produces exactly one stable attention item with the correct kind,
  severity, context, safe diagnostic, timestamp, and resolution link.
- Pending approvals and lessons disappear automatically after canonical decisions and cannot be
  acknowledged as a substitute for deciding them.
- Failed/cancelled reviews, terminal trigger failures, and loop breaks remain open until
  acknowledged; acknowledgement and restoration are idempotent across concurrent requests.
- `acknowledge-all` touches only acknowledgeable items present in its transaction/projection and
  leaves action-required items untouched.
- No projected item or acknowledgement row contains message, approval, transcript, tool argument,
  or tool-result payloads.
- Source deletion, stale browser tabs, invalid keys, and partial projection failure produce explicit
  typed/degraded behavior.
- Summary counts exactly match the corresponding filtered open list.
- HTTP auth, CLI commands, and the web route cover list, filtering, navigation, acknowledgement,
  restoration, empty/loading/degraded states, and narrow viewport behavior.
- Backup/restore round-trip preserves acknowledgement state while all item content continues to be
  reconstructed from canonical sources.

## Delivery slice

BAZ-026 is complete when an operator can open one authenticated page, see every currently pending
approval/lesson plus recent terminal review/trigger/loop failures, navigate to the canonical
resolution screen, acknowledge informational failures, and observe a navigation badge that stays
consistent with the open queue.

## As built

- Added a daemon-owned, independently degraded projection over pending communication approvals,
  pending lesson proposals, terminal review failures/cancellations, failed trigger dispatches, and
  Agent loop-break events.
- Added payload-free `attention_acknowledgements` presentation state, canonical API types, list and
  summary endpoints, idempotent acknowledge/restore, and informational-only bulk acknowledgement.
- Added CLI list, summary, acknowledge, restore, and acknowledge-all commands with explicit `--yes`
  mutation confirmation.
- Added the responsive web Attention Center, open-count navigation badge, open/history and
  severity/kind filters, canonical resolution links, degraded states, and secret-redacted bounded
  diagnostics.
- Updated the clean-install schema fingerprint so backup/restore preserves acknowledgements while
  reconstructing every item from its canonical source.
- Verified with focused projection and HTTP contract tests, the full 913-test suite, root and web
  typechecks, the production web build, lint, and isolated semiautomated browser QA covering
  navigation, individual and bulk acknowledgement, restoration, action-required protection,
  redaction, and narrow viewport behavior.
