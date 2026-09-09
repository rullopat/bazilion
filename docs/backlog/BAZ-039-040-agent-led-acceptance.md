# BAZ-039/040 Agent-led remake acceptance

Date: 2026-09-09. Implemented and validated locally on `feat/baz-039-coding-context`.
This is the replacement for the unpublished operator-probe design. It is not merge, release or
production acceptance. The previous manual screenshots/audit remain historical evidence only.

## Delivered workflow

An operator assigns work in chat. Root instructions arrive with the turn; `repository_context`
refreshes a deeper scope. `coding_environment` describes the admitted runtime. `coding_command`
executes an ad hoc finite operation using the existing shell backend, approval and cleanup lifecycle.
No Team settings or named checks are required. An existing teammate receives work through normal
policy-authorized messaging; the sender yields its workspace and resumes from the inbox reply.

The Team page now contains collapsed advanced diagnostics and optional runtime defaults. The old
operator probe implementation, schema, routes, CLI commands and dashboard are removed without
compatibility adapters. Private command receipts replace probe attempts; they are not public Team
history or a general job system.

## Evidence

| Behavior | Verification |
| --- | --- |
| Root/nested instructions and source discovery | Existing repository resolver, runtime, CLI and egress tests retained; full suite includes containment, hostile Git, changed instructions and protected context |
| Single Agent without saved defaults | `apps/cli/test/agent-coding.test.ts`: real daemon, worker and deterministic provider calls; failure, offline pnpm installation, successful subsequent test; zero Team configuration rows |
| Real offline package preparation | Same fixture with `BAZILION_TEST_DOCKER=1`: local file dependency, frozen lockfile, `--offline --ignore-scripts`, workspace store, no downloaded packages; dependency usable in a later fresh container |
| Missing downloadable artifact | Same Docker fixture: empty offline store yields `ERR_PNPM_NO_OFFLINE_META`; Agent names missing package and requested prerequisite; receipt stays Docker/failed |
| Two existing Agents and normal inbox continuation | `agent-coding-handoff.test.ts`: producer yields, protected helper runs test and replies with receipt, producer resumes and reads it; three distinct sequential writer leases, never more than one |
| Receipt access | `apps/daemon/test/lib/agent-coding.test.ts`: Team membership alone denied, producer message required, current policy and membership rechecked, cross-turn completion rejected |
| Evidence limits and lifecycle | Same host tests: timeout/cancel, stale locks, restart invalidation, terminal retention cap, active retention, split-secret redaction, bounded output, existing dangerous-command denial |
| Docker resource recovery | `coding-recovery.integration.test.ts`, workspace/process tests and backup recovery: recorded identities, acknowledged creation, real exit codes, cleanup before release, copied restore identities not adopted |
| Egress/privacy | `repository-context-egress.test.ts` includes all four coding tools; history/done never independently republish private results; existing HTTP/Telegram policy authorizer retained |
| Optional management parity | `apps/cli/test/agent-coding.test.ts`: authenticated API and CLI show/configure agree, stale revisions reject, saving launches no provider calls |
| Conversation UX | `scripts/check-repository-context-ui.mjs`: actual authenticated browser task, completed command card survives turn reconciliation, output collapsed initially, desktop/mobile layout, inert repository HTML, unsafe scope/recovery |

Docker acceptance command:

```sh
BAZILION_TEST_DOCKER=1 BAZILION_TEST_DOCKER_IMAGE=bazilion-coding:node24-pnpm10 \
  pnpm vitest run apps/cli/test/agent-coding.test.ts \
  apps/cli/test/agent-coding-handoff.test.ts apps/daemon/test/lib/agent-coding.test.ts \
  apps/daemon/test/runtime/coding-recovery.integration.test.ts
```

Result: 13 tests passed in four files. Prepared image identity:
`sha256:40c693a749d9fefe0d206c2716375cc57eb44edd9bf37a29c883c7f9d4c24839`.
The real browser evidence is `/tmp/baz039-ui-yywUna` (desktop/mobile command cards and repository
inspection captures). The required security gate passed all 60 cases; report:
`/tmp/bazilion-security-acceptance-641188.json`. These paths are local ephemeral artifacts.

Root/web typechecks, web production build and lint passed. Lint reports existing advisory warnings.
Final full regression run: 1,491 passed, seven opt-in cases skipped (191 files passed, three skipped). The Docker acceptance above exercises the new opt-in cases separately. A subsequent optional-defaults API/CLI check passed (two tests, one Docker-only case skipped). Logs: `/tmp/baz-remake-final-suite.log`, `/tmp/baz-remake-defaults.log`.

## Explicit limits

- No automatic network provisioning, image pulling, new services, host fallback or ambient plugins.
- Fake providers make deterministic tool choices; no live-provider or production run is claimed.
- Receipt applicability measures bounded inputs, not all code or installed dependency bytes. A past
  success cannot prove later edits; stronger code-bound verification belongs to BAZ-041.
- Already-delivered command cards remain visible in the mounted chat. Reloading history does not
  independently release private command output; ask the Agent for retained evidence through its
  normal authorized turn. The browser does not store receipts in local/session storage.
- Same-workspace Agents cooperate sequentially. Separate parallel workspaces remain BAZ-043.
- Clean-install alpha schema only; no migration/importer for the removed unpublished design.

## Semiauto presentation follow-up

The operator completed the single-Agent offline preparation and two-Agent handoff demos. Follow-up
UI changes collapse inbox runtime instructions and sent-message IDs, use a compact explanation for
private history output, and expose a bounded error excerpt above failed command logs. These are
presentation changes only; they do not fetch receipts or relax policy. Targeted presentation,
command-approval and egress tests: 12 passed. Web typecheck/build passed. The existing handoff
history was inspected in the updated browser, with details collapsed by default.
