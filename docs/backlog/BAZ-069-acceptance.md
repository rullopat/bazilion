# BAZ-069 live qualification log

## Current disposition — revised native-search gate (2026-10-03)

**Revised T18(b) source journey independently accepted; current Linux package/CLI/web checks pass.
Operator accepted the changes and T18/story close-out on 2026-10-03; BAZ-069 is done.**
The [12:20 UTC post-accumulator attempt](BAZ-069-native-t18b-post-accumulator-trial-20261003.md)
returned actual subscription-native completed-stream search evidence, five guarded NASA source
reads and a source-grounded cited answer with one clean `done`. Local canonical receipt/fact/URL
checks passed; unchanged reviewed pins, Agent archived/no worker, operator account preserved.
No retry/fallback; authorization exhausted. [Independent evidence acceptance and fresh packed/UI
checks](BAZ-069-evidence-and-packed-closeout-20261003.md) now pass, including a repaired missing
web-SSR package dependency gate, 2,365 full passes / 47 skips and 324 required security cases.
API-key mode remains explicitly experimental/unqualified; release/publication approval remains
separate from this story acceptance. The chronological history below retains earlier failures and then-current limitations.

The [2026-10-03 subscription-native trial](BAZ-069-native-trial-20261003.md) failed discovery
with a sanitized provider/protocol refusal. One clean blocker-report `done`, no retry/fallback,
no hosted-search receipt and no source read. Cause unknown; no further live attempt authorized.
[Offline diagnosis/remediation](BAZ-069-native-search-diagnosis.md) adds closed failure diagnostics
and fixes case-sensitive SSE media detection; it is not a live-cause finding or a T18(b) pass.
The [freshly authorized 08:09 UTC diagnostic](BAZ-069-native-diagnostic-20261003.md) subsequently
confirmed **decode / invalid_json / upstream HTTP 200 / other media** on its attempt. Actual
body format remains unknown. One search, no source read, clean blocker `done`; no further trial
is authorized.
[Subsequent offline format/transport work](BAZ-069-native-response-format-and-transport.md) adds
bounded closed hints and compares actual pinned SDK requests without provider egress: 106
focused / 2,318 full passes / 47 skips, 278 security cases, root/web types. Node/Pi UA and
transport/payload differences are confirmed, not the live cause. No request settings were
changed; new review/packed/live disposition remains outstanding, and T18(b) stays unchecked.
The [freshly authorized 09:21 UTC retry](BAZ-069-native-t18b-retry-20261003.md) then observed
**decode / invalid_json / upstream 200 / missing media / SSE-like prefix** on that candidate.
One search, no receipt/source read, one clean blocker `done`, archived/no worker; authorization
exhausted. This identifies the MIME-led JSON decoder mismatch for this attempt, not complete
SSE/search validity or either earlier cause. Next is a narrow offline codec-contract decision,
not another call, heuristic success, blind decoder fallback or transport switch.
[Offline missing-MIME repair](BAZ-069-native-missing-mime-repair.md) now uses the explicit Codex
stream contract for absent/blank Content-Type, retaining strict framing/evidence/privacy checks
and no retry. 115 focused / 2,327 full passes / 47 skips, 287 security cases and types passed.
No new provider observation; review/packed disposition and fresh authorization remain pending.
T18(b) is still unchecked, not passed by the repair's fixture success.
[Ordered independent review and terminal assessment](BAZ-069-native-parser-review-and-terminal-assessment.md)
accepted the parser delta and confirmed the `response.done` gap using actual pinned SDK fixtures.
Recommend a strict Codex-only terminal-name alias before another trial; not implemented here.
Pi's status normalization/early return cannot replace native evidence validation. Production
pins unchanged; 121 focused / 2,333 full passes / 47 skips, 293 security cases and types passed.
No new live research or packed qualification; fresh bounded authorization still required.
[The strict Codex-only terminal alias](BAZ-069-native-terminal-alias-implementation.md) was then
implemented and independently accepted with no actionable findings: unchanged explicit status,
whole-stream/evidence/privacy/limit validation, API-key alias refused. 126 focused / 2,338 full
passes / 47 skips, 298 security cases and types passed; new pins recorded. No live observation.
Both reviewed fixes are implemented; consider a fresh authorized source attempt after pin/
readiness checks. T18(b), packed qualification and operator acceptance remain outstanding.
[The freshly authorized post-alias attempt](BAZ-069-native-t18b-post-alias-trial-20261003.md)
then passed decode but refused at **missing, duplicate or excessive hosted search execution
evidence**, upstream 200 / missing media / SSE-like prefix. One search, no search receipt/source
read, clean blocker `done`, archived/no worker. No retained counts distinguish the failed
predicate, and entitlement/exact terminal name remain unknown. T18(b) failed/unchecked;
authorization exhausted. Next: offline evidence-contract/closed structural diagnostic work.
[That offline investigation/repair](BAZ-069-native-evidence-contract-investigation.md) now closes
reproduced stream/terminal contradictions, response/type/item identity gaps and ambiguous
execution diagnostics. No streamed backfill or relaxed proof; closed capped counts only.
Final review accepted; 135 focused / 2,347 full passes / 47 skips, 307 security cases and types
passed. New pins recorded, operator state preserved; no further live research. Prior exact
refusal remains unknown and T18(b) unchecked; fresh bounded observation authorization required.
[The freshly authorized post-evidence retry](BAZ-069-native-t18b-post-evidence-trial-20261003.md)
then refused stream/terminal reconciliation: **`response.completed` with zero output items**,
one completed streamed hosted-web item, three lifecycle events; upstream 200/missing media/SSE-like.
Terminal projection was not reached; no successful search/source receipt. One search, clean blocker
`done`, no retry/fallback; archived/no worker, pins/operator state preserved. **T18(b) failed/unchecked;
authorization exhausted.** Empty terminal output is now observed for this attempt only. Next:
offline contract assessment, not speculative reconstruction, relaxed proof or another live call.
[Deeper OpenClaw consumer comparison](BAZ-069-openclaw-stream-evidence-comparison.md) now shows
completed streamed evidence is retained with empty terminal arrays, explicitly tested for managed
Codex search. Four isolated actual-module checks passed with infrastructure doubles. Recommend
strict completed-item accumulation rather than terminal duplication; **not implemented**, no new
provider observation, unchanged production pins and no T18(b)/entitlement/packed acceptance.
[Completed-stream accumulation](BAZ-069-native-completed-stream-implementation.md) was then
implemented and independently accepted: actual contiguous completed snapshots for explicit empty
Codex SSE terminals, unchanged proof/metadata/full-stream/privacy/limit requirements, explicit
receipt provenance and truthful terminal counts. No partial union/API-key/JSON widening. 152
focused / 2,364 full passes / 47 skips, 324 security cases and types passed; new pins, operator
state preserved. **No new live observation; T18(b) unchecked, fresh authorization required.**

