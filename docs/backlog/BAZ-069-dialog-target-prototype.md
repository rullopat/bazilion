# BAZ-069 — offline dialog-target freshness investigation (2026-09-30)

**Read-only prototype; production freshness remains unchanged.** The operator requested investigation after the [authorized post-offline live attempt](BAZ-069-t18b-post-offline-live-evidence.md) correctly chose `Reject` but hit repeated whole-document stale refusals. No further live trial is authorized or run here.

## Candidate and boundaries

`apps/daemon/src/lib/browser/dialog-target-prototype.ts` is imported **only by the installed-browser fixture**, not by managed guards, the pool, a worker, the production prompt or any tool. It installs separate fixture-only instrumentation and evaluates a boolean about a previously sealed dialog target; it never clicks, chooses consent or changes an action's authorization. A successful boolean is not sufficient permission to relax production `assertFresh`.

The candidate retains an exact Playwright element handle (not a newly resolved matching label), containing dialog node, document root, URL, a bounded region DOM string and sampled computed styles. Capture compares whole-document identity/generation before and after sealing, but that alone does **not** bind it to the Agent's published observation. Mutation history is limited to 128 **records**, with overflow refusing; one token is retained per document. It treats outside character-data mutations as unrelated if its sampled geometry/styles and center-point hit test remain equal. That predicate has **false positives**, documented below; it does not establish unchanged rendered or relevant semantic context. Detectable attribute/child-list mutations, style/script text mutations, replacements, external ARIA dependencies, frames, open shadow roots and oversized regions refuse. Closed shadow roots and other unobservable state are **not** comprehensively covered. No model-supplied selector/evaluation API is added.

The sampled style checks detect one CSS-dependent consent change, but do not cover ancestor compositing or all pseudo-element rendering. Serialized limits are 8,192 region DOM characters, 32 elements, bounded computed-property lengths/aggregate and a 128 KiB-character representation. They do **not** byte-bound retained DOM graphs: a journal node can keep a large detached ancestor subtree alive. Native/transient allocations are likewise not hard-bounded by these limits.

## Offline evidence

Before review, one installed-browser test exercised **16 mutation cases** and three sealing/identity checks:

- A text-only ticker update outside a stable dialog is recognized as unchanged by the prototype. The **production click still refuses**, with zero Reject clicks. This tests no operational exemption.
- Negative cases: control-label and consent-meaning changes; identical-label target and region replacements; disabled control; ancestor attributes; new/existing overlay changes; external name dependency; frame/shadow discovery; journal overflow; stylesheet text; CSS-dependent consent rendering; same-document URL change.
- A mutation between observed generation and seal refuses; navigation destroys the old proof; an existing external accessible-name dependency refuses capture.

After review, five additional **known false-positive** cases were reproduced with the actual installed browser: ancestor opacity changed by outside text; outside consent explanation changed without ARIA linkage; JavaScript `onclick` replacement; closed-shadow explanatory content; page-realm `Map.prototype.get`/`JSON.stringify` tampering. The test deliberately expects the prototype's erroneous `true` for those cases to retain evidence of its limits, not to accept them as safe. No clicks are dispatched in those counterexamples. The initial template and tests were expanded after review; the prototype implementation remains identical to the reviewed one.

Checks on this candidate (actual-browser/type/Biome checks repeated after adding the counterexamples; whole-tree/security checks below preceded that fixture-only expansion):

- Installed-browser offline integration + canned CLI lane: **24 passed, 1 skipped** (headed-only skip). No public site or real model.
- Existing lifecycle, observation and prompt tests: **71 passed**.
- Root/web typechecks passed. Targeted Biome exit 0, no errors, **15 pre-existing non-null-assertion warnings** in the integration fixture.
- `pnpm test --maxWorkers=4`: **2,150 passed, 46 skipped; 259 files passed, 7 skipped**. The new actual-browser test is gated/skipped in this ordinary invocation, not counted as a pass. `/tmp/baz069-dialog-prototype-full.log`.
- `pnpm security:acceptance`: **232 required adversarial cases passed**; no new manifest assertion claims this prototype authorizes actions. `/tmp/baz069-dialog-prototype-security.log`.

## Integration rejected by review — DO NOT ENABLE

[Fresh independent AI review](BAZ-069-dialog-target-prototype-review.md) explicitly recommends **DO-NOT-ENABLE**. It permits retention as an incomplete dormant experiment, not as an action-specific exception. Important unresolved design questions: bind a seal to the daemon's *published* observation rather than freshly read stats at action time; keep session/tab/observation identity and single-use action ordering; changes to relevant context outside the dialog; page-controlled JavaScript/event handlers and instrumentation trust; mutations during browser actionability waits (read-only checking is not atomic with a click). Unsupported or unknown cases must retain the existing refusal, not broaden the tolerated mutation set for Bing convenience.

This prototype does not reproduce Bing's precise mutation schedule or demonstrate that a Bing Reject click will succeed. It may tolerate only a small subset of that site's updates. T18(b) remains incomplete, and BAZ-070 provider discovery cannot substitute for it.
