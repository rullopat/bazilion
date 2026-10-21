# BAZ-065 — controlled-clock scheduler materialization across DST

Continued offline prerequisites under the operator's **“go on with next task.”** No machine timezone/
clock change, live provider/search/image request, operator-home mutation or real-time cron substitute.

## Implementation and observations

`apps/daemon/test/cron-scheduler-timezone.test.ts` starts fresh Node/Vitest fork processes with explicit
**America/New_York** and **Europe/Berlin** zones and a disposable HOME. Only the controlled calendar
cases in the existing `lib/scheduler.test.ts` fixture run. They use the **production scheduler tick,
cron matching, durable dispatch repository and SQLite**, with controlled Date/timers and stubbed turn/
protected-preflight execution. No actual model or worker/container is started by these cases.

Per zone:

- A real adjacent-day 02:30 positive materializes/succeeds once. Three ticks within every minute
  across the spring-gap window produce **no nonexistent 02:30 or catch-up dispatch**. Next normal-day
  02:30 materializes once. Exactly the two expected UTC instants, one attempt each; watermark exact.
- Three ticks per minute across fall's repeated hour produce **two different UTC occurrence records**,
  one hour apart, distinct IDs, one attempt each and two stubbed turn calls. The same local minute
  therefore occurs twice; same-instant repeated ticks do not replay it. Last-fired watermark matches
  the later UTC occurrence.

The parent asserts child success and exactly two passed calendar cases per zone; parent TZ unchanged.
Child homes/report files are test-owned and removed after settlement, never an operator recovery
workaround. Cases are gated by an explicit fixture flag, so normal scheduler test collection does
not change the parent's zone or recursively start the calendar driver.

## Validation

Artifacts: `/tmp/baz065-calendar-dispatch-evidence-PkWRKL/`.

- **28 focused tests / four files pass**, 3.61 seconds: new calendar driver, prior matcher-timezone,
  scheduler and dispatch repository. Four internal child calendar configurations are deliberately
  **not added again** to the parent test count.
- Root/web typechecks, scoped Biome/diff checks pass; `fixtures.sha256` pins changed test sources.
- No full-tree/security rerun for this test-only slice. Prior 2,550/339 results remain separately
  scoped to their recorded candidate; production/runtime code unchanged here.
- Operator daemon still PID **1462656**, images/scheduler/browser off and no workers; private search
  services stopped. No campaign allowance consumed, no new normal-home login or credential copying.

## Evidence limits / remaining work

Advances **CT-09 deterministic dispatcher calendar materialization/deduplication**, beyond the prior
matcher-only evidence. This is **D**, not a real wall-clock S/L/H DST run, end-to-end model judgment,
late editorial approval test or external exactly-once/billing guarantee. Existing actual-cron/Docker
S positives remain separate. No per-trigger zone/UTC translation/catch-up feature added.

BAZ-065/066 still require remaining editorial/current-version approval observations, reviewed recovery
mechanism/disposition, independent source/evidence review, admitted protected search fixture, aggregate
cross-Agent transport guards/counters, concrete timing/account setup and creator/operator tasks.
BAZ-068's unknown host-command cleanup cannot be cleared from group/output absence alone; no unsafe
recovery UI/force-ack is implemented by calendar coverage.