The [revised story](done/BAZ-069-browser-backed-default-web-search.md) makes provider-backed
search the default and retains optional managed browsing. T18(b) no longer requires submitting
Google/Bing browser controls. This is explicit supersession of that requirement, **not a pass**
of the old gate. Prior failures, human-assisted browser evidence and read-only diagnostics stay
unchanged in the historical log below. Their live authorizations are exhausted.

### Revised T18(b) checklist — source evidence and operator close-out accepted

- [x] T18.N1–N5 experimental route/adapter/real-worker IPC/config/reviews/regressions complete;
  [implementation evidence and manual handoff](BAZ-069-native-search-implementation.md).
  Revalidated after Pi 1.0 / exact GPT-6.1 Sol upgrade: 2,262 tests, 243 required security cases,
  root/web types, independent narrow reviews and packed Linux installation passed.
  Subsequent approved MCP retirement/migration candidate: 2,301 full passes / 47 skips,
  261 required security cases, types, repaired narrow review and rebuilt Linux packed
  Agent/Pi/IPC/MCP receipt loop. Prior schemas need clean rebootstrap (see [MCP](../mcp.md)).
  Those offline gates alone made no entitlement, live-model journey, operator visual acceptance
  or release claim; the later live source journey is recorded separately below.
- [x] Fresh bounded authorization covered the subscription/model/NASA scope, one-attempt/time/
  tool envelope, stop conditions and cleanup for the successful 12:20 UTC attempt. Exhausted;
  no further call authorized.
- [x] One real ordinary Agent received a goal with **no Brave/SearXNG and no browser tools**,
  chose one native subscription search and five original-source reads without fallback.
- [x] Same-attempt validated receipt retained one actual hosted-search execution ID, explicit
  `completed_stream` provenance and accepted terminal metadata. Requested cached mode versus
  observed unknown mode is reported honestly; native usage receipt retained.
- [x] Five guarded official NASA reads retained direct HTTP 200/effective URLs/source text;
  local verification checked four final cited URLs and 16 source-fact anchors, not citations alone.
- [x] Final cited answer separated discovery from actual source reading and launch-time plans
  from later completed events; one clean `done`/EOF, no tool/parent error/fatal/cancellation.
- [x] Candidate/route/model/auth type, usage/timing/limits and cleanup recorded in the
  [successful source attempt](BAZ-069-native-t18b-post-accumulator-trial-20261003.md). Canonical
  receipts match, Agent archived/no worker, operator state preserved; no credential/profile or
  raw native-response dump retained. Earlier failures remain historical, not relabeled passes.
- [x] Independent evidence review accepted this source-candidate journey with no blocking finding;
  canonical comparisons, source grounding, timing/completion and retained cleanup checked.
- [x] Current Linux package, CLI/web status/config/persisted-evidence automation and regression
  gates pass. See [close-out evidence](BAZ-069-evidence-and-packed-closeout-20261003.md) for the
  packaging failure/repair, new tarball identity, ten UI checks and platform/evidence limits.
- [x] Official API-key route stays explicitly experimental/unqualified; it has no live smoke and
  is not qualified by this subscription attempt. Qualifying it requires separate authorization.
