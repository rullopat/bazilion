# BAZ-069 — direct local launch correction (2026-09-28)

## Decision and disposition

The operator clarified that **OpenClaw-style browser startup is required**, not merely a visible
window. The initial implementation's Playwright-owned launcher was a mismatch. Directly launch
the installed browser on the Agent's isolated persistent local profile, then attach Playwright
via CDP. Keep the browser guide, existing tools, IPC identity/admission, observations, operator
controls, profile privacy and normal SSRF boundary. Do not attach to a personal browser, import
cookies, introduce a remote CDP setting or add a second browser backend.

This supersedes the September 25 `launchPersistentContext` decision in the original handoff.
Earlier Gate A/B acceptance and T01/T05/T06 evidence describe the **old adapter**. The revised
adapter/lifecycle evidence below requires independent acceptance. T18 remains incomplete; none
of the four earlier public-site attempts used this replacement. No Google-success or macOS-vs-
Linux causal claim follows from this correction. No model, public search or paid service was
used to validate the replacement during this change.

## Independent review outcome (2026-09-28)

The [initial review](BAZ-069-independent-review.md) required changes. Those five findings and
subsequent capacity, uninstall, capture-bound and freshness findings are now addressed, including
the final shadow-root case. [Final independent re-review](BAZ-069-review-remediation.md) found
**no remaining blocker in the reviewed remediation scope** and recommended conditional acceptance.
Its regression conditions subsequently passed: 2,118 tests, 207 security cases, 16 X11 and 16
Wayland browser checks, two canned-model workflow checks, root/web typechecks and targeted Biome
(no errors; warnings retained). Operator acceptance remains separate.

The reviewer recommends accepting the documented **human-assisted T18(a) journey evidence**,
without claiming to have witnessed it. The later [T18(b) live Agent attempt](BAZ-069-t18b-evidence.md)
observed human-assisted NASA research and answer delivery, but terminal worker completion failed;
[R10/R11 remediation](BAZ-069-t18b-remediation.md) now passes regressions and independent review,
but [attempt 2](BAZ-069-t18b-retry-evidence.md) completed only a Google-blocker report after
selecting Reject all autonomously. A successful current-candidate research journey remains missing;
[attempt 3 / Bing](BAZ-069-t18b-bing-evidence.md) subsequently exposed **R12** while successfully
transporting a 1.86 MB terminal frame. [Separate R12 fixes/re-review](BAZ-069-r12-remediation.md) now
pass regression gates, but a new successful live journey is still required. This is not live
qualification or release approval.

## Implemented contract

- `apps/daemon/src/lib/browser/process.ts` directly spawns the validated executable with a
  nonzero reserved loopback debugging port and the persistent `user-data` directory. Arguments
  follow the managed OpenClaw launch shape rather than Playwright launch defaults. The native
  sandbox and browser identity remain intact; no webdriver/UA patch or stealth switches.
- The fresh child's bounded stderr provides only an expected loopback WebSocket browser endpoint.
  Before attachment, Linux verifies the listener's socket inode against that child; macOS uses
  bounded PID-specific `lsof` inspection (implemented, **unobserved**). Stale port files, foreign
  listeners, wildcard listeners and arbitrary remote URLs are not attachment authority. Port
  reservation races refuse rather than adopting another process.
- The daemon attaches through `chromium.connectOverCDP`, takes the persistent default context,
  explicitly denies downloads with `Browser.setDownloadBehavior`, installs WebRTC removal and
  bounded-observation instrumentation, and only then returns the context to the pool.
- Normal traffic retains the validating proxy, pinned DNS/IP checks, disabled implicit loopback
  bypass, disabled QUIC and WebRTC peer-connection removal. The browser receives only its managed
  HOME, PATH/locale and explicit headed display access. Both X11 and Wayland fields now reach the
  launcher; Wayland-only launches select the native Wayland backend.
- **Service-worker contract changes explicitly:** `connectOverCDP` has no supported persistent-
  context `serviceWorkers:'block'` option. Workers may register and persist. Their egress is
  confined by the mandatory proxy, including workers restored from disk. This is not equivalent
  to a registration block: sites can retain offline content and run worker code. The new actual-
  browser test proves a persisted worker executes, attempts a private fetch, and reaches zero
  private targets. No private Playwright options, speculative CDP interception or ephemeral
  context is used to pretend otherwise.
- `launch.ts` persists a starting marker before spawn and the actual child/group identity as soon
  as spawn returns. Shutdown uses CDP **`Browser.close`**, not merely Playwright disconnect, then
  owned-group TERM/KILL if needed. It proves child/group exit before releasing the profile;
  uncertainty retains the marker. Only groups created by the live launcher can be signalled.
  Restart reconciliation probes the group separately from its leader: a dead leader does not
  authorize reuse while descendants survive.
