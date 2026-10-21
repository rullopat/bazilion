# BAZ-069 — R12 bounded semantic capture remediation

**R12 engineering remediation complete in the independently reviewed scope.** The fresh reviewer
found no remaining blocker and recommended conditional acceptance; all remaining frozen-candidate
regression gates subsequently passed. A subsequent [Bing retry](BAZ-069-t18b-bing-r12-retry-evidence.md) exercised the new bounded
search scope but stopped at stale search refs, ambiguous dialogs and screenshot-size refusal,
without a NASA source read. [Bing attempt 3](BAZ-069-t18b-bing-evidence.md) also remains incomplete;
this does not complete T18(b), constitute operator live-lane acceptance or grant release approval.

## Contract

- Body preflight now measures **body**, not the whole document/head. Whole-document instrumentation
  still supplies document identity, mutation generation and complete-traversal checks for actions.
- Default oversized/unavailable-body fallback uses Playwright's accessible **main role**, covering
  native and ARIA landmarks, rather than CSS `main` alone. It remains labelled partial.
- `browser_snapshot` now accepts exactly one mode: `ref` (with current observation id), `cursor`,
  or the closed semantic `scope: "dialog" | "main" | "search"`. Canonical enum/type live in hermetic
  `@bazilion/api-types`; the worker schema and daemon validation share it. No arbitrary selectors,
  URL arguments, script evaluation or screenshot-coordinate actions are exposed.
- A semantic request is a **read-only new observation**, requiring no old ref. Exactly one accessible
  matching region must exist; hidden roots are excluded by role resolution. Zero matches, multiple
  matches, unavailable stats and over-budget scopes refuse distinctly. There is no silent first-match
  choice or broader-body fallback for an explicit semantic request.
- All narrower-region results are labelled **Partial capture: <role> region only** / Complete capture:
  NO. A small dialog does not establish that the rest of the page is safe/clear. Capture never makes
  a consent decision; guide v3 retains prior operator authorization and challenge/permission stops.
- Preflight estimates still refuse known oversized roots before accessibility serialization; retained
  text is clamped to **512 KiB**, responses to **32 KiB**, UTF-8-safe with frozen paging. DOM estimates
  remain estimates, not a hard transient Chromium/Playwright allocation guarantee.
- **Whole-document freshness is unchanged**, including open-shadow discovery, unknown/incomplete
  coverage refusal and observation-id checks across awaits. A mutation outside a captured dialog
  still invalidates its refs. A refused/unavailable capture now has no actionable document identity,
  so issuing its new observation id cannot re-authorize refs cached from an earlier snapshot.
- Scope refusal text distinguishes `scope_absent`, `scope_ambiguous`, `scope_stats_unavailable` and
  `scope_over_budget`, without leaking raw selector exceptions/page data.

## Scoped evaluator correction

Real-browser regressions exposed another part of R12: the existing scoped-stats path passed
`'(root) => window.__bazilion_obs.stats(root)'` as a **string** to Locator.evaluate. It did not invoke
the function and supplied no stats. Switching body preflight to the actual scope made this latent
failure visible in the actual-browser lane; old stubs had returned stats regardless of callback type.

The implementation now passes an actual function, using `globalThis` inside the browser to access
the immutable instrumentation. Its type assertion is erased (no Node-side DOM globals required).
A focused regression checks the callable contract, and actual-body/main/dialog tests exercise it.

Initial candidate failures are retained in `/tmp/baz069-r12-browser.log` and
`/tmp/baz069-r12-browser-debug.log`: missing scoped stats, plus omitted daemon identity in new test
fixtures. Both were corrected, not dismissed as environment flakes. An intermediate typecheck
caught explicit `window`/`Element` references under the Node-only tsconfig; the browser callback now
uses erased `globalThis`/unknown typing. Final typechecks pass.

## Added evidence

- Recorded Bing-shaped estimates: whole-document 674,703 estimated characters while the body is
  508,058; body capture now serializes without attempting a nonexistent native main.