- [x] Final operator acceptance and T18/story close-out recorded **2026-10-03** in the
  [acceptance record](BAZ-069-evidence-and-packed-closeout-20261003.md#operator-acceptance--2026-10-03).
  The operator accepted the changes and evidence; no additional hands-on UI run is inferred.
  Release/publication remains separate.

### Authorized native trial preflight — 2026-10-03

The operator authorized the proposed single subscription trial: existing ChatGPT account,
`openai-codex:gpt-6.1-sol` / medium, NASA Artemis II only, no Brave/SearXNG/browser/MCP/Firecrawl,
eight-minute ceiling, at most four searches and 32 tools, no fallback or automatic retry.

Read-only local preflight at approximately **06:37 UTC** stopped before any provider request:

- The documented `/tmp/bazilion-mcp-frozen.sha256` manifest and reviewed packed artifact are
  absent. The current dirty worktree (`HEAD ee2a896`) cannot be proven identical to that freeze
  from the available artifacts. Prior recorded reviews/tests are not fresh candidate verification.
- No daemon is listening on the default loopback port 4321. The resolved existing home is
  `/home/patri/.bazilion`; its database fails the current canonical-schema comparison, checked
  with a read-only SQLite handle. A ChatGPT credential row exists, but its validity/account
  readiness was not tested, and no credential was decrypted, copied, refreshed or printed.
- No daemon was started against the existing home, no reset/migration/login was performed,
  no Agent was created and no search/source request was issued. There is no live harness to
  clean up. **This is a preflight blocker, not a T18(b) attempt or pass.**

Next preparation: recover the reviewed freeze or re-establish a pinned/revalidated candidate,
then prepare a clean isolated home and obtain operator-assisted normal ChatGPT connection.
Do not reset the personal home or import its credentials to bypass these blockers. Confirm
readiness and the bounded trial scope before dispatch.

### Fresh-home preparation — 2026-10-03

The operator subsequently reported removing the personal Bazilion folder. Local inspection
confirmed the default home absent and ports 4321/4322 unused. No further deletion was performed.

- Re-ran root/web types (exit 0), full suite (**2,301 passed / 47 skipped**, exit 0) and security
  acceptance (**261 required adversarial cases**, exit 0) with a scrubbed environment. These are
  fixture/regression results, not live qualification or a fresh independent review.
- Recorded a new source/dependency/test manifest at
  `/tmp/baz069-native-trial-prep-u3k9wy/candidate.sha256`, manifest SHA-256
  `b23fb60930ca56111cd5698beb4786672a92158a19c15c0709c7d4238a2bd351`.
  Its pins checked unchanged before daemon startup. This does **not** reconstruct the missing
  historical reviewed freeze or packed artifact. Logs are beside the new manifest.
- Started the source daemon on **127.0.0.1:4321**, with a scrubbed environment and scheduler off.
  Normal self-bootstrap created a fresh `/home/patri/.bazilion`; no old schema or credentials
  were imported. Daemon control/log files are in the preparation directory.
- Through authenticated loopback management, selected only `openai-codex` / `gpt-6.1-sol`,
  disabled browser/image generation and configured auto native discovery with **cached requested
  mode**. Brave/SearXNG/Firecrawl credentials are absent; MCP lists zero servers. No provider
  smoke test, Agent creation, OAuth flow or research turn was invoked.
- Health/setup are ready; **ChatGPT is not connected**. Waiting for operator-assisted normal
  `pnpm tsx apps/cli/src/index.ts auth openai login`. Fresh-home credentials should remain
  daemon-owned; do not copy Pi/global credentials. Candidate review/packed and final admission
  disposition remain distinct from this preparation.

**Two separately authorized native turns ran; neither qualified research:**
[initial trial](BAZ-069-native-trial-20261003.md) and
[fresh diagnostic](BAZ-069-native-diagnostic-20261003.md). The latter observed decode failure,
`invalid_json`, upstream HTTP 200, other media; actual body format unknown. Neither read a
source. T18(b) remains unchecked. No further attempt is authorized.
[Current work plan](BAZ-069-t18b-active-remediation.md)
· [T18.N1–N5](BAZ-069-implementation-plan.md) ·
[OpenClaw route investigation](BAZ-069-openclaw-native-search-investigation.md).

## Historical browser-only disposition and evidence (not revised-gate passes)

**Disposition: Successful human-assisted T18(a) journey observed; operator acceptance pending.**
The successful-journey evidence requirement is now met, with operator CAPTCHA and consent assistance
explicitly recorded. This is not unattended Google qualification, live-Agent qualification or release
approval. T18(b) ran through the ChatGPT subscription: human-assisted research and a cited final
answer were observed, but the first attempt's terminal completion failed. [R10/R11 fixes and
independent re-review](BAZ-069-t18b-remediation.md) now pass regression gates. [Attempt 2](BAZ-069-t18b-retry-evidence.md)
autonomously rejected optional Google cookies and completed its blocker report with a valid `done`,
but Google presented a human-verification barrier before source access. **T18(b) remains incomplete**:
a full successful current-candidate research journey is still required. [Attempt 3 / Bing](BAZ-069-t18b-bing-evidence.md)
subsequently delivered a valid 1.86 MB completion but exposed **R12**, a bounded semantic-capture gap
that prevented obtaining a current ref for a visible consent control. [R12 fixes and independent
re-review](BAZ-069-r12-remediation.md) passed regression gates. A [post-R12 Bing retry](BAZ-069-t18b-bing-r12-retry-evidence.md)
subsequently observed bounded search-scope recovery but two stale pre-dispatch action refusals,
ambiguous dialogs and an oversized screenshot refusal; no source read. A separately authorized
[final Bing attempt](BAZ-069-t18b-final-attempt.md) then stopped before site access because the
isolated harness omitted display variables for explicit headed mode. It produced a valid `done`
but no search or source reading. A separately authorized [headed retry](BAZ-069-t18b-headed-retry-evidence.md)
reached Bing but its submission was refused as stale; a fresh observation showed `Reject`, which
Bing's consent text explicitly says declines the stated optional uses. An operator screenshot
corroborated the prompt. The trial instruction over-restricted the exact label to `Reject all`,
so the Agent stopped without selecting consent or reading a NASA source. **T18(b) remains incomplete**; no further retry was made. The subsequent [offline follow-up](BAZ-069-t18-offline-remediation.md)
clarifies consent wording and distinguishes pre-dispatch stale refusals from uncertain action
failures; its fixture and regression passes are not new live Agent evidence. Subsequent offline
[second](BAZ-069-t18-offline-round2.md) and [third](BAZ-069-t18-offline-round3.md) candidates
passed local suites, but the [third-candidate AI review](BAZ-069-t18-offline-round3-review.md)
identified overlapping action reuse, failed keyboard-action staleness and unbounded navigation
errors. The [fourth offline candidate](BAZ-069-t18-offline-round4.md) addressed those findings;
its [fresh read-only AI review](BAZ-069-t18-offline-round4-review.md) found no blocker in that
narrow delta. The [fifth offline candidate](BAZ-069-t18-offline-round5.md) addressed its two P3
residuals; [fresh read-only AI review](BAZ-069-t18-offline-round5-review.md) found no blocker in
that delta, but recorded a non-blocking per-session retirement-reaction memory accumulation. None
of these reviews is live qualification or human acceptance. A subsequent explicitly authorized
[post-offline live attempt](BAZ-069-t18b-post-offline-live-evidence.md) ran once: the Agent correctly
recognized the delegated Reject choice, but search and both Reject clicks were refused stale
before dispatch. Eight browser calls and one clean `done`; no submitted search or NASA source.
**T18(b) remains incomplete.** Cleanup completed and no second turn followed. A subsequent
[offline dialog-target investigation](BAZ-069-dialog-target-prototype.md) retained production
freshness unchanged; its [independent review](BAZ-069-dialog-target-prototype-review.md) explicitly
rejected enabling the prototype, with actual-browser counterexamples recorded. No further live
trial or source-reading success is claimed.

