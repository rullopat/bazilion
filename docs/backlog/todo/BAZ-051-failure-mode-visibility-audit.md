---
id: BAZ-051
title: Failure-mode visibility audit — every recovery is seen or surfaced
status: todo
size: M (1 week)
created: 2026-09-17
refined: 2026-09-18
priority: high
note: Beta blocker. Recovery machinery exists and is tested for correctness; visibility under real failure is not.

## Refinement decisions (2026-09-18, after tracing every path)

1. **Found silent gap → new attention kind `queue_interrupted`.** After a daemon
   crash, `recoverInterrupted` pauses the agent's queue control with
   `reason: 'interrupted'` and marks interrupted items `uncertain` — but nothing
   surfaces the pause. `accept()` enqueues onto a paused queue by design
   (deliberate pauses buffer; that stays), the pump never drains, and neither the
   web UI nor the Attention Center shows why the agent went quiet. The kind is
   projected from `user_queue_controls WHERE paused=1 AND reason='interrupted'`:
   `action_required`, not acknowledgeable (resuming — the real action — clears it),
   href the agent page, diagnostic names the crash and the uncertain count.
2. **OAuth refresh failure → actionable error, no new kind.** A failed refresh
   currently throws pi-ai's raw error into the turn. Wrap it: name the re-login
   action (`bazilion auth openai login` / Connect on /config). `/config` already
   shows connected state and expiry; turns fail loudly. A credential attention
   kind would duplicate that.
3. **Enqueue-while-paused stays accepted** (documented): messages buffer and drain
   on resume; the attention item is the operator's signal. A 409 would break
   legitimate deliberate pauses.
4. **Observe-only rows** (surface exists; the audit asserts it): provider outage
   (turn `event:error`/`fatal` frame + queue item `failed` with protected-failure
   diagnostic), Telegram send failure (receipt terminal `failed`/`uncertain` with
   diagnostic + the underlying attention item stays open in the web UI), loop
   breach (`agent_loop_break` item), disk-full backup (CLI error, home and daemon
   intact), queue-dispatch lease recovery after kill (lease reclaimed; terminal
   failure lands `trigger_failure` attention).
5. **Web surfaces to touch:** attention page kind dropdown,
   `NotificationSettings` kind map (drives subscription checkboxes), api-types
   union. CLI `attention` output is projection-driven.
6. **Test layout:** daemon-level rows in a new
   `test/runtime/failure-visibility.integration.test.ts`; the mid-coding-run SIGKILL
   row joins the docker-gated `coding-recovery.integration.test.ts` as a
   visibility assertion. One test per table row, asserting the OBSERVED surface
   (attention projection, queue diagnostics, receipt state), not internals.
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
No code path recovers silently. The `queue_interrupted` row asserts: crash mid-turn →
restart → attention item present → resume → item gone, queued input drains.