- Ref-independent dialog/main/search captures; distinct missing/ambiguous/unknown/over-budget
  refusals with zero serialization and no old-ref revival; UTF-8 retained/response bounds; continued
  whole-document freshness and incomplete-traversal refusal; oversized ref subtree refusal.
- Daemon dispatch rejects arbitrary selectors, non-enum values and mixed scope/ref/cursor requests.
  Worker proxy/schema uses the same enum; guide v3 teaches bounded recovery without bypass authority.
- Actual installed-browser fixtures (no public search or model): huge head/small body; hydration
  inserts oversized head/body data plus ARIA main/search/dialog regions; stale ids and mutations
  outside the dialog cause **zero clicks**, fresh dialog capture permits exactly one Reject click
  and zero Accept clicks. Hidden, absent, multiple and native/ARIA role matches are exercised.
- Initial corrected actual-browser run: **21 passed**, `/tmp/baz069-r12-browser-final.log`.
  Focused tests: `/tmp/baz069-r12-targeted-final.log`; root/web typechecks:
  `/tmp/baz069-r12-typecheck-final.log`, both exit 0.
- Security manifest adds **15** deterministic cases, raising the required count to **232**.

## Final frozen-candidate gates

All commands exited 0. Logs and exit companions:
`/tmp/baz069-r12-{full,security,x11,wayland,workflow,final-typecheck,biome}.{log,exit}`.

| Gate | Result |
| --- | --- |
| Focused observation/lifecycle/tools/prompt suite | **85 passed**, `/tmp/baz069-r12-targeted-final.log` |
| `pnpm test --maxWorkers=4`, no exclusions | **2,143 passed, 44 skipped; 259 files passed, seven skipped** |
| `pnpm security:acceptance` | **232 required adversarial cases passed**; includes web build |
| Actual-browser X11 lane, final callback/code | **21 passed** |
| Actual-browser Wayland-only lane, final callback/code | **21 passed** |
| Canned-model CLI browser workflow | **2 passed** |
| Root/web typechecks | Passed |
| Targeted Biome, 12 code/test/manifest files | Exit 0, no fixes/errors, **20 warnings** |

Skips and warnings are not passes or whole-repository lint cleanliness. No live provider/search
qualification ran for these regressions. All initial candidate failures above remain recorded.

## Independent re-review

Fresh ephemeral read-only Codex AI session, `gpt-6-astra`, high reasoning, user config ignored;
thread `01a0e99e-6cce-7e02-8bc8-0aa4790e8d26`, exit 0. Report:
`/tmp/baz069-r12-review-E3l0dH/review.md`, SHA-256
`ff37410de5f9002866a12633aef0c9b8f1b4daae8d397913a3415462d4aa6917`.

The reviewer found **no remaining blocker in R12**, preserving closed read-only scopes, exact-one
role matching, actual-root budgeting, partial labels, no old-ref revival after refusal, whole-document
freshness and unchanged byte bounds. Conditional acceptance depended on remaining frozen-candidate
gates; they subsequently all passed as listed above.

The reviewer independently ran **15 in-memory scenarios** against production imports, including
execution of the serialized evaluator, Bing-shaped budgets, all scopes/refusal classes, old-id
rejection, unknown/incomplete coverage, mutation during serialization, UTF-8 bounds and schema/proxy
forwarding. It also independently passed root TypeScript checking with `--noEmit --incremental false`.
It inspected parent test logs rather than independently rerunning actual browsers or the full suite.
This is an independent AI session, not human witnessing or demonstrated different-model-family review.

All **85 dirty/untracked file hashes were unchanged** throughout review; only documentation was
updated afterward. Manifest SHA-256:
`e511a031b7c41b723a8a49d77d5658b9f19bccecf5db196593bf9960b2354e3c`.

## Remaining qualification

The engineering regression/re-review gate is met. The subsequent authorized Bing trial stopped safely without reading a source. Another successful
live journey must still actually read a source, verify its effective citation URL and
finish cleanly. No guarantee of Bing/Google access, consent persistence, macOS execution or release
follows from synthetic/actual-browser fixtures. Earlier failures remain failures.