**Historical browser-only blocking work (superseded default-search requirement):** before the
2026-09-30 scope decision, the operator required browser T18(b) to work, not be deferred. The
[publication/native-binding increment](BAZ-069-t18b-publication-remediation.md) passed a fresh
narrow AI review and regressions; it adds no native action permission or live qualification.
See the [active remediation plan](BAZ-069-t18b-active-remediation.md) for remaining requirements.
A separately authorized [read-only Bing diagnostic](BAZ-069-bing-readonly-diagnostic-retry.md)
collected 20 samples and confirmed measurement-budget and coverage blockers, with cleanup
verified; no Agent search, consent choice, source reading or T18(b) pass occurred.

**Independent review update:** [the initial reviewer](BAZ-069-independent-review.md) recommended
acceptance of the documented assisted journey but required adapter fixes. All reported findings,
including the confirmed WebRTC alias/private-UDP bypass and later follow-ups, are now addressed;
[final re-review and regressions](BAZ-069-review-remediation.md) found no remaining blocker in the
reviewed remediation scope, with regression conditions subsequently met. The reviewers did not
witness the public journey. Operator acceptance remains separate; this is not post-fix live-site
qualification. Source-reading success alone does not establish safe egress.

**Adapter provenance:** the first four public-site attempts below used the superseded
Playwright-owned launcher. The fifth used the direct-spawn/CDP replacement and also stopped
at Google's unusual-traffic interstitial. The sixth, also direct/CDP, completed Google → NASA
with human assistance in the same managed session. See
[the amendment and replacement-adapter evidence](BAZ-069-direct-launch-amendment.md). The earlier
blocked attempts remain failures to complete a journey; later success does not rewrite them.

## T18(a) — Linux managed-browser attempt (2026-09-28)

- **Authorization:** operator authorized one live journey, one search query, and reading at most two
  public pages through the managed browser and normal SSRF proxy. No login, CAPTCHA solving, paid
  service, or private data; stop if blocked.
