# BAZ-069 — T18 offline follow-up, second candidate (2026-09-29)

**No public-site/model-led browser trial. T18(b) remains incomplete.** This candidate addresses the [separate AI review's](BAZ-069-t18-offline-review.md) three open offline findings; the earlier review remains a historical record of the previous candidate, not sign-off on this one.

- `pool.ts`: ref-bearing actions and ref-scoped captures accept only bounded `e` + 1–9 digits before constructing an `aria-ref` selector; a malformed later field of `fill_form` refuses the entire form before filling anything. On failed ref actions, ref/error diagnostics are bounded individually and the **complete** response (including any fresh observation) is capped to 32 KiB, preserving the pre-dispatch vs. uncertain-effect distinction. No document freshness or cancellation check was relaxed.
- `docs/browser-research.md` now delegates declining clearly described *optional* uses by effect, not by an exact button label. The bundled guide v5 explicitly preserves operator-imposed label/site/purpose restrictions and notes that consent interpretation is prompt guidance, not structural enforcement.
- The dynamic-banner fixture asserts both stale submissions left the input unchanged, with no submission or consent choices, and explicitly limits itself to dispatch semantics. A daemon fake action now increments the click count **before throwing** an oversized UTF-8 error: the result must remain uncertain, bounded and unreplayed. It also exercises the recovery-capture-failure path. Invalid/oversized refs and a malformed later form ref refuse with zero actions. Neither test exercises a real Agent's consent judgment; the existing scoped-dialog fixture separately tests a current `Reject` ref with zero `Accept` clicks.

## Checks (this candidate)

- Focused lifecycle, observation and prompt tests: **66 passed**.
- Installed-browser offline integration + canned CLI fixture: **23 passed, 1 skipped** (headed-only case skipped).
- Root + web `pnpm typecheck`: passed.
- Targeted Biome: exit 0, **17 pre-existing non-null-assertion warnings** in the two browser test files; no errors.
- `pnpm test --maxWorkers=4`: **2,145 passed, 45 skipped; 259 files passed, 7 skipped**; includes web build. `/tmp/baz069-t18-round2-full-tests.log`.
- `pnpm security:acceptance`: **232 required adversarial cases passed**, including web build. `/tmp/baz069-t18-round2-security.log`. Live deployment evidence remains separate.

Pending: fresh read-only independent review of this pinned second candidate. No result of that review can count as T18(b) source-reading qualification or human/operator acceptance. New bounded authorization is required before any further live turn.
