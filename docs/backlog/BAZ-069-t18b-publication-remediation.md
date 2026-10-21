# BAZ-069 — observation publication and native diagnostic binding (2026-09-30)

T18(b) is an [active blocking objective](BAZ-069-t18b-active-remediation.md), not deferred. This increment is a prerequisite, **not a fix for Bing's live stale-control barrier or a live acceptance result**. No public-site visit or live turn was run.

## Implemented increment

`apps/daemon/src/lib/browser/observation.ts` now consumes old observation authority at capture admission, takes a before/after document stamp around ARIA serialization, and prevents late publication with a session revision lease. Invalidation, replacement captures and tab switching cancel pending publication. Freshness checks also revalidate the current observation, actual Page/tab and daemon-observed URL after asynchronous reads. URL identity is retained as a fixed SHA-256 rather than a raw unbounded string. Capture primitives are copied before awaiting; Agent/tab labels and refs are checked. Failed captures cannot revive the preceding observation. Unknown/incomplete stamps cannot authorize refs.

These checks **do not turn page-realm instrumentation into a trusted measurement boundary** or prove arbitrary application behavior. Whole-document generation refusal remains; there is no native equality exception in production.

`native-observation-evidence.ts` now supports test-only `capturePublicationCandidate`: reads native samples before/after the actual daemon observation publication, binds their record to its exact observation/Agent/tab and delivered-text hash, then rechecks freshness/current identity. Native drift/unavailability rejects rather than rebasing evidence. A revision lease before the first native read cancels even unscoped/semantic work when there was no preceding observation id. Late work cannot invalidate a newer publication; ref scoping also retains the source observation id across native I/O. The immutable returned samples explicitly carry **coverage/coherence = unqualified**, never action permission. The pool and managed guards do not call this helper.

## Prior native-reader review and corrections

Fresh read-only AI review `01a0f148-b0b8-7792-823f-cfe591386c40`, `/tmp/baz069-native-evidence-review-aoiEkm/review.md`, SHA-256 `cf9ccb1a8468b5b3125200bd7f9f9a8b058df686ec19b87d52016256de674e53`, reviewed the earlier reader **before** these changes. It reproduced unbounded setup/disposal, event-loop-delayed deadline acceptance, and oversized screenshot misclassification. Corrections add bounded setup/cleanup outcomes, shared cleanup, late-attach retirement, monotonic deadline checks, and an explicit over-budget classification. It did not independently review those corrections or this publication increment.

That review also identified pending integration requirements: OOP/frame/style coverage, coherent cross-channel capture, native/CDP resource containment, and the distinction between observable equality and arbitrary JS backing state. These remain load-bearing blockers; this document does not imply their resolution.

## Publication review and narrow fixes

Fresh read-only AI review `01a0f29a-9574-7dd3-b3de-fe0b80b28219`, `/tmp/baz069-publication-review-uhhL98/review.md`, SHA-256 `0117701058c600edca89b5f9724490c6c7d7d23d89dd0eb220e8a13d266b4201`, ran ten passing in-memory checks and reproduced two P2 blockers: an older unscoped/semantic diagnostic could replace a newer capture during its first native read; and the pool selected a surviving tab after an external closure without updating the canonical active tab. Both are now corrected with pre-read revision leases and an invalidating fallback transition. Six first-read race cases, three fake-pool fallback cases and actual-browser external-close coverage pass. The review predates those corrections.

Final fresh read-only AI review `01a0f2ae-f15a-7823-ad63-7ec3af46a7ac`, `/tmp/baz069-publication-final-review-JfWbwi/review.md`, SHA-256 `e152e6749ce7e889e0a5ee4219c10b0ec41e84b9319855aa27dd7fdd08786121`, found **no new actionable finding** and accepted this as a narrow prerequisite. It independently passed **23 in-memory checks**, including existing/absent-observation first-read races, copied inputs, post-publication races, closed-tab fallback, zero-page invalidation and an unregistered surviving tab. Nine review pins matched before this documentation amendment; the eight code/fixture files remain the reviewed candidate. It did not run the browser/full/security suites or qualify a live lane.

## Offline evidence

- Native actual-browser matrix: **14 cases**. Original 12 cases remain (two idempotent writes plus ten detected changes). Two newly reproduced **equal-sample blind spots** are off-viewport canvas pixels and an omitted CSSOM style property off viewport. Their green fixture result records the limitation, not safe action cases. The fixture also exercises publication binding using the real observation class and proves a subsequent no-op still expires legacy freshness. Zero clicks.
- Native unit tests: **24** (lifecycle/budgets, late setup/cleanup, absolute deadlines, publication binding/drift/invalidation/concurrency/ref-source identity, final retirement and six first-read lease races).
- Observation unit tests add **13** publication/identity/race/URL-retention cases.
- Focused observation/native/lifecycle/prompt: **111 passed**.
- Latest whole tree: **2,190 passed, 47 skipped; 260 files passed, 7 skipped**, `/tmp/baz069-publication-final-full.log`. Installed-browser fixtures are gated out of this invocation.
- Final installed-browser + canned CLI lane: **25 passed / 1 headed-only skip**, including binding and external-close fallback coverage.
- Root/web types passed. Targeted Biome has no new warnings; 17 pre-existing assertion warnings remain in the lifecycle/integration fixtures.
- Final security gate: **232 required adversarial cases passed**, `/tmp/baz069-publication-final-security.log`. This is not new fallback authorization or live acceptance.

## Next gate

The narrow publication increment has passed fresh AI review and parent regressions. No native samples may authorize actions until coverage/coherence/resource containment and selected-control dispatch binding have an independently reviewed design. Identify actual Bing mutation causes with a separately authorized bounded read-only diagnostic if needed; do not substitute another unchanged Agent retry for engineering evidence.
