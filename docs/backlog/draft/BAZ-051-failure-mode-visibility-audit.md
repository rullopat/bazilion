---
id: BAZ-051
title: Failure-mode visibility audit — every recovery is seen or surfaced
status: draft
size: M (1 week)
created: 2026-09-17
priority: high
note: Beta blocker. Recovery machinery exists and is tested for correctness; visibility under real failure is not.
---

# BAZ-051 - Failure-mode visibility audit — every recovery is seen or surfaced

## User stories

- **As an operator whose provider goes down mid-turn**, I want the outcome visible —
  either a clear self-healing notice or an Attention item — so I never wonder whether
  my agent silently lost work.
- **As an operator whose daemon died during a coding run**, I want the post-restart
  state to tell me what was interrupted and what happened to it, so recovery is a fact,
  not a hope.

## Goal

For every recoverable failure mode, prove (observe, not assert) that the outcome either
self-heals *visibly* or lands in the Attention Center. Silent failure is the only
unacceptable outcome.

## Why

The recovery machinery is real and unit-tested: interrupted queue/question/notification/
review recovery in `ctx.ts`, the turn circuit breaker (BAZ-025), OAuth refresh
single-flight (BAZ-023), durable coalesced dispatch with bounded retry (BAZ-019). But
those tests verify correctness of recovery, not *visibility* — and beta users will hit
these states within weeks. A silently-discarded follow-up after a crash is the kind of
defect that erodes trust in an agent product permanently.

## Scope

Deterministic fault injection, one case per row, asserted end-to-end (daemon + web +
CLI where applicable):

| Failure mode | Inject via | Expected outcome |
|---|---|---|
| Provider outage mid-turn | mock provider 5xx/timeout | turn fails visibly; retryable state obvious |
| Daemon kill mid-coding-run | SIGKILL during a live command | post-restart: interrupted-command recovery visible |
| Daemon kill mid-queue-dispatch | SIGKILL during scheduled trigger | lease recovery, no silent drop, no double-dispatch |
| Telegram send failure | unreachable/unauthorized bot | dispatch retries bounded, then Attention item |
| OAuth refresh failure (BAZ-023) | expired refresh token | operator-visible credential attention item |
| Agent-message loop breach (BAZ-025) | causal-hop budget exhaustion | payload-free diagnostics visible in Attention |
| Disk-full during snapshot/backup | quota/filled tmpdir | clean failure, pre-existing home intact, Attention item |

## Out of scope

- New recovery mechanisms (the existing ones are sound).
- Performance under failure (soak testing is separate; candidate for post-1.0).

## Tests

The table above *is* the test plan: one deterministic injection test per row, asserting
the observed surface (web Attention badge/queue, CLI parity, Telegram where opted in).
No code path recovers silently.
