# BAZ-069 — T18 offline follow-up after the Bing consent/stale-ref trial (2026-09-29)

**Engineering follow-up, not T18(b) qualification or independent acceptance.** The [headed Bing trial](BAZ-069-t18b-headed-retry-evidence.md) was incomplete: its search submission was refused before dispatch and the Agent stopped at a consent banner whose `Reject` control clearly declined the described optional uses. The trial prompt required the exact label `Reject all`, which was unnecessarily literal. No new public-site/model turn was run here.

## Narrow changes

1. The bundled browser guide is v4. An operator-delegated rejection is judged from the visible consent text and effect, not an exact button label: `Reject` can mean rejection when the page explicitly says it declines the stated optional ads/analytics uses. Missing or unclear scope still stops. `Accept`, broader permissions, CAPTCHA and old/stale refs remain disallowed. The operator-facing browser guide documents this distinction.
2. `actOnRef` now distinguishes a **stale pre-dispatch refusal** (`No action was dispatched`) from a failure **after the action boundary** (`may or may not have taken effect`). Freshness, document-wide mutation checks, identity binding and denial behavior are unchanged. No automatic retry was added. The guide tells the Agent to inspect the new observation, address authorized blockers, and only then choose a fresh action; after-dispatch errors still require verification rather than blind replay.
3. A local installed-browser fixture hydrates a Bing-shaped consent banner after the search input is observed, then mutates an unrelated news element after a scoped search observation. Both submission attempts refuse as stale **before dispatch** and the fixture counters show zero submissions/consent choices. After the page settles, a new observation permits exactly one submitted action. An unknown ref after the action boundary still gets the uncertain-effect warning. This reproduces the relevant mechanism, not Bing's exact mutation schedule, site availability or the model's future judgment.

## Checks on this candidate

- `pnpm vitest run apps/daemon/test/runtime/prompt.test.ts apps/daemon/test/lib/browser-observation.test.ts`: **46 passed**.
- `BAZILION_TEST_BROWSER=1 pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts apps/cli/test/browser-research.test.ts`: **23 passed, 1 skipped** (headed-only case skipped; all sites are offline fixtures).
- Root and web `pnpm typecheck`: passed. Targeted Biome: no errors; 15 pre-existing non-null-assertion warnings in the browser integration test. `pnpm security:acceptance`: **232 required adversarial cases passed**, including the web build; the gate states live deployment evidence remains separate.

A subsequent [separate read-only AI review](BAZ-069-t18-offline-review.md) found no blocker in the
narrow dispatch/guide change but identified an existing unbounded error-response path and gaps in
what the new fixture proves. Its findings remain open; this engineering checkpoint is not a
release or live-lane acceptance.

## Remaining gate

Global document freshness still refuses whenever Bing changes outside the observed control; the new message **does not make changing sites stable**. Weakening it based solely on a matching search-box label would allow hidden consent/overlay or changed-control meaning to be missed. A relaxation would need its own threat analysis, identity/meaning proof at action time, adversarial tests and independent review. Do not treat a green fixture as T18(b) or rerun a live trial automatically. A further live journey needs explicit operator authorization, a reviewed pinned candidate, actual source reading/effective URL and a clean `done`, followed by independent live-lane/operator acceptance. If that cannot be achieved, keep T18(b) incomplete/defer BAZ-069 rather than substituting BAZ-070 search.
