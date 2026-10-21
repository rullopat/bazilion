# BAZ-069 — T18 offline third candidate (2026-09-29)

The [second-candidate read-only review](BAZ-069-t18-offline-round2-review.md) found three residual P2 issues; this offline candidate addresses them. No public-site or model-led research trial occurred; T18(b) remains incomplete.

- Once any ref action callback begins, failure invalidates the old observation and cursors **before** attempting recovery capture. If recovery also fails, the prior observation id still cannot authorize a second effect. Pre-dispatch stale refusals continue to offer a fresh observation without claiming an action took place.
- `fill_form` validates the complete non-empty array of `{ref, value}` shapes, with bounded element refs and string values, before filling any field. Malformed later fields refuse without partially filling earlier ones. The form is not transactional against failures *during* valid field execution; those remain uncertain and invalidate the old observation.
- All text results pass through the shared 32 KiB UTF-8-safe bound; tabs select/close require a bounded tab id, unknown-operation error messages are bounded, and screenshot captions are bounded. Full failure-response bounds from the second candidate remain in place.

## Regressions

- Lifecycle, observation, guide prompt: **67 passed**. Fake post-effect + failed-capture retry leaves one click; invalid form later fields produce zero fills; oversized tab ids refuse and unknown-op errors stay bounded.
- Offline installed-browser + canned CLI fixtures: **23 passed, 1 skipped** (headed-only case skipped). Dynamic-banner test is dispatch evidence, not an Agent consent decision.
- Root/web typechecks: passed. Targeted Biome: exit 0, no errors and 17 pre-existing non-null-assertion warnings in browser test files.
- `pnpm test --maxWorkers=4`: **2,146 passed, 45 skipped; 259 files passed, 7 skipped**; `/tmp/baz069-t18-round3-full-tests.log`.
- `pnpm security:acceptance`: **232 required adversarial cases passed**; `/tmp/baz069-t18-round3-security.log`. Live deployment evidence remains separate.

Pending: fresh read-only AI review of this pinned third candidate. Neither offline green tests nor that review can provide the same-attempt live browser search → source read → verified URL → clean `done` required for T18(b). A new live attempt requires explicit bounded operator authorization.