- **Window:** 2026-09-28 10:36:18–10:36:19 UTC (attempt; cleanup completed immediately afterward).
- **Environment:** Linux; installed Chromium 152.0.7977.82 (Arch Linux), explicitly headless. The
  production managed-browser pool/launcher was invoked with `allowPrivate: false` and an explicit
  daemon-owned SSRF-proxy URL. The proxy started and closed successfully. No model or paid service
  was used.
- **One query:** `NASA Artemis II mission overview`, submitted as a Brave Search results URL.
- **Observed result:** navigation returned an observation header with `Complete capture: yes` and
  `More text: no`, but no accessible page text or result refs. No specific CAPTCHA, access-denial,
  or rate-limit state was observed, so the cause is unknown and is not labelled a site block.
- **Boundary respected:** no second query, retry, alternate engine, or source-page navigation was
  attempted. No public source was read; therefore the successful-journey criterion is unmet.
- **Cleanup:** browser retirement and proxy shutdown both succeeded; the temporary isolated profile
  was removed only after browser close. No profile contents, cookies, or challenge URLs are retained.
- **Assistance:** none.

This result does not demonstrate live search availability or failure cause. A subsequent attempt
under the operator's T18(a) approval is recorded below. The browser-lane reviewer has not accepted either
attempt as qualification.

## T18(a) — Separately authorized retry (2026-09-28)

- **Window:** 2026-09-28 10:46:18–10:46:23 UTC.
- **Environment:** same Linux machine and installed Chromium 152.0.7977.82, explicitly headless;
  managed pool, `allowPrivate: false`, and the normal SSRF proxy. No model or paid service.
- **Query:** one Brave Search query, `NASA Artemis II mission overview`.
- **Observed result:** after one bounded render wait, the accessible page explicitly displayed
  “Verifying you're not a bot” and “Drag the slider.” No result was read and no source was opened.
- **Boundary respected:** stopped immediately at the challenge; no CAPTCHA action, retry, alternate
  engine, or additional query. No screenshot or challenge URL was retained.
- **Cleanup:** browser retirement and proxy shutdown succeeded; temporary profile removed after
  close. Assistance: none.

**Disposition:** This retry confirms blocker reporting only. A further operator-authorized T18(a)
attempt is recorded below. T18(a) still has no successful search-to-source journey.

## T18(a) — Google observation (2026-09-28)

- **Window:** 2026-09-28 10:50:33–10:50:35 UTC.
- **Environment:** installed Chromium 152.0.7977.82, explicitly headless; managed pool, normal SSRF
  proxy, and `allowPrivate: false`. No model or paid service.
- **Query:** one Google Search query, `NASA Artemis II mission overview`.
- **Observed result:** navigation output matched the bounded challenge/consent/access-barrier
  detector, so the journey stopped before any source visit. Exact page text was intentionally not
  retained; the detector does not identify the underlying cause more narrowly.
- **Boundary respected:** no consent interaction, challenge action, retry, alternate engine, or
  source navigation. Browser retirement, proxy shutdown, and temporary-profile cleanup succeeded.
  Assistance: none.

**Disposition:** Google was observed as a barrier, not a successful search. This does not satisfy
T18(a)'s successful-journey criterion. The attempt stopped at the barrier; no alternate engine or
workaround was used.

## T18(a) — Visible headed Google retry (2026-09-28)

- **Window:** 2026-09-28 12:41:00–12:41:21 UTC; visible for 20 seconds before graceful close.
- **Environment:** installed Chromium 152.0.7977.82, explicitly headed; managed pool with explicit
  desktop display access, normal SSRF proxy, and `allowPrivate: false`. No model or paid service.
- **Query:** one Google Search query, `NASA Artemis II mission overview`.
- **Observed result:** the visible page stated that Google had detected unusual traffic and was
  checking whether the request was from a person. The identifying IP and challenge URL were not
  retained. No result or source was read.
- **Boundary respected:** no challenge interaction, retry, or alternate engine. Browser, proxy,
  and temporary profile cleanup succeeded. Assistance: none.

The visible attempt confirms the earlier headless/headed distinction: this time `BROWSER_HEADLESS`
was explicitly false and the browser was launched headed. It still did not satisfy T18(a)'s
successful-journey criterion. During this work, the pool's headed launch was also fixed to forward
explicit X11 display variables through the scrubbed browser environment. The attempted Wayland
fix was incomplete: the old launcher dropped those fields. The direct-launch replacement now
forwards them end to end; see the amendment for the separate display checks.

## T18(a) — Direct-launch/CDP headed Google retry (2026-09-28)

- **Authorization:** the operator requested the retry under the existing T18(a) approval. No
  model, paid service, login, personal browser attachment or imported credentials.
- **Window:** 2026-09-28 13:43:47–13:44:24 UTC; the window remained open briefly for inspection
  after the blocker was observed, without reloading or additional browser actions.
