# BAZ-069 — T18 offline fourth candidate (2026-09-29)

This candidate responds to the three P2 findings in the [third-candidate read-only AI review](BAZ-069-t18-offline-round3-review.md). That review applies to its prior pinned files only; this candidate needs new review. No public-site/model-led trial took place; T18(b) is still incomplete.

- All browser operations on one managed entry now pass through a separate per-entry action queue (not the admission/retirement lock). The existing `busy` reservations and cancellation retirement remain independent; a queued operation rechecks cancellation/entry state before dispatch. Ref-targeted actions consume their observation **before** Playwright runs, so a concurrent explicit call cannot use the same id while an action is pending. Errors after dispatch remain uncertain and recovery captures new ids. Cancellation must not wait on an in-flight Playwright action.
- `press_key`, `go_back`, `navigate`, new/close tab and ref actions invalidate old observation authority before effectful operations that may fail after an effect. An invalid/stale ref still refuses before dispatch. Partial form fills on runtime failure are uncertain; static form shape is validated in full beforehand.
- Pool text results, pool errors, status and host-dispatched oversized errors are bounded to 32 KiB (including blocked-navigation errors with large worker-supplied schemes); preserved reason codes are retained for bounded host errors. This is a response/error size rule, not a guarantee of site safety or error redaction.

## Regression evidence

- Focused lifecycle/observation/prompt: **70 passed**. New fake scenarios: overlapping click with one observation yields one effect; failed Enter cannot re-authorize a click; malformed 40 KiB scheme error and oversized host-dispatched Playwright error are bounded. Prior ref/form tests remain.
- Installed-browser offline lane + canned CLI: **23 passed, 1 skipped** (headed-only skipped).
- Root/web `pnpm typecheck`: passed. Targeted Biome: exit 0, no errors, **17 pre-existing non-null-assertion warnings** in browser tests.
- `pnpm test --maxWorkers=4`: **2,149 passed, 45 skipped; 259 files passed, 7 skipped**, `/tmp/baz069-t18-round4-full-tests.log`.
- `pnpm security:acceptance`: **232 required adversarial cases passed**, `/tmp/baz069-t18-round4-security.log`. Live deployment evidence remains separate.

A fresh read-only review of these exact files is required before a narrow offline verdict; no code-only review can qualify T18(b) or grant operator/human acceptance. Further live trials require explicit bounded authorization.
