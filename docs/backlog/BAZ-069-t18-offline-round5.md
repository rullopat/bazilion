# BAZ-069 — T18 offline fifth candidate (2026-09-29)

This candidate addresses the two P3 residuals from the [fourth-candidate read-only AI review](BAZ-069-t18-offline-round4-review.md). No public-site/model-led trial occurred, and no new live trial is authorized here. T18(b) remains incomplete.

- Each managed entry now has a retirement signal, separate from the per-entry action queue and the agent admission/retirement lock. Retirement rejects admitted in-flight and queued callers even when a predecessor Playwright action does not settle. The queued callback still checks entry state before dispatch, so retirement cannot authorize work in a successor session. Normal turn-abort handling and uncertain-cleanup refusal remain.
- The browser host converts non-`Error` rejections to a short static `Error` with an **uncertain-effect** warning. It does not stringify arbitrary thrown strings/objects or invoke their conversion hooks. Bounded normal `Error` messages and reason-code preservation remain.

## Regression evidence

- Focused lifecycle, observation and prompt tests: **71 passed**. New fake tests show forced retirement settles a held click and queued unsignalled Enter without releasing the click or executing Enter; a 40 KiB thrown string and an object with a throwing `toString` yield static bounded errors without conversion.
- Offline installed-browser + canned CLI fixtures: **23 passed, 1 skipped** (headed-only skipped).
- Root/web `pnpm typecheck`: passed. Targeted Biome: exit 0, no errors and 17 pre-existing non-null-assertion warnings in browser test files.
- `pnpm test --maxWorkers=4`: **2,150 passed, 45 skipped; 259 files passed, 7 skipped**, `/tmp/baz069-t18-round5-full-tests.log`.
- `pnpm security:acceptance`: **232 required adversarial cases passed**, `/tmp/baz069-t18-round5-security.log`. Live deployment evidence remains separate.

Pending: a fresh read-only AI review of this exact candidate. Offline gates cannot establish the same-attempt Bing search, NASA source reading, effective URL and clean completion required for T18(b); consent interpretation remains prompt guidance, not structural permission.