- **Environment:** installed `/usr/bin/chromium`, version 152.0.7977.82 (Arch Linux), explicitly
  headed. Production managed pool with direct executable startup and subsequent CDP attachment.
  Child argv confirmed a nonzero CDP port, no debugging pipe, no headless flag, the normal SSRF
  proxy and disabled implicit loopback bypass. `allowPrivate: false`.
- **Profile state:** fresh isolated managed disk profile, reused throughout this attempt; no
  cookies imported. This does not compare an established OpenClaw profile with equivalent state.
- **Query:** one Google Search results navigation for `NASA Artemis II mission overview`.
- **Observed result:** the complete bounded observation stated: “Our systems have detected
  unusual traffic from your computer network. This page checks to see if it's really you sending
  the requests, and not a robot.” IP, timestamp text and challenge URL were redacted from the
  retained observation. No search result or source was read.
- **Boundary respected:** no challenge interaction, reload, second query or alternate engine.
  Browser/group retirement and proxy shutdown succeeded; the temporary profile was removed only
  after confirmed browser close. Assistance: none.

**Disposition:** incomplete, not accepted. This is the first live attempt with the corrected
launcher. Direct launch and a visible local window did not, on this attempt, avoid Google's
challenge. It does not establish the challenge's cause or prove a network blacklist. T18(a)'s
successful search-to-source criterion remains unmet.

## T18(a) — Successful human-assisted Google → NASA journey (2026-09-28)

- **Authorization:** after the blocker, the operator explicitly requested another visible attempt
  with manual assistance, then reported completion of both the CAPTCHA and cookie dialog. The
  assistant did not interact with either. No login, personal profile import, paid service or
  Bazilion live-model turn was used.
- **Window:** 14:15:10–14:18:42 UTC. Installed Chromium 152.0.7977.82 on Linux, explicitly headed,
  production managed pool and direct-spawn/CDP adapter, normal SSRF proxy, `allowPrivate: false`.
- **Profile:** one fresh isolated local managed profile, kept unchanged throughout the search,
  manual assistance and source visit. No alternate identity/profile/engine or guard change.
- **Query:** `NASA Artemis II mission overview`, submitted once as a Google results URL.
- **14:15:12:** the initial observation showed the unusual-traffic interstitial. After one bounded
  2.5-second render wait, **14:15:14** exposed the reCAPTCHA “I'm not a robot” checkbox in an iframe.
  The earlier immediate observations did not establish that no challenge control could appear.
- **14:16:21:** following the operator's first “done”, a fresh snapshot showed Google's cookie
  dialog over the search results, rather than the CAPTCHA. The assistant asked the operator to
  choose their preference. The specific consent option selected was not observed or inferred.
- **14:16:59:** following the operator's second “done”, the dialog was gone and search results
  were available. The large Google capture was explicitly incomplete. A scoped snapshot at
  **14:17:18** exposed the NASA result “Artemis II: NASA's First Crewed Lunar Flyby in 50 Years”.
  That scoped capture also carried an incomplete flag; no full-results-read claim is made.
