# BAZ-069 — review remediation (2026-09-28)

**R1–R9 addressed; final independent re-review found no remaining blocker in the
reviewed remediation scope.** The reviewer recommended conditional acceptance; all requested
current-candidate regression conditions subsequently passed. Operator disposition remains separate.
At that review's close, no T18(b) or further public browsing had run. This is not operator or
release approval. The subsequently authorized [T18(b) attempt](BAZ-069-t18b-evidence.md) delivered
human-assisted NASA research but exposed **R10, a worker completion/stdout defect**. These earlier
checks do not qualify it; [later R10/R11 fixes and re-review](BAZ-069-t18b-remediation.md) address it
with separate regression evidence. [Attempt 2](BAZ-069-t18b-retry-evidence.md) later selected Reject
all autonomously and completed a Google-blocker report normally, but a successful current-candidate
research journey remains pending. [Attempt 3 / Bing](BAZ-069-t18b-bing-evidence.md) then exposed
**R12**, a bounded semantic-capture gap outside these earlier reviews. [Separate R12 fixes and
re-review](BAZ-069-r12-remediation.md) now pass regression gates; the earlier scope's closure did
not cover that new finding. A complete successful current-candidate live journey remains pending.

## Review history

1. [Initial independent review](BAZ-069-independent-review.md): R1–R5 blocked the adapter;
   documented human-assisted T18(a) evidence was recommended for acceptance separately.
2. Fresh read-only re-review (`gpt-6-astra`, high reasoning, Codex CLI 0.156.1) independently
   exercised in-memory cases and found **R1–R5 resolved in the reviewed scope**, with the reported
   WebRTC alias bypass resolved and macOS resolution fixed but actual macOS execution unobserved.
   It accepted the narrowed startup-worker evidence for the proxy boundary. It found four more
   defects (R6–R9 below), so its overall recommendation remained **changes required**.
   - Thread `01a0e893-57a6-7120-aada-1146b52a6565`; exit 0.
   - Report `/tmp/baz069-rereview-KjAB20/review.md`, SHA-256
     `7b2c8cf31365fd2ecc64be1638e8ed8243f897b8ef29c4d72a781b3f9fc86da3`.
   - All 73 dirty-file hashes matched before/after that review. No reviewer edits, browser
     launches, personal credentials, installs or live Agent/provider turns.

3. The next fresh read-only review confirmed R6, R7 and R9 resolved and found no R1–R5
   regression, but reproduced one remaining R8 defect: open-shadow-root label changes were not
   observed, so a stale ref could still click. That recommendation remained **changes required**.
   - Thread `01a0e8a7-d033-73c1-b0a5-935d902b0bd2`; exit 0.
   - Report `/tmp/baz069-final-review-blaXFY/review.md`, SHA-256
     `cb42adbde5ca097678a8666df9132b2cc05a36e8aba408f20bfe6549aa1ae2a6`.
   - Only manifest names changed externally during that review: two uninstall case names were
     corrected to include their `uninstall command >` suite prefix. Runtime/test source was stable.
   - The current follow-up observes discovered open shadow roots, detects newly attached roots
     before authorizing refs, includes shadow content in size estimates, and refuses freshness
     when traversal coverage is incomplete. Instrumentation is nonconfigurable/frozen. A replaced
     light-DOM root is discovered too. Real-browser regressions cover light DOM, existing shadow
     content and roots attached after capture; old refs refuse and fresh refs work.

4. Final closure review independently reproduced shadow label/text/child mutations, nested roots,
   late attachments and light-root replacement through production instrumentation and pool dispatch:
   **zero stale clicks**, followed by successful fresh-observation dispatch. It also exercised
   unknown/incomplete freshness, observation replacement during the await, large shadow text/attrs,
   and body/main/ref retention limits. **No remaining blocker in the reviewed remediation scope.**
   - Recommendation: **conditional acceptance**, subject to current regression gates. Those gates
     completed successfully afterward, as recorded below; this does not convert the review into
     operator/release approval or independent browser witnessing.
   - Thread `01a0e8b8-806b-77f0-86a1-4cba4b3380a4`; exit 0; Codex CLI 0.156.1, `gpt-6-astra`,
     high reasoning, fresh ephemeral read-only session with user config ignored.
   - Report `/tmp/baz069-shadow-review-WdZil7/review.md`, SHA-256
     `452ddad7cc66ca2fc23ae19b2a98b1c6875ded6c95961febcd5433a6c88e9794`.
   - All **74 dirty/untracked file hashes** matched before/after review. Manifest SHA-256:
     `0faac0821232eabf737f7cb8e086dad066c02168689d1e29ccb21f03aeb46460`.
     Only documentation recordkeeping changed afterward; no implementation/test changes.

