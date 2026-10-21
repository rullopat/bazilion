# BAZ-069 — historical browser-only T18 checkpoint (2026-09-29)

**Superseded scope (2026-09-30):** the operator approved [native OpenAI default discovery](done/BAZ-069-browser-backed-default-web-search.md), with optional managed browsing. The [current checkpoint](BAZ-069-t18b-active-remediation.md) and T18.N1–N5 own next work. Browser-submission requirements below are historical, not current revised T18(b) criteria; failures/security findings and exhausted authorizations remain unchanged.

**Status: T18(b) incomplete.** This checkpoint does not amend any prior trial or authorize another public-site/model attempt. Exa/Parallel discovery is captured separately in [BAZ-070](draft/BAZ-070-optional-exa-parallel-web-discovery.md) and cannot qualify T18's managed-browser lane.

## Latest live outcome

The [post-R12 Bing retry](BAZ-069-t18b-bing-r12-retry-evidence.md) used an ordinary Agent, installed browser, managed proxy and ChatGPT subscription. It finished with a valid `done` and an honest limitation report, but neither submitted a search nor read a NASA source. The semantic search capture produced a current ref twice; whole-document freshness refused both attempted submissions before dispatch. `scope="dialog"` was ambiguous, and a screenshot exceeded the decoded-image bound. The record does not establish a Bing challenge or an R12 regression. Stale refusal and byte bounds must not be relaxed just to make the attempt pass.

## Safe offline checks this checkpoint

- `pnpm vitest run apps/daemon/test/lib/browser-observation.test.ts apps/daemon/test/lib/browser-managed.integration.test.ts`: **36 passed, 21 skipped** (actual-browser suite skipped without its opt-in flag).
- `BAZILION_TEST_BROWSER=1 pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts -t 'R12'`: **3 passed, 18 skipped**. This uses the installed browser with local fixtures; it is not a public-site trial.
- `BAZILION_TEST_BROWSER=1 pnpm vitest run apps/cli/test/browser-research.test.ts`: **2 passed**. Deterministic daemon/worker/browser fixtures are not live-model research evidence.

`SessionObservations.assertFresh` in `apps/daemon/src/lib/browser/observation.ts` deliberately checks the whole document's generation even for a scoped search capture. `actOnRef` in `apps/daemon/src/lib/browser/pool.ts` checks it again before dispatch. The offline tests cover this refusal; they do **not** establish why the live Bing document changed between observation and action. The screenshot path applies the 8 MiB decoded-image bound, also deliberately. No production safety behavior was changed in this checkpoint.

## Decision required before another live T18(b) attempt

The latest trial report calls for **remediation/review or explicit acceptance of the dynamic-site limitation** before another authorized retry. A narrow offline reproduction tied to an observed dynamic page would be necessary before changing freshness semantics; success at clicking by ignoring background mutations alone is not an acceptable patch. If the operator accepts the limitation instead, a new, explicitly scoped live browser-only journey could try a separately chosen permitted search site/source. It must record blocks honestly and must not use BAZ-070/API/MCP search as T18 proof or silently switch engines after a barrier.

Before any such attempt, confirm the operator's concrete query/source scope, provider/model and spend envelope, allowed public sites/number of attempts, headed or headless mode, consent/human-assistance limits and stop conditions. Freeze/review the candidate as required by the T18 plan. A pass still requires one **same-attempt** actual-browser search-to-source journey with verified effective URL, source reading, a clean terminal `done`, independent live-lane review and operator acceptance. T18(a), platform/UI/installer, and release decisions remain separate.
