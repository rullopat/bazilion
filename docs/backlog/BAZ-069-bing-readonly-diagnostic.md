# BAZ-069 — authorized read-only Bing diagnostic, 2026-09-30

## Scope and actual result

The operator authorized one ≤2-minute, read-only Bing-homepage diagnostic in a fresh isolated profile: no clicks, searches, submissions or provider calls, with supported stop/reset cleanup. This is not authorization for another T18(b) Agent turn.

A headed Chromium 152.0.7977.82 daemon-component diagnostic used the normal managed pool/launcher, a real isolated daemon-liveness claim, `allowPrivate: false`, the validating SSRF proxy and the scrubbed display environment. The harness permitted only snapshot and the single Bing-homepage navigation. It was designed to install a passive isolated-world main-document MutationObserver and collect bounded native digest/difference samples; the missing phase log prevents asserting which setup steps completed. The extra navigation filter used `route.fallback()` to preserve the production routing guards. No copied profile, credentials, provider, challenge bypass or consent selection.

**The run stopped; the requested mutation diagnosis did not succeed.**

- UTC start/end: **2026-09-30 14:49:15.480–14:49:16.456**, **976 ms**.
- Result: `stopped-diagnostic`, `PoolError`, `browser_observation_expired`.
- **Zero mutation/native samples**, zero completed capture records, no navigation receipt.
- The harness lacked failure-phase instrumentation. Both startup snapshot and post-navigation capture could produce this reason, so the evidence does **not** establish which failed, whether Bing navigation began, or what page mutation caused expiry. Do not invent a startup-only diagnosis or claim that Bing was never loaded.
- The harness contains no click/type/key/form/search/provider dispatch. No such call was made. No search-to-source qualification or fix is claimed.
- Supported stop and reset confirmed; profile slot absent, isolated home removed. Process-list inspection found no remaining child associated with this diagnostic slot. Native reader was not created. The original summary's instrumentation `detached` label did not distinguish an absent diagnostic CDP session; it is not independent proof that a session had existed.
- Eight production-source pins match before/after. No production source was changed by this diagnostic.

## Evidence and offline correction

Private bounded artifacts: `/tmp/baz069-bing-readonly-diag-jyb7Ui/{summary.json,run.log,harness.ts,source-before.sha256}`. No raw page DOM, screenshots, transcript, OAuth credential or profile is retained. The temporary daemon-local harness file was removed from the repository after archiving.

The **unrun** corrected harness, `harness-corrected-unrun.ts`, adds phase/navigation-request/final-location reporting and separates passive measurements from ref-authorizing publication. It may continue after a known capture-expiry only on its positively running isolated blank session, or after the single navigation has already reached the authorized Bing homepage. It does not replay the navigation, reuse refs, or relax the production freshness guard. Other failures stop. Missing CDP instrumentation is now reported `not-created` rather than `detached`.

Offline syntax and fake-isolated-realm observer checks passed: attribute/character-data equal/different-at-delivery classification, child counts, region counts and unchanged fake DOM. These are not browser or corrected-harness execution evidence. Equality **at observer delivery** may include changes followed by reversion; it is never a no-op safety proof. Main-light-DOM region attribution is heuristic and does not claim iframe/shadow coverage.

**No second live session was launched under this initial authorization.** The operator subsequently authorized a [corrected retry](BAZ-069-bing-readonly-diagnostic-retry.md), which collected 20 read-only samples and cleaned up in 31.994 seconds. That later result does not establish the first attempt's missing failure phase. T18(b) remains active blocking engineering, not deferred; native coverage/coherence/dispatch requirements remain unresolved.