These are independent **AI sessions**, not human witnesses or different-model-family review.
Historical reports retain their original findings rather than being rewritten as initial passes.

## Implemented remedies and regressions

| ID | Remedy | Evidence |
| --- | --- | --- |
| R1 — cancellation | Check cancellation after asynchronous admission/queuing; close a handle arriving after cancellation before action dispatch. Active work races entry-specific retirement; later mutation steps check cancellation. Uncertain close wins over cancellation success. Retirement never targets a later replacement entry. | `browser-lifecycle.test.ts`: startup, queued, active reused, uncertain-close and fill-before-submit cancellation. `browser-managed.integration.test.ts`: a real pending navigation is cancelled, owned process exits, marker clears and subsequent cancelled calls refuse. |
| R2 — WebRTC alias | Remove standard, WebKit and Mozilla peer-connection constructors with nonconfigurable getters in every document. | VM alias test plus actual offer/answer/loopback ICE attempts through all three names in main and dynamic srcdoc frames. The unchanged original local probe now reports **0 UDP datagrams**, both standard/WebKit constructors undefined, zero remaining owned processes. A separate synchronous newly appended blank-frame probe also found both undefined; no public site visited. |
| R3 — busy accounting | Increment every admission under lock; retain the lease across the entire async action. Ordinary close/reaping/config change/eviction refuse busy entries; cancellation/shutdown alone force owned retirement. Retirement is idempotent and post-await capacity is rechecked. | Reused navigation held open against every retirement path; repeated actions return busy to zero. |
| R4 — signalling authority | New `group-authority.ts` anchors signalling in live process birth identities, learns descendants only while a known member survives, refuses unknown/reused identities, and revokes permanently when identity is lost. `process.ts` unregisters/revokes in `finally` even after uncertain cleanup; recovery markers never authorize signalling. | Known surviving child, unknown/absent/reused identities, and actual startup failure with injected uncertain-exit evidence. No real PID-reuse or macOS process test is claimed. |
| R5 — macOS mode | Permit explicit native headed launch on Darwin without pretending a GUI was detected. Auto still refuses unknown display; Linux explicit displayless headed still refuses. No headless fallback or Windows ownership support. | Injected Darwin/Linux/Windows resolution tests. Actual macOS launch/cleanup is still outstanding. |
| R6 — uncertain eviction capacity | Count recovery entries toward capacity: a browser whose exit is unknown may still consume resources. Failed eviction cannot admit more Agents. | Cross-Agent `maxSessions: 1` regression: failed retirement of A prevents B/C launches and leaves A refused for recovery. |
| R7 — uninstall unknown ownership | Unknown/malformed/missing process identity fails closed in every phase. Validate numeric identities and recheck ownership under the exclusive uninstall lock, after prompts, before deleting any state. | Starting/stopping/malformed markers preserve DB/auth/profile; interactive subprocess plants a marker after the prompt and proves the under-lock check refuses deletion. |
| R8 — stale ref mutation | Check live document/generation before a ref mutation, then recheck observation ID after the await. Unknown/incomplete freshness refuses. Observe attributes and open shadow roots, including newly discovered roots and a replaced document root. | Dispatch-level generation, document-replacement and unknown-freshness tests; DOM-instrumentation shadow/late-root/root-replacement checks; real browser tests light DOM, existing shadow and late-attached shadow roots, refusing old refs with zero clicks then accepting fresh observations. |
| R9 — oversized retained captures | Apply the 512 KiB UTF-8-safe retention cap to every capture path. Preflight known over-large/over-broad scopes instead of serializing them with a depth limit. A bounded `main` region can supply a labelled partial preview; otherwise return an honest unavailable/incomplete result. DOM estimates include attributes; they are estimates, not an assertion of a hard browser/Playwright memory limit. | Known large shallow scopes are not serialized. Whole-page and partial-main captures remain within retained-byte bounds despite underestimated source size/UTF-8 expansion. Narrow main preview and missing-freshness refusal are tested. |