- Cookies/site storage persist. Session/crash-tab restoration is suppressed so a new process
  starts blank; tabs remain across turns while the process stays alive. The existing resource
  pool remains the session owner. The small live-process exit-hook set is only for reaping,
  never a source of profile/Agent authorization or restart adoption.
- Same-OS-user processes are not isolated from the browser profile or loopback CDP capability.
  The endpoint stays out of worker inputs, status, logs and the web gateway. SIGKILL of the daemon
  can still leave a browser requiring the existing fail-closed recovery procedure.

## Evidence

Source changes remain uncommitted in the existing story working tree. Test fixtures use synthetic
content/cookies and isolated scratch profiles, not operator accounts.

| Check | Result |
| --- | --- |
| `pnpm test` | 2,096 passed, 35 skipped; 258 passed files, seven skipped files. Opt-in browser lanes are not counted as passes here. |
| `pnpm typecheck` | Root and web passed. |
| Targeted Biome checks and `git diff --check` | Passed; no remaining test-owned browser processes after the final lanes. |
| `pnpm security:acceptance` | 190 required adversarial cases passed (six new direct-launch cases; existing cases retained). |
| `BAZILION_TEST_BROWSER=1 pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts` | 11 adapter checks passed before adding the separately gated headed check. Installed Arch Chromium 152.0.7977.82. |
| Same suite with `BAZILION_TEST_BROWSER_HEADED=1`, X11 display supplied | 12 passed, including an actual local headed offline window. |
| Same suite with `DISPLAY` empty and only Wayland/runtime display supplied | 12 passed, including native Wayland headed startup. |
| `BAZILION_TEST_BROWSER=1 pnpm vitest run apps/cli/test/browser-research.test.ts` | Two passed: daemon/worker/tool journey and cancellation/process cleanup. Canned model, not live Agent judgment. |

The adapter lane checks direct-spawn argv, sandbox, secret-free environment, owned CDP launch,
private HTTP/iframe/WebSocket/popup denial, zero WebRTC UDP, download denial, persistent cookies,
persisted-worker proxy confinement, marker/lock handling, crash recovery and bounded cleanup.
Unit tests additionally cover forged endpoints, foreign/wildcard listeners, startup failure,
startup timeout/termination escalation, uncertain cleanup without a singleton lock, display
forwarding and surviving process groups. Six named cases were added to the security manifest.

## Subsequent live retry (2026-09-28)

At the operator's request, the corrected adapter ran one headed Google query at
13:43:47–13:44:24 UTC with the normal SSRF proxy. Google displayed its unusual-traffic
interstitial; no result/source was read and no challenge action or reload occurred. Direct
startup/CDP, headed mode and proxy posture were verified from the owned child. Browser, proxy
and temporary-profile cleanup succeeded. This used a fresh isolated profile, not an established
OpenClaw session. See [the qualification log](BAZ-069-acceptance.md) for the precise evidence.
That unassisted attempt remained incomplete; the new launch method alone did not avoid the
challenge.

A subsequent attempt at **14:15:10–14:18:42 UTC** completed **Google → NASA** in the same managed
session after the operator manually handled the CAPTCHA and cookie dialog. The assistant used
bounded/scoped observations, clicked the NASA result, verified the source tab URL, and read
<https://www.nasa.gov/mission/artemis-ii/>. A transient post-click snapshot failure was recovered
by observing the resulting tab, not replaying the click. Browser/proxy/profile cleanup succeeded.
This meets the successful-journey evidence requirement **with human assistance**; independent
T18(a) acceptance remains pending. It does not establish unattended search or future freedom from
challenges. Full timestamps, source excerpts and limitations are in the qualification log.

## Still outstanding

- Operator disposition of the reviewed remediation and explicit service-worker contract. The
  independent reviewer found no remaining blocker in scope; regression conditions passed.
- Operator disposition of the successful **human-assisted** T18(a) evidence; the independent
  reviewer recommends evidence acceptance. Unattended Google access and persistence of human
  verification across browser restarts remain unobserved.
- Separately authorized T18(b) real ordinary Agent/model qualification.
- macOS execution/ownership/shutdown qualification, UI interaction qualification, and a fresh
  packed-installer run for this adapter. The older packed-install result belongs to the previous
  implementation. Windows direct process ownership remains unsupported and fails closed.
- Release approval. Local window operation and offline test success are not site-access evidence.