- **Action/recovery:** the assistant clicked the observed NASA result with its current
  `observationId`. The click's post-action capture failed with `Selector "body" does not match
  any element` during navigation. The click was **not replayed**. A tab listing at **14:17:51**
  established that the existing `tab-1` had reached the source, and a fresh source snapshot at
  **14:18:06** succeeded with `Complete capture: yes`, `More text: no`.
- **Source actually read:** <https://www.nasa.gov/mission/artemis-ii/>. The page heading was
  “Artemis II”; its overview described a “Crewed Lunar Flyby”, duration “9 Days, 1 Hour, 32 Minutes”,
  launch April 1, 2026 and splashdown April 10, 2026. Source prose described Orion as the vehicle
  carrying and sustaining the crew on Artemis missions. The footer said “Page Last Updated:
  Jul 07, 2026”. These are observations from the NASA page, not Google snippets or its AI overview.
- **Cleanup:** browser/group retirement and proxy shutdown succeeded. The temporary profile was
  removed only after confirmed close. No profile, cookies, identifying challenge URLs, personalized
  Google metadata or full page dumps are retained in the repository.

**Disposition:** the bounded search → observed result → source click → URL verification → source
reading journey succeeded **with human assistance**. This supplies T18(a)'s required successful
journey evidence; independent acceptance is still pending. It does not establish unattended
success, future challenge-free access, retained human verification after restart, or real ordinary
Agent judgment. The transient click-capture error remains an observed limitation, not a silently
successful tool return.

## T18(b) — Live Agent

**Attempt 1 delivered research but failed terminal completion; attempts 2 and 3 completed normally
but read no source. Attempt 3 exposed R12, now remediated/reviewed separately. Full successful
qualification remains incomplete.** See the
[detailed live evidence and offline reproduction](BAZ-069-t18b-evidence.md). The operator authorized
proceeding after the human-assisted T18(a) disposition
was explained, then selected **ChatGPT subscription**, with no paid API fallback.

### Attempt 1, turn 1 — 2026-09-28, 17:07:20–17:07:37 UTC

- A fresh temporary Bazilion home, loopback daemon, selected-skills-empty research profile and
  ordinary Agent were created through the normal daemon APIs. The existing Bazilion home was not
  booted, migrated or modified. The temporary instance connected through the normal ChatGPT OAuth
  login flow; no personal browser cookies or credentials were imported into the research profile.
- Model: **`openai-codex:gpt-6-astra`**, medium reasoning. Only that provider is enabled; no API-key
  credentials or paid-provider fallback were supplied. The canonical session records the actual
  `openai-codex` responses, not canned model output.
- The Agent received a research goal: find an official NASA Artemis II source through Google,
  read it, and summarize purpose, crew and dates with the source URL. Constraints limit the attempt
  to public browser research and require stopping at human-choice barriers. No tool-call sequence,
  selectors, refs or source-page URL were supplied. Prompt budget: 24 browser calls/eight minutes;
  an external watchdog requests cancellation at eight minutes or 32 calls (not a hard per-call
  execution quota).
- The Agent chose **two tool calls**: `browser_status`, then `browser_navigate` to Google search
  for `site:nasa.gov Artemis II mission crew dates`. The latter captured the Polish consent dialog,
  “Zanim przejdziesz do Google”, with **Reject all / Accept all / More options**. The frozen capture
  was complete but delivered as chunk one of two; the Agent did not claim to have read the remainder.
- The Agent stopped without clicking consent or making another request and explicitly reported
  that **no NASA source had been opened or read**. The visible managed session remains available
  for operator assistance; the first turn itself is finished. Consent selection and subsequent
  source access have not yet been observed/confirmed.
- Actual owned Chromium posture was inspected: headed, validating loopback proxy, explicit
  `--proxy-bypass-list=<-loopback>`, native sandbox, no API-key/token/secret-named environment fields.
  The current browser/runtime files matched the reviewed source hashes. This is not a claim that
  every unrelated worktree file was unchanged.
- Usage: **three provider responses**, **32,010 reported total tokens** (17,351 input, 14,464 cache
  reads, 195 output). Pi's catalog-price estimate totals approximately **$0.197724**; that estimate
  is **not an invoice or evidence of API billing**. The selected credential/transport was ChatGPT
  subscription OAuth. No claim about account-level billing or subscription quota remains is made.
- Private temporary control/evidence location: `/tmp/baz069-t18b-jJehpR/`. Raw frames, session and
  isolated authentication state are not a durable evidence package and must be cleaned after the
  attempt, with browser exit proved before removing its profile. No credential, cookie, personal
  account identifier or identifying challenge URL is included here.

**Turn-one disposition at the pause:** the real Agent followed the browser guide and reported
consent honestly; no source had yet been read. The operator then confirmed `done`.

### Attempt 1, turn 2 — 2026-09-28, 17:12:28–17:13:17 UTC

- Same Agent/browser process/profile and tab. The Agent observed current Google results, clicked
  NASA's **Artemis II Lunar Flyby**, and recovered a post-click capture error by taking a fresh
  snapshot rather than replaying the uncertain click.
- It navigated NASA's **Explore → Missions → Artemis** links. Two later mission-link clicks were
  refused as stale; it then navigated the exact mission href already present in the observations.
  No new search, alternate engine or guessed source URL was used.
- It read `https://www.nasa.gov/mission/artemis-ii/` and the Artemis overview. The final mission
  observation was complete with no further chunk, and supported launch **April 1, 2026**,
  splashdown **April 10, 2026**, duration **9 days, 1 hour, 32 minutes**, and future-program context.
  The overview supported the four crew names. Other observations had unconsumed further chunks;
  they are not represented as fully read. No separate effective-URL/address-bar check was made.
- An **872-character cited final summary was delivered**, both as streaming text and an
  `assistant_message`, and persisted in the canonical session. It correctly distinguished the
  source's completed Artemis II account from future lunar/Mars goals.
- It was then followed by **`worker emitted malformed frame`**, with no terminal `done` frame.
  This is not a clean successful turn. The initial operator update incorrectly placed the failure
  before answer delivery; that was corrected after checking the stream/session.
- Offline, the actual reconstructed **230,287-byte** completion frame was valid before transport.
  Three write-then-immediate-exit child probes each delivered only **146,176 bytes** and invalid
  JSON; three exit-after-write-callback controls delivered the whole frame. This confirms the
  unsafe exit pattern and strongly explains the live failure, whose raw offending bytes were not
  retained. **At that point R10 was open; no production fix or new research retry had been made.**
  The later remediation and second attempt are recorded separately below.
- Total: **11 browser calls, 13 provider responses, 478,479 reported tokens**, including 404,992
  cache reads. Pi catalog estimate **$1.170662**, not proof of API billing; subscription OAuth only.

### Cleanup — 17:20:43–17:20:44 UTC