### Startup-worker gap

Private-target counters now span the entire relaunch (not reset after attachment). The fixture
actively executes a persisted worker **after CDP attachment but before document guards**, then
repeats after guards, with zero private target hits. The proxy is configured from process startup.
This does **not** claim independently triggered worker activity before CDP was observed. The
second reviewer considered this adequate evidence for the validating-proxy boundary.

## Regression observations before the final gate

- Original-remedy targeted lane: 37 passed; root/web typechecks passed.
- Original-remedy security gate: 197 required cases passed. The 204-case follow-up initially
  failed collection because two uninstall names omitted their suite prefix; after correcting
  those names, **204 required cases passed**. Three shadow/coverage cases were then added;
  the final **207-case** result is recorded below.
- After R6–R9: focused lifecycle/observation/uninstall/publication checks passed; root/web typechecks
  passed; headed actual-browser suite **14 passed** and canned-model CLI workflow **2 passed**.
- Original-remedy X11/Wayland suites each passed 13 before the additional real stale-ref check.
- A standalone full run passed 2,107 / 36 skipped. Other runs failed in content-team worker cleanup
  and publication capture (`source_changed`), respectively; isolated reruns passed. Their causes
  were not established. Those earlier passes do not replace the final candidate's required clean
  whole-tree check. Logs remain under `/tmp/baz069-fixes-*` and `/tmp/baz069-followup-*`.
- The R6–R9 whole-tree run with four workers passed **2,115 / 37 skipped**, and its Wayland lane
  passed 14. After the shadow follow-up, the headed lane passed **16**, the workflow passed two,
  and 52 focused process/observation/lifecycle tests passed. The final current-candidate regression
  results are recorded separately below.
- One earlier combined command timed out while security acceptance was still running; its security
  output is incomplete, not a pass. The subsequent standalone 197-case run passed.

## Final current-candidate validation

All commands below exited 0 on the reviewed implementation. No test exclusions were added.
Logs: `/tmp/baz069-closeout-{full,security,wayland,workflow,typecheck,biome}.log` and matching
`.exit` files; the X11 lane is `/tmp/baz069-shadow-browser-final.log`.

| Check | Result |
| --- | --- |
| `pnpm test --maxWorkers=4` | **2,118 passed, 39 skipped; 258 passed files, seven skipped.** Same whole-tree suite, reduced concurrency. Opt-in skips are not passes. |
| `pnpm security:acceptance` | **207 required adversarial cases passed**, including corrected qualified uninstall names and shadow/coverage cases. Web build also passed inside this gate. |
| Actual-browser suite, headed X11 | **16 passed**, including all WebRTC aliases, persisted-worker confinement, real cancellation cleanup and light/static-shadow/dynamic-shadow ref freshness. |
| Actual-browser suite, Wayland-only headed | **16 passed** on the same final source. |
| Gated canned-model CLI research workflow | **2 passed**; not a real ordinary Agent/provider qualification. |
| Root and web typechecks | Passed. |
| Targeted Biome check of 16 changed code/test/manifest files | Exit 0, no fixes applied; **23 warnings**, no errors. Not a claim of whole-repository lint cleanliness. |
| Focused process/observation/lifecycle suite | **52 passed**. |

The previous failures and incomplete runs above remain recorded, rather than being silently
replaced by the successful final candidate. The local no-public-site WebRTC reproduction changed
from 65 loopback datagrams before the fix to zero afterward. No profile/cookie artifacts are
included in the evidence package.

## Remaining gates

A complete successful live research journey after the separately reviewed R10/R11 fixes (attempt 2
completed only a blocker report), independent live-lane/operator disposition, fresh
packed-install qualification, UI interaction, actual macOS execution and release. T18(a) remains
historical human-assisted evidence; the later post-fix T18(b) source-reading result and terminal
failure are recorded separately. The final R1–R9 AI reviewer did not independently run the
browser/full suites or witness a public journey; DOM estimates are not a hard transient-memory limit.
