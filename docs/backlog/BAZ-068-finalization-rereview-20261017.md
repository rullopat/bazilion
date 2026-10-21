# BAZ-068 finalization re-review

## Review

**No issues found.** No current P0/P1/P2 findings within the correction’s specified blast radius.

- **Correct — original P1 resolved:** `apps/daemon/src/lib/coding-environment/workspace.ts:176–196` awaits teardown **before** entering `inTx`. The synchronous release guard and conditional DELETE then execute without another await or microtask boundary. DELETE additionally matches captured writer identity fields and requires exactly one deleted row.
- **Correct — validation remains fail-closed:** `apps/daemon/src/lib/coding-environment/recovery.ts:152–153,206–242` initializes the guard to refusal. Successful teardown installs synchronous mutation/version, inventory, Team/root/selection and persisted-confirmation checks. Drift refuses release; a teardown boolean alone cannot authorize it.
- **Correct — transaction semantics verified:** `apps/daemon/src/core/db/client.ts:70–93,140–142` synchronously invokes the transaction callback and commits afterward, rolling back on exceptions. The supplied release callback is synchronous; the transaction wrapper introduces no asynchronous gap.
- **Correct — compatibility:** The existing automatic lifecycle caller still supplies its teardown authority without the optional management guard (`apps/daemon/src/lib/coding-environment/lifecycle.ts:101–109`). No new worker-signalling capability or schema change accompanies this correction.
- **Fixed:** The parent’s correction resolves the original final-validation/release gap. This reviewer made no edits.
- **Merge verdict: OK**, limited to this correction and the accepted limited-recovery scope.

## Regression and verification evidence

`apps/daemon/test/core/workspace-recovery.test.ts:360–411` adds three nested-microtask regressions covering confirmation, resource identity and current registration drift. Each asserts:

1. The mutation occurred.
2. Recovery returns `selection_changed`.
3. Writer and resource records remain.
4. New workspace admission remains blocked.

Their scheduling targets the original gap: the nested mutation runs after the teardown callback resumes but before the coordinator resumes. The relocated guard now observes that mutation immediately before deletion.

The three required manifest entries match those test names (`security/acceptance-manifest.json:94–110`).

Inspected supplied evidence under `/tmp/baz068-reviewed-5MNQpr/`:

- `tests.json`: **94 passed tests across seven files**, zero failures/pending tests, including all three new regressions.
- `security-match.json`: **21 required BAZ-068 cases passed**, none missing or failing.
- `check.sh`, `status.log`, empty typecheck logs and completed build output support successful root/web typechecks and web production build.
- `lint.log`: no errors; two warnings in the shared Teams route, outside this correction.

These are inspected parent-run artifacts, not tests independently executed by this reviewer. No tests, services, installations or cleanup operations were run.

## Reviewed identity

Current dirty/untracked source was inspected—not merely HEAD. Identity is taken from the supplied **29-file inventory**, `/tmp/baz068-reviewed-5MNQpr/source-inventory.json`; digests were not independently recomputed.

HEAD: `ee2a896dd7306fc534f4192786b2697bfb60a2d0`

| File | Supplied SHA-256 |
|---|---|
| `apps/daemon/src/lib/coding-environment/recovery.ts` | `57855992db32e3dc8d2f1cb848ffc38f700580caec6e06f837746e91dc91cb8d` |
| `apps/daemon/src/lib/coding-environment/workspace.ts` | `2868760bb90580cc4a4a7a2cb4d117b0d774851ee3312599cf46c5d215cc5ff6` |
| `apps/daemon/test/core/workspace-recovery.test.ts` | `28fb0ebb5399257755db8a8427c61d5d99ed9b4c076587506f80395ed7d3e6b5` |
| `security/acceptance-manifest.json` | `37e22eb4dcb03c6df76122e5d60ca0b11169d3f17e1cc54d918c51527d45e299` |

## Limits and follow-up

Guaranteed abnormal host-command recovery remains explicitly deferred. Modeled resource records do not qualify actual Docker teardown; controlled-child and HTTP evidence do not establish full Agent/provider failure recovery. No whole-release, Node 24/platform, packaging or interactive walkthrough qualification is implied.

**Additional parent verification needed for this correction: none**, provided the reviewed source remains unchanged. Broader release verification remains separate.

Limited-scope verdict: ACCEPT