The normal browser-stop API returned 204; the same root PID from the initial posture inspection
was present before shutdown, and **zero live owned-group processes** remained afterward. The
confirmed-reset API returned 204 and reported `profilePresent: false`. Temporary OAuth credentials
were cleared locally; the isolated daemon exited and its entire temporary home was removed. Raw
transcripts/frames and Google redirect metadata were subsequently removed as well. The operator's
personal login browser was not adopted, inspected or closed. No live T18(b) harness remains.

### Attempt 2 — 2026-09-28, 18:36:56–18:37:20 UTC

The operator authorized continuing verification after the R10/R11 fixes and independent review.
A fresh isolated ordinary Agent used **ChatGPT subscription / gpt-6-astra / medium**, headed
Chromium 152.0.7977.82, a fresh managed profile and the normal SSRF proxy (`allowPrivate: false`).
No source URL, ref or tool sequence was supplied. Detailed evidence:
[`BAZ-069-t18b-retry-evidence.md`](BAZ-069-t18b-retry-evidence.md).

- Five calls: status → Google home → stale-ref refusal of Reject all → current-ref Reject all →
  Agent-chosen search query submitted. The refused first click did not execute; a fresh observation
  still explicitly named **Odrzuć wszystko**. The successful click removed the dialog without
  asking the operator again. No parent-controlled browser actions or reported human research
  assistance occurred.
- Google returned **“Our systems have detected unusual traffic from your computer network”**.
  The Agent stopped without challenge interaction, repeated search, alternate engine or guessed
  NASA destination. **No source was reached/read; no source URL/date was verified.**
- Delivered a truthful blocker report, then a valid **24,993-byte `done`** and clean EOF, with no
  fatal/error/tool_error. Canonical final text matched; Agent status returned to `idle`. This is
  clean blocker-report completion, not a complete successful research journey or independent proof
  of large-output handling (the large-frame regression supplies that coverage).
- Six provider responses, **64,582 reported tokens** (14,770 input, 49,536 cache-read, 276 output).
  Catalogue estimate **$0.211036**, not a bill; subscription OAuth only.
- **18:39:28 UTC cleanup:** stop 204, no live owned browser-group process, confirmed reset 204,
  `profilePresent: false`, local OAuth cleared, daemon identity/exit confirmed, temporary home and
  raw-control/evidence artifacts removed. No live harness remains.

### Attempt 3 / Bing — 2026-09-28, 18:51:02–18:51:30 UTC

After explicit **“go on with Bing”** authorization, a fresh ordinary Agent used the same reviewed
code, subscription model/reasoning and normal headed Chromium/SSRF posture. No scripted navigation,
source URL or refs were supplied. [Detailed evidence and R12 diagnosis](BAZ-069-t18b-bing-evidence.md).

- Six calls: status → Bing homepage → stale-ref refusal of query entry → snapshot → screenshot →
  snapshot. The initial query entry was refused **before dispatch**, so no search was submitted.
  Subsequent snapshots explicitly reported unavailable bounded capture. The screenshot showed
  **Accept / Reject / More options**, but the Agent had no current ref for the visible Reject control.
- The Agent stopped without accepting cookies, ungrounded actions or another engine. **No NASA
  source was reached or read.** No CAPTCHA/unusual-traffic page was observed; this is not labelled
  another anti-bot failure.
- A truthful final limitation report arrived with **1,863,849-byte `done`**, no fatal/error, and EOF.
  Canonical final text matched and Agent status became `idle`. This is real large-frame success for
  R10, not successful research qualification.
- Post-turn read-only diagnostics in the already-owned managed tab found full-document estimates
  above the preflight threshold, a body below it, **no native `main`**, but small ARIA main/dialog
  regions. Production capture budgets body against whole-document stats then tries native `main`
  only; an offline reproduction with those measured stats returned the same unavailable result
  without any accessibility serialization. **R12: bounded semantic capture required remediation.**
  These measurements were after the turn, not claimed as exact counts at every earlier refusal.
- Seven provider responses, **61,906 reported tokens**, catalogue estimate **$0.183316**, not billing
  evidence. Subscription OAuth only; no additional model turn or public search for the diagnosis.
- **18:57:54–18:57:55 UTC:** stop/reset both 204, no live owned browser group, profile absent, local
  OAuth cleared, daemon identity/exit confirmed and temporary home removed. Raw frames, screenshot,
  diagnostics and control files were subsequently deleted. No live Bing harness remains.

**Current disposition:** autonomous delegated Google cookie rejection, honest stopping and valid
large live terminal completion are observed, but a complete successful current-candidate research
journey is still missing. **R12 fixes, regression gates and fresh independent review now pass**:
actual-root budgeting, callable scoped evaluation and closed dialog/main/search capture preserve
freshness/byte bounds. See [R12 remediation](BAZ-069-r12-remediation.md). A separately authorized post-R12 Bing trial has since run and stopped safely without source access:
[retry evidence](BAZ-069-t18b-bing-r12-retry-evidence.md). No live success is inferred from those
fixtures, reviews or clean blocker completion. The three attempts are not
combined into one pass. Independent live-lane/operator acceptance and installer/UI/macOS/release
remain separate. No CAPTCHA/login/payment/permission delegation is implied.
