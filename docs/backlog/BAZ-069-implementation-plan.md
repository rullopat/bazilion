# BAZ-069 — implementation handoff

## Current scope — native search revision (operator approved 2026-09-30)

The [revised story](done/BAZ-069-browser-backed-default-web-search.md) replaces browser-driven
**default discovery** with configured provider/native OpenAI search. Existing managed browsing
remains separate and optional with every launch/ownership/SSRF/freshness invariant intact.
**The revised T18(b) source journey was independently accepted on 2026-10-03**;
current Linux package/CLI/web checks pass; **operator acceptance and T18/story close-out
were recorded on 2026-10-03**.
The source gate requires subscription-native search →
guarded official source read → cited answer → clean same-attempt `done`, with browser tools absent.
No historical browser failure or diagnostic becomes a pass. This scope approval is not spend,
provider compatibility, runtime implementation, review acceptance or a new live authorization.

**Complete:** operator accepted the changes and moved BAZ-069 to done on 2026-10-03.
API-key mode remains experimental/unqualified; release/publication is separately authorized. [Independent evidence acceptance and current
Linux packed/CLI/web checks](BAZ-069-evidence-and-packed-closeout-20261003.md) are complete.
`openai-codex:gpt-6.1-sol` / medium completed one native search, five guarded NASA reads and a
source-grounded cited answer on unchanged reviewed pins. Authorization exhausted; no further
live call implied. T18.N1–N5 implementation/reviews/regressions are complete; see
[implementation evidence](BAZ-069-native-search-implementation.md). T01–T17, D1–D6 and prior
reviews remain browser provenance/regression obligations, not native qualification substitutes.
D7 is the current default-search contract. [Current checkpoint](BAZ-069-t18b-active-remediation.md)
· [OpenClaw investigation](BAZ-069-openclaw-native-search-investigation.md).

## Historical browser implementation and attempts (2026-09-25–30)

The following dated account preserves its original browser-only disposition. Requirements to
submit browser searches there are superseded only by the explicit scope revision above;
security requirements and failed/assisted results remain unchanged.

> **2026-09-28 architecture correction:** the operator clarified that direct local installed-browser
> startup followed by CDP attachment is a requirement, not merely a visible-window preference.
> The amended D1–D3 below and [direct-launch amendment](BAZ-069-direct-launch-amendment.md)
> supersede the prior Playwright-owned launcher contract. Earlier checked tasks and gate acceptances
> are historical evidence for that adapter, not acceptance of this replacement. Adapter/lifecycle
> review is reopened; live qualification remains incomplete. The first corrected-adapter live
> retry (2026-09-28 13:43:47–13:44:24 UTC) used headed direct/CDP launch and the normal proxy,
> but Google displayed its unusual-traffic interstitial. No source was read; cleanup succeeded.
> A subsequent attempt at 14:15:10–14:18:42 UTC completed Google → NASA after the operator
> manually handled CAPTCHA and cookie consent in the same session. T18(a)'s successful-journey
> evidence is now present **with human assistance**. See [the attempt record](BAZ-069-acceptance.md).
>
> **Review remediation complete in the reviewed scope.** The initial five findings and subsequent
> capacity, uninstall, freshness/capture and shadow-root follow-ups are fixed. [Final independent
> re-review](BAZ-069-review-remediation.md) found no remaining blocker and recommended conditional
> acceptance; all regression conditions subsequently passed (2,118 tests, 207 security cases,
> 16 X11 and 16 Wayland browser checks, two canned workflow checks, typechecks and targeted Biome).
> This is not operator/release approval. T18(a) remains historical human-assisted evidence;
> the operator authorized subscription-only T18(b), then handled Google consent. The real Agent
> researched NASA and delivered a cited answer, but its terminal completion frame failed. See
> [live evidence](BAZ-069-t18b-evidence.md) and [reviewed R10/R11 fixes](BAZ-069-t18b-remediation.md).
> Regression conditions passed. [Attempt 2](BAZ-069-t18b-retry-evidence.md) then handled Reject all
> autonomously and completed with a valid `done`, but Google blocked the search before any source
> was read. [Attempt 3 / Bing](BAZ-069-t18b-bing-evidence.md) then produced a valid 1.86 MB terminal
> frame but exposed **R12**: whole-document preflight/native-main-only fallback could not expose
> a visible consent control. [R12 fixes and independent re-review](BAZ-069-r12-remediation.md) now
> pass regressions (2,143 tests, 232 security cases, 21 browser checks per display lane). A new
> authorized successful live research journey remains required. A [post-R12 Bing retry](BAZ-069-t18b-bing-r12-retry-evidence.md)
> ran but stopped after stale pre-dispatch search refusals/ambiguous dialogs; no NASA source was read.
> A [final authorized Bing trial](BAZ-069-t18b-final-attempt.md) used a fresh isolated OAuth
> setup but stopped at `browser_status`: the test daemon's scrubbed environment omitted the
> display variables needed for explicit headed mode. No Bing request or source read occurred.
> Its valid `done` and credential cleanup do not qualify T18(b). The subsequently authorized
> [headed retry](BAZ-069-t18b-headed-retry-evidence.md) reached Bing, but a page mutation refused
> the search submission; a cookie prompt offered `Reject`, which its own text says declines
> the optional uses, but the trial prompt over-restricted the label to `Reject all`. A later
> operator screenshot corroborated that wording. The Agent stopped without choosing consent
> or reading a source. A full successful research journey
> remains required; no further retry is authorized by these records. A subsequent
> [offline remediation](BAZ-069-t18-offline-remediation.md) clarified consent wording and
> pre-dispatch stale refusals, and passed local/browser/security regressions. It is not live
> source-reading evidence or independent acceptance. A later explicitly authorized
> [post-offline live attempt](BAZ-069-t18b-post-offline-live-evidence.md) on the fifth reviewed
> candidate understood delegated Reject, but search and both Reject clicks were refused stale
> before dispatch. It completed a clean blocker report in eight browser calls, with no submitted
> search or NASA source reading. T18(b) remains incomplete; no second turn was run.
> The subsequent [dialog-target prototype](BAZ-069-dialog-target-prototype.md) is dormant and
> read-only; [independent review](BAZ-069-dialog-target-prototype-review.md) says **DO-NOT-ENABLE**
> because its equivalence predicate has false positives. Production stale refusal is unchanged.
> T18(b) is now explicitly [active blocking engineering](BAZ-069-t18b-active-remediation.md), not
> deferred. The [publication/native-binding prerequisite](BAZ-069-t18b-publication-remediation.md)
> passed fresh narrow AI review and regressions; no action fallback or live pass is claimed.

**Historical status before the architecture correction:** T01–T17 are implemented; **Gates A and B were accepted by the operator (2026-09-25), and Gate C was accepted by the operator (2026-09-26)**. The managed browser pool, bounded observations, identity-bound IPC, conditional operating guide, lifecycle ownership, deterministic offline journey, security manifest, operator docs, and packed-install regressions are implemented. Four operator-authorized T18(a) attempts did not qualify live browsing: one returned an empty observation, two stopped at explicit bot/challenge barriers, and one headed Google window displayed an unusual-traffic interstitial. All stopped without challenge interaction and cleaned up. T18(a) success and T18(b) remain incomplete; this is not a release or live-site qualification.

[Story](done/BAZ-069-browser-backed-default-web-search.md) ·
[Observed baseline](../testing/baz-069-browser-research-evidence.md)

This is the ordered task list for implementing the story in small, reviewable changes. The story
owns product scope; this document fixes implementation choices and completion gates. Do not treat
a checkbox here as permission to run paid/live services or change protected-turn admission.

## How to execute this plan

- For the current revision start with **T18.N1**, not a second implementation of T01–T17.
  Work one task at a time; each task includes tests. Historical browser tasks below retain their
  evidence and become regression inputs whenever the new integration touches those surfaces.
- Read the listed existing files and their tests before editing. Paths below are repository-root
  relative. New filenames are explicitly marked **new**; they do not describe existing APIs.
- When a task completes, change its checkbox, record the commit/diff identity, commands/results
  and remaining limitations under that task. A skipped test is not a pass. Keep the observation
  record separate from implementation acceptance.
- Stop at a review gate until an operator or reviewer other than the implementing agent accepts
  the evidence. If a specified public API cannot implement the contract, report the exact
  obstruction; do not invent a private Playwright API, relax policy or switch architectures.
- Ordinary host-trusted tools are not a filesystem sandbox. Profile permissions/placement prevent
  accidental disclosure and protected mounts; they do not hide cookies from a malicious process
  running as the same OS user. Do not claim otherwise.
- No new DB schema, scheduler, runs/events layer, browser registry, remote CDP service, automatic
  provider fallback, general recovery engine or compatibility adapter is needed.

## Fixed implementation decisions

### D1. Filesystem ownership and restart policy

Add `Paths.browsersDir = <home>/browsers` and `Paths.browserDir(agentId)` for the canonical
`<home>/browsers/<agentId>` slot. The browser's `user-data/` is a child of that slot. This is
**outside both Agent inputs and Team workspaces**; do not put it under `agents/<id>`.

Use an owner-only slot (0700) and daemon metadata files (0600), no followed symlinks. Resolve the
canonical Agent id in the daemon, not from a worker-supplied path. `profile.json` records format
version, Agent id and Team id. `owner.json` is a bounded, atomically written active-launch marker
with launch nonce, daemon instance id, phase and the directly spawned child pid/process-group id.
Persist the marker before launch and record the child identity immediately after spawn. It contains no
page URLs, cookies or debugging credentials.

Reuse `resources().browsers` for **live ownership**; the marker is restart evidence, not a second
scheduler/registry. Keep the slot reserved while starting/stopping. Clean close removes the
active marker only after Chromium itself exits, the owned process group is absent and the profile's
singleton lock no longer names a live/unknown owner; profile metadata stays. A CDP client disconnect
is not browser retirement. Probe the process group, not merely its leader PID.

After a daemon crash, never attach to or kill an old process merely because a file contains a
PID/port. An active, malformed or uncertain marker yields `recovery_required`, with no launch,
profile deletion, lock removal or backup inclusion. Reset may proceed only after the old owned
process/group is positively absent and the canonical slot is safely claimable; unknown, permission
errors and PID reuse remain refused. Absence is established by **reading** (never deleting) the
profile's Chromium singleton lock and probing its named pid, or by finding no process holding the
canonical slot path in its argv — never by broad process-name matching. An incomplete pre-launch
marker can require manual recovery.
There is no automatic crash replay or promise of seamless recovery. Graceful restart is supported.

Team mismatch on `profile.json` blocks browser admission even if lifecycle cleanup was interrupted.
Reset never follows Chromium's internal symlinks to their targets. Do not implement broad process
name matching, `pkill`, or deleting Chromium singleton locks as a recovery strategy.

### D2. Public state, configuration and limits

Define hermetic wire types in **new** `packages/api-types/src/browser.ts`, exported from its barrel:

- `BrowserStatus`: `agentId`, `enabled`, `availability`, `state`, `profilePresent`, optional
  `selectedBrowser`, optional `reasonCode`, and bounded operator `remedy` text.
- `availability`: `disabled | configured | unavailable`. **Configured is not a live-site check.**
- `state`: `stopped | starting | running | stopping | recovery_required`.
- `selectedBrowser`: safe display name, source (`configured | installed | bundled`), resolved
  mode (`headed | headless`), optional last-observed version. No absolute path/CDP address.
- Closed reason codes: `browser_disabled`, `browser_not_found`, `browser_invalid_executable`,
  `browser_display_unavailable`, `browser_incompatible`, `browser_start_failed`,
  `browser_start_timeout`, `browser_security_unavailable`, `browser_busy`,
  `browser_capacity_reached`, `browser_recovery_required`, `browser_observation_expired`.
  Keep existing `agent_turn_active`/authentication errors rather than duplicating them.

Status is read-only and does not spawn a browser, run `--version`, fetch a site or unlock a profile.
It reports cached observations and filesystem/config resolution; version may be absent.

`BROWSER_EXECUTABLE_PATH` is a plaintext browser-service setting, operator-owned, absolute and
executable. No arbitrary additional argv setting. Explicit invalid selection fails; discovery
uses Chrome → Brave → Edge → Chromium → already-installed full bundled Chromium. No headless-shell
substitution or browser download. Resolve supported platform locations in one module; tests pin
ordering instead of depending on the developer machine's PATH contents.

Preserve explicit headless booleans. Unset mode selects headed for a Linux display environment
(`DISPLAY` or `WAYLAND_DISPLAY` with its required runtime environment); otherwise headless. On
macOS, GUI-session detection requires its own tested platform adapter; do not infer a desktop
from `process.platform` alone. Unsupported detection fails with a remedy to set the mode explicitly.
A selected headed launch that cannot reach the display fails, never retries headless.

Fixed initial limits (not new operator tuning knobs):

| Item | Bound |
| --- | --- |
| Startup: direct process + owned listener verification + CDP attachment + guards | 15 s |
| Version probe inside startup | 2 s, within the 15 s budget |
| Graceful CDP `Browser.close` and owned child/group exit wait | 5 s |
| Escalation for the group created by this live launch only: TERM, then KILL/exit confirmation | 2 s + 1 s |
| Total retirement, including client disconnect and lock confirmation | 9 s; unresolved becomes `recovery_required` |
| Shared proxy close, after retiring browsers | 2 s, including tracked tunnel destruction |
| Existing navigation / interaction deadlines | 30 s / 10 s |
| Tabs / active sessions / idle timeout | 8 / existing configurable cap (default 4) / existing 15 min default |
| Returned browser text, including metadata | 32 KiB UTF-8 per tool result |
| Captured observation / lifetime | 512 KiB / 5 min; one current capture per session |
| Decoded screenshot | 8 MiB; refuse with a remedy if exceeded, no silent image truncation |

Timeout timers alone are insufficient: cancelled/timed-out operations must not later publish a
session or return a successful action after the owner has retired it.

### D3. Launcher, transport and egress

Directly spawn the validated installed executable on the Agent's persistent local profile, with
Bazilion-authored arguments and a scrubbed environment. Then attach Playwright through
`chromium.connectOverCDP` to the persistent default context. No Playwright launch defaults,
ephemeral replacement context, personal-profile attachment, or automatic alternate launcher.
Use a nonzero reserved loopback port; read only the fresh child's bounded stderr endpoint and
verify the listener belongs to that child before connecting. Never adopt a stale port file or
remote endpoint. Linux uses socket-inode ownership; macOS uses bounded child-specific `lsof`
inspection and remains unqualified. Same-OS-user local access is outside this isolation guarantee.
Start at `about:blank`, suppress session/crash-tab restoration while retaining cookies/storage,
and install controls before handing the session to the pool. Explicitly deny downloads through
CDP after attachment. Do not pass undocumented service-worker options or mutate private APIs.
The daemon owns child/group shutdown: CDP `Browser.close`, then bounded owned-group TERM/KILL
and exit confirmation. CDP `browser.close()` alone only disconnects. Normal daemon shutdown and
standalone signal/exit hooks retire owned processes; SIGKILL remains the D1 recovery case.

The browser receives an allowlist environment for PATH, locale, OS display/runtime access and
its managed HOME. Do not pass provider keys, proxy env vars, credential stores or an ambient
personal browser home. TMPDIR is deliberately **not** managed: Chromium's process-singleton
socket path is capped by `sockaddr_un.sun_path` (~104 bytes), and a TMPDIR inside the owned slot
aborts deep-path launches at startup (T06-verified 2026-09-25); the system temp dir hosts only
the ephemeral, per-instance socket. XAUTHORITY/display access is explicit; managed directories stay
inside the owned browser slot. Pin the exact argv/env in tests. No sandbox-disable, extension,
stealth, fake-UA or arbitrary remote-attachment options.

The existing proxy remains mandatory in normal mode, with the implicit loopback bypass disabled.
HTTP(S)/WS(S) must use validated pinned connections; direct UDP/QUIC/WebRTC and non-HTTP
navigation must not create alternate private-network access. Concretely (T01-verified
2026-09-25): `--disable-quic` denies a direct-UDP page-load path; **WebRTC is denied by
removing the P2P API outright** — the strictest IP-handling policy (`disable_non_proxied_udp`)
is proven insufficient (a page-injected remote candidate drove 65 STUN binding requests to a
loopback listener with and without the flag), so a supported context init script removes
`RTCPeerConnection` from every document and frame, registered at launch before any page is
exposed (the pre-registration initial page is replaced with a fresh covered document). Workers
expose no P2P API; this is capability removal, not stealth. The adversarial test asserts zero
loopback UDP datagrams under the posture and demonstrates the exposure without the controls.
Unknown/unsupported enforcement refuses startup.
Deny downloads and external protocol launches; initial `about:blank` is an internal launch state,
not a general model permission to navigate non-HTTP schemes. Cover popups/iframes and human-opened
tabs in the managed browser, not just the `navigate` switch case.

**Amended gate (2026-09-28):** direct/CDP launch is now required. Its public API cannot enforce
Playwright's prior service-worker registration block. The explicit replacement contract permits
worker registration/persistence while requiring all worker network egress to traverse the mandatory
proxy. Test an actually running persisted worker after restart, attempting a private fetch, with
zero requests at the private target. This is not a cold-start registration-block claim. Retain the
WebRTC capability removal (workers expose no peer-connection API), QUIC denial, native sandbox,
explicit download denial and secret-free child environment. The previous adapter's acceptance
cannot qualify this change; fresh independent adapter/lifecycle review is required.

### D4. Pool transitions and turn ownership

Normal transitions: `stopped → starting → running → stopping → stopped`. An unproven retirement
or stale restart marker transitions to `recovery_required`; further launch/reset is refused until
absence/ownership is established. Startup failure with proven cleanup returns `stopped` plus a
reason; partial failure with uncertain cleanup does not.

Use the existing Agent lifecycle lease for operator mutations; serialize browser operations per
Agent inside the existing resource pool. Turn hosts capture authoritative Agent id, admitted Team
id, frozen browser configuration and AbortSignal. Validate identity against that binding on every
IPC call; never select a profile from worker arguments. Preserve spawner denial for protected and
restricted kinds. Compare the existing admission behavior rather than broadening any turn kind.

Configuration changes retire the old session before next admission. Cancel retires the affected
Agent browser and invalidates outstanding observations; it must not shut down the shared proxy
or another Agent's browser. Reaping/eviction skips in-flight operations; at capacity with every
session busy, refuse. A stopping slot counts toward capacity until retirement is proved.

### D5. Bounded observations: choose frozen paging, not arbitrary selectors/evaluation

Keep existing tool names. Extend `browser_snapshot` with mutually exclusive optional `ref` and
`cursor`. No args captures the active page; `ref` scopes to a ref from the current observation;
`cursor` reads the next page of **the same frozen observation**, not a fresh live snapshot.

Every snapshot/action result names an opaque `observationId`, stable session-local `tabId`,
capture time, and explicit `truncated`/`hasMore`; it includes a `nextCursor` when retained text
remains. Pagination uses UTF-8-safe, preferably line-aligned chunks inside the response bound.
A capture larger than 512 KiB stays incomplete even after the last retained chunk; report that
fact and offer ref scoping or a narrower source, never "complete".

Cursor records are daemon-memory-only, random, Agent/session/tab/generation-bound and expire after
five minutes. New capture, navigation, tab switch/close, browser retirement or a mutating action
invalidates previous cursors. Track DOM mutation during capture/continuation; if the current page
no longer matches the captured generation, return `browser_observation_expired`. Bound capture
work too: detecting an oversized DOM must not allocate an unbounded serialized snapshot first.
T01 must verify the available capture API or identify a supported bounded alternative.

Use stable session-local tab ids in `browser_tabs` selection/close, replacing positional `index`
arguments rather than adding a compatibility alias. Require the current `observationId` on ref
interactions (click/type/hover/select/fill); reject cross-tab/stale observations before acting.
Trusted internal page instrumentation for bounds/generation is allowed; model-supplied JavaScript,
selectors, file paths or arbitrary `evaluate` remain unavailable.

Action timeouts can happen **after** an effect. Remove the existing claim "The page was NOT changed
by this call." Report uncertain effect and resnapshot; never automatically replay a submission.
Guide-driven blocker recognition is model behavior, not a deterministic CAPTCHA classifier or a
new runtime authorization gate. Test runtime denials separately from model judgment.

### D6. Management, destructive operations and disclosure

Use the story's GET status / POST stop / DELETE profile endpoints. Status requires `read`; stop
and reset require `write`, with existing session/CSRF enforcement. Reset requires exact JSON
`{confirm:true}`. CLI reset prompts unless `--yes`; web uses `ConfirmDialog`. The model has only
read-only `browser_status`, never stop/reset. Stop/reset during an active turn return 409
`agent_turn_active`; the existing cancel endpoint remains the way to cancel a turn.

Delete/archive/Team transfer must retire the browser under the Agent lifecycle lease **before**
committing a lifecycle mutation. Delete/transfer also clear the profile; archive retains it but
prevents browser admission until unarchived in the same Team. Check canonical revision/membership
preconditions before clearing, then revalidate during the DB mutation. Do not promise atomic DB
and filesystem rollback: if a later DB conflict occurs after clearing, report the mutation failure
and that browser state was cleared. Unknown cleanup refuses the lifecycle mutation.

Exclude the exact root `browsers/` slot from backup, including metadata/locks/artifacts; do not
exclude arbitrary Team folders with that name. Restore rejects archives containing browser state
rather than importing account sessions. Reset-tier uninstall removes this root only after existing
home ownership checks plus browser-owner reconciliation; a surviving orphan is not permission to
unlink its active profile. No new CLI runtime import of daemon internals.

### D7. Native discovery contract (2026-09-30, implemented experimentally; live qualification pending)

Use the story's single route decision: disabled/denied → explicit route → existing configured
Brave then SearXNG → supported current-Agent OpenAI/API or subscription native route →
unavailable. No execution fallback, browser requirement, endpoint impersonation or silent
account/model replacement. This deliberately preserves existing configured-backend precedence
rather than copying every upstream OpenClaw default.

New native search is a daemon-owned query-only host, bound to the admitted Agent/Team/turn;
workers receive no credential/endpoint authority. Reuse existing secrets/config and OAuth
refresh ownership. Native payloads may include only hosted search, not shell/MCP/browser/peer/
filesystem or a general auxiliary Agent. Native provider networking is **not** proxy-guarded
browser networking. Protected/restricted/scheduled/inbox admission stays unchanged.

Fix limits at query 512 chars, 1–8 citations/results, 30-second deadline, 2 MiB consumed upstream,
32 KiB return, 2 KiB/citation URL; stream bounds, abort retirement and safe diagnostics are
required. Require actual hosted-search execution plus successful terminal provider evidence,
bounded validated citations and explicit cached/live facts where supplied. Text-only completion,
missing evidence or incomplete response is not search success. Use guarded `web_fetch` to prove
source reading; provider citations alone cannot do that.

Choose a narrow direct Responses adapter first for official API and existing subscription
transports. Unknown model/transport support fails closed. A direct-route obstruction requires
review/decision before any private app-server alternative; no general harness/runtime migration.
Native receipt types belong in hermetic api-types and canonical tool/session evidence, not a new
runs/events store. Configuration and CLI/web status show account type, model, route and bounds,
never secrets or an unobserved “works” badge.

## Task checklist

The completed entries below preserve the original implementation record. For T01/T05/T06/T07
launcher/egress/lifecycle changes, the amended D1–D3 and
[2026-09-28 amendment](BAZ-069-direct-launch-amendment.md) are now authoritative; prior checkmarks
and gate acceptances must not be read as acceptance of the replacement adapter.

### Slice A — prove the adapter boundary and establish contracts

- [x] **T01 — adapter verification suite (re-scoped 2026-09-25; Gate A resolved by operator decision)**
  - **Status (2026-09-25): COMPLETE, pending Gate A review.** Built and green: 10/10 passing,
    stable across 3 consecutive runs (~16.4 s each).
  - **Files:** `apps/daemon/test/lib/browser-managed.integration.test.ts` (new),
    `apps/daemon/test/fixtures/browser-managed.ts` (new — encodes the pinned posture T06 must
    implement; switch it to import the production launcher when T06 lands). Plus the proxy-close
    fix this lane forced (recorded under T05 partial).
  - **Commands/results:**
    - `BAZILION_TEST_BROWSER=1 pnpm vitest run
      apps/daemon/test/lib/browser-managed.integration.test.ts` → 10 passed, 3 consecutive stable
      runs. Without the gate → skipped with a reason; with the gate and no browser → fails.
    - `pnpm typecheck` → clean. Biome on the new files → 0 errors (14 warnings: test non-null
      assertions/console logs). `pnpm lint` repo-wide → 15 pre-existing errors in untouched files
    (cli tests, review-packets, publication, coding-environment) — none introduced here.
    - Focused regression: `pnpm vitest run <browser + config/paths suites>` → 73 passed across
      9 files (incl. the previously flaky `browser-live` screenshot test).
  - **Observed and pinned (recorded beside the tests, full argv logged by the argv test):**
    executable `/usr/bin/chromium` (152.0.7977.82) → exec'd binary `/usr/lib/chromium/chromium`
    (Arch wrapper script), no headless-shell; no `--no-sandbox`, zygote present; `chromiumSandbox`
    on; `--remote-debugging-pipe`, **no port**, no `DevToolsActivePort` file;
    `--proxy-server=<ssrf>` + `--proxy-bypass-list=<-loopback>`; authored denials
    `--disable-quic` + `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`;
    `--user-data-dir=<slot>/user-data`; env allowlist PATH/HOME/LANG/TMPDIR (+ Arch wrapper's
    `CHROME_*` vars, documented) with a planted provider secret absent and no proxy vars;
    `navigator.webdriver` stays **true** and the native UA stays `HeadlessChrome/152` (no
    rewrite); loopback HTTP/iframe/WebSocket/popup → **0 instrumented hits**; WebRTC/UDP →
    **0 datagrams with the P2P API removed** (the probe fails with the API gone; the control arm
    asserts the exposure — 65 binding requests without the controls); SW cold start incl. across
    graceful restart → 0 workers, 0 registrations,
    `sw.js` never fetched, no `Service Worker` dir on disk; cookie persisted across restart;
    0 surviving owned processes after close; downloads dir empty (acceptDownloads false);
    `ariaSnapshot` on a 2500-paragraph DOM captured fine (byte bound must be a daemon-side
    wrapper — T08).
  - **Playwright default argv observed (not authored by us, pinned for the record):** includes
    `--disable-dev-shm-usage` (Linux default), `--disable-features=…`, `--use-mock-keychain`,
    `--enable-unsafe-swiftshader` (software-GL fallback), `--headless` for this lane; **no**
    `--enable-automation`. No security-weakening default found; none removed via
    `ignoreDefaultArgs`.
  - **Limitations (honest):**
    1. Headless-lane evidence only; GUI-dependent checks need a provisioned display (separate
       lane, per the plan).
    2. WebRTC/UDP: the launch flag alone is **proven insufficient** — 65 STUN binding requests
       reached a loopback listener with AND without
       `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` (a page-injected remote
       candidate drives the checks; the policy governs gathering, not checks). Denial is layered:
       the flag (gathering) plus a supported-context init script that removes `RTCPeerConnection`
       from every document/frame, registered at launch before any page is exposed (the
       pre-registration initial page is refreshed; dynamically created iframes verified covered).
       The managed arm asserts the probe fails with the API gone and 0 datagrams; the control arm
       asserts the exposure (>0). Capability removal via trusted instrumentation, not stealth.
       An earlier version of this note said the control arm "also observed zero datagrams" — that
       was recorded from a probe script that never executed (see limitation 5) and is superseded.
    3. QUIC denial is argv-pinned (`--disable-quic`); no HTTP/3 instrumented probe (would need
       an H/3 fixture server).
    4. Chromium rewrites child cmdlines into single synthetic strings — child-process assertions
       match the joined cmdline (documented in the fixture).
    5. Playwright's `page.evaluate(string)` treats a string starting with `async (x) => {` as an
       **expression** (the function object, serialized as `undefined`) rather than a function to
       call — in-page probes must use self-invoking IIFE expressions. The operator's review run on
       2026-09-25 surfaced this (`results: undefined`): three probes had silently never executed
       and the WebRTC tests had passed vacuously. All probes are IIFEs now; T08 must keep this in
       mind.
  - **Gate A: ACCEPTED (operator, 2026-09-25).** The operator independently ran the lane twice
    (16:32 — which surfaced the vacuous-probe defect — and 16:47 post-fix, 10/10 with real values)
    and explicitly accepted the posture with "proceed with T05 and the rest". The accepted
    posture: installed binary honored, sandbox on, pipe transport (no debugging port), scrubbed
    env, native UA with `webdriver` visible, mandatory proxy with loopback bypass disabled and
    zero instrumented hits, service-worker cold start across restart, no P2P capability, downloads
    denied, Playwright-owned child reaping. T05/T06 proceed under this acceptance.
  - **Operator observation (2026-09-25, 16:32 and 16:47 UTC, post-probe-fix):** the operator
    independently ran the lane twice on the operator's own terminal. The 16:47 run — 10/10 with
    the real probe values — showed: loopback egress
    `{"fetch":"status:0","iframe":"loaded","websocket":"error"}` (note: `status:0` is the
    opaque no-cors response and `iframe:loaded` is the proxy's 403 error page rendering — the
    security assertion is the fixture's **zero hits**, which held); managed WebRTC
    `["error:TypeError"]` (P2P API gone); control arm **65 datagrams** (exposure demonstrated);
    ariaSnapshot **281,756 bytes** on the big DOM. Recorded as Gate A review input; explicit
    acceptance still required before T06.
  - **Blocker (2026-09-25, Node 26.7.0, Playwright 1.61.0, installed Arch Chromium
    152.0.7977.82):** the mandatory persistent-context service-worker restriction cannot be
    established with the supported public interfaces. `ConnectOverCDPOptions` has no
    `serviceWorkers` field; `browser.newBrowserCDPSession()` +
    `Target.setAutoAttach({autoAttach:true,waitForDebuggerOnStart:true,flatten:true})` plus
    `Target.closeTarget` on each `service_worker` attachment did **not** prevent registration or a
    persisted worker (`navigator.serviceWorker.getRegistrations()` still returned 1; Playwright's
    `context.serviceWorkers()` still listed 3). An init-script patch alone is explicitly
    insufficient in the plan (persisted workers at restart, page-tamperable). Per the plan this is
    a design decision, not a T01 check-off: no silent ephemeral-context substitution and no removal
    of the service-worker requirement.
  - **What did work (raw spike, not committed as a passing adapter test):** direct `spawn` of the
    installed binary with `--remote-debugging-port=0`, `--user-data-dir=<slot>/user-data`,
    `--headless=new`; reading `DevToolsActivePort`; `chromium.connectOverCDP(http://127.0.0.1:port)`;
    default persistent context reachable via `browser.contexts()[0]`; a synthetic cookie survived
    close/relaunch; CDP `Browser.close` produced child exit code 0 (Playwright `browser.close()` did
    **not** exit the child within 5 s). Spike scripts were throwaway (`/tmp`), not product tests.
  - **Upstream corroboration (recorded 2026-09-25, read-only source inspection):** the pinned
    OpenClaw snapshot `88df612b941d909cf3a3dabdf97ae4d2f71d6491` was fetched into the local bare
    clone at `~/.cache/yay/openclaw-git/openclaw` and grepped. OpenClaw **does** use Playwright
    (`chromium.connectOverCDP(transport, …)` at
    `extensions/browser/src/browser/pw-session-cdp-transport.ts:245`, over a transport it opens
    itself), uses the **persistent default context**
    (`pw-session-actions.ts:489` → `browser.contexts()[0] ?? await browser.newContext()`), and has
    **zero** `serviceWorkers` occurrences under `extensions/browser/src` and zero in non-test
    production code repo-wide — every hit is a UI/e2e test for its own web UI. `launchPersistentContext`
    is test-only. Its default egress is `--no-proxy-server` (direct), it inherits the ambient env
    minus proxy vars (`chrome.ts:1071`), and `--no-sandbox` is available. **There is no upstream
    mechanism to copy.** Full citations and method:
    `docs/testing/baz-069-browser-research-evidence.md` § "Follow-up source inspection (2026-09-25)".
  - **Returned design question:** what supported persistent-default-context mechanism (or reviewed
    equivalent) enforces the service-worker denial the current ephemeral `newContext` gets from
    `serviceWorkers:'block'`? Options to weigh:
    1. a Playwright version exposing the option for CDP-attached default contexts;
    2. a Bazilion-authored CDP target interception that actually blocks *persisted* workers
       (unverified candidate: per-worker `Emulation.setScriptExecutionDisabled`, re-applied at
       restart — needs its own spike before it can be claimed);
    3. an explicitly reviewed **egress-only** posture: the mandatory pinned-IP proxy already covers
       service-worker fetch traffic, so name the removed defense-in-depth and its accepted risk.
       Note this remains strictly stronger than the upstream reference, which has no proxy at all by
       default. This is an operator/reviewer policy decision, not an implementer choice.
  - **RESOLVED (2026-09-25, operator decision):** the returned design question was superseded by
    the architecture re-examination. Direct spawn + `connectOverCDP` was abandoned — Playwright
    does not own that child (`browser.close()` did not exit it; spike-verified) — and the operator
    adopted `chromium.launchPersistentContext` with the validated `executablePath`, allowlist env,
    Bazilion args, `chromiumSandbox: true`, `serviceWorkers: 'block'` and the mandatory proxy.
    Spike-verified: explicit binary honored (no headless-shell substitution), sandbox on (zygote
    present), pipe transport (no debugging port at all), Playwright-owned child reaping
    (0 survivors after `context.close()`), service-worker cold start (nothing registered, worker
    script never fetched, nothing persisted to disk, invariant holds across restart), proxy with
    zero loopback hits, cookies persist across restart. Adopted for **reliability and security
    only** — the bounded live re-measurement confirmed that no launch posture, including a fully
    unattached native control, avoids Google's challenge. Gate A now reviews the verification
    suite's evidence, not a design question. Citations: the evidence doc § "Bounded live
    re-measurement" and § "Operator manual baseline".
  - **Depends:** none. This is a verification suite, not replacement of the default pool.
  - **Files:** inspect `apps/daemon/src/lib/browser/{pool,proxy,ssrf}.ts` and resolved Playwright
    public types; add **new** `apps/daemon/test/lib/browser-managed.integration.test.ts` and
    controlled browser fixture helpers under `apps/daemon/test/fixtures/`.
  - **Do (re-scoped):** build the gated actual-browser lane (`BAZILION_TEST_BROWSER=1`) asserting
    the pinned `launchPersistentContext` adapter posture on a provisioned supported binary: argv
    (no `--no-sandbox`, no debugging port — pipe transport, Bazilion args plus pinned Playwright
    defaults), scrubbed env allowlist (no provider keys), native UA (no override), service-worker
    cold-start invariant including across graceful restart, synthetic cookie persistence,
    loopback denial through the SSRF proxy with an instrumented fixture (zero hits), popup/new-tab
    coverage, QUIC/UDP/WebRTC egress denial with an instrumented loopback UDP listener, downloads
    denied, and bounded snapshot capture feasibility for T08. Never make the production guard
    permissive.
  - **Prove:** synthetic cookie survives graceful restart; worker/private fetch/WS/popups/UDP
    cannot bypass controls; unproven controls refuse. No Google/public queries, login or model
    needed.
  - **Done:** record exact argv, executable/version and observed denials beside the tests. A
    stubbed launch or separate ephemeral context is not an adapter pass.
  - **Gate A:** reviewer accepts the verified adapter posture before T06. The original CDP-adapter
    feasibility question is closed by the 2026-09-25 operator decision; this gate now reviews the
    verification suite's evidence.

- [x] **T02 — wire contract, paths and configuration**
  - **Status (2026-09-25):** implemented on the working tree (uncommitted).
  - **Files:** `packages/api-types/src/browser.ts` (new), `packages/api-types/src/index.ts`,
    `apps/daemon/src/core/paths.ts`, `apps/daemon/src/core/services.ts`,
    `apps/daemon/src/lib/browser/config.ts`, `apps/daemon/src/lib/browser/pool.ts`,
    `apps/daemon/test/lib/browser-config.test.ts` (new), `apps/daemon/test/core/paths.test.ts` (new).
  - **Evidence:** `pnpm vitest run apps/daemon/test/lib/browser-config.test.ts
    apps/daemon/test/core/paths.test.ts` → 10 passed; `pnpm typecheck` clean; biome clean. No browser
    process is launched. `BrowserStatus`/state/reason/selection types are hermetic; paths derive from
    canonical home + Agent id; `BROWSER_EXECUTABLE_PATH` registered as a plaintext config field;
    `BROWSER_HEADLESS` help text and the three-way `auto|headed|headless` preference are distinguished.
  - **Limitation:** `resolveBrowserConfig` still passes a legacy `headless` boolean to the current
    bundled adapter (defaulting headless when unset) until T06 consumes `mode`; display resolution is
    not yet wired into admission.
  - **Depends:** D1–D2; may proceed while Gate A is reviewed, without enabling the adapter.
  - **Files:** **new** `packages/api-types/src/browser.ts`; its `index.ts`; daemon
    `src/core/{paths,services}.ts`, `src/lib/browser/config.ts`; corresponding core/config tests.
  - **Do:** add exact state/reason types and browser paths; register executable setting and
    update headless-default/help text. Keep Node/process/browser types out of api-types.
  - **Prove:** canonical home/id-derived paths, invalid values, existing bool handling and unset
    mode distinction. Status serialization excludes full paths, URLs, CDP and profile contents.
  - **Done:** root typecheck and focused config/path tests pass; no browser process is launched.

- [x] **T03 — safe profile ownership and metadata**
  - **Status (2026-09-25):** implemented on the working tree (uncommitted).
  - **Files:** `apps/daemon/src/lib/browser/profile.ts` (new),
    `apps/daemon/test/lib/browser-profile.test.ts` (new).
  - **Evidence:** `pnpm vitest run apps/daemon/test/lib/browser-profile.test.ts` → 21 passed;
    `pnpm typecheck` clean; biome clean. Covers canonical 0700 slots, bounded 0600 metadata,
    exclusive concurrent claim via temp+`linkSync`, symlink/ancestor substitution, Team mismatch,
    malformed/partial markers, live orphan, dead-owner stale reclaim, PID-reuse/EPERM `unknown`
    refusal, pre-spawn marker, same-instance leak, interrupted deletion, symlink-safe removal and
    oversized-metadata refusal.
  - **Limitation:** not yet wired into the pool (T07) or lifecycle routes (T11/T13); the module is a
    pure filesystem/ownership boundary today.
  - **Depends:** T02.
  - **Files:** **new** `apps/daemon/src/lib/browser/profile.ts` and
    `apps/daemon/test/lib/browser-profile.test.ts`; reuse `lib/daemon-liveness.ts` instance identity.
  - **Do:** create/claim canonical slots, atomic bounded metadata, active-marker transitions,
    safe removal and restart reconciliation per D1. No general-purpose lock framework.
  - **Prove:** concurrent claim, symlink/ancestor substitution, Team mismatch, malformed/partial
    marker, PID reuse/permission errors, live orphan, dead owner and interrupted deletion.
  - **Done:** unknown ownership always refuses; no arbitrary PID kill, attach or lock deletion.

- [x] **T04 — deterministic executable and display resolution**
  - **Status (2026-09-25):** implemented on the working tree (uncommitted).
  - **Files:** `apps/daemon/src/lib/browser/executable.ts` (new),
    `apps/daemon/test/lib/browser-executable.test.ts` (new).
  - **Evidence:** `pnpm vitest run apps/daemon/test/lib/browser-executable.test.ts` → 11 passed;
    `pnpm typecheck` clean; biome clean. Covers Chrome→Brave→Edge→Chromium ordering, highest full
    bundled Chromium, no headless-shell substitution, explicit invalid path failure, explicit-wins,
    Linux X11/Wayland/headless display detection, unsupported-platform auto refusal, explicit
    headed-without-display failure, and bounded/cached version observation.
  - **Limitation:** version probing and selection are not yet consumed by status (T13) or the launcher
    (T06).
  - **Depends:** T02.
  - **Files:** **new** `apps/daemon/src/lib/browser/executable.ts` and
    `apps/daemon/test/lib/browser-executable.test.ts`; browser config/service help.
  - **Do:** implement D2 discovery with injectable filesystem/environment probes, explicit-path
    validation, launch-time version probe and display resolution. Cache observations for status.
  - **Prove:** discovery order, invalid explicit path, no installed browser, full bundled fallback,
    unavailable GUI and headless server. No internet or silent executable/mode substitution.
  - **Done:** fixture-driven tests work without any particular browser installed; unsupported
    platform behavior is a tested refusal, not an assumed successful Mac launch.

### Slice B — managed lifecycle, data bounds and turn binding

- [x] **T05 — proxy lifecycle and browser enforcement helpers**
  - **Status (2026-09-25): COMPLETE (Gate A accepted by operator before completion).**
  - **Files:** new `apps/daemon/src/lib/browser/guards.ts` (the production pinned posture —
    denial args, P2P-removal init scripts, allowlist env, launch options, guard installation);
    `apps/daemon/src/lib/browser/proxy.ts` (single-flight startup, tracked sockets, generation
    guard, bounded close, test seams for bind/DNS/dial); `test/lib/browser-proxy.test.ts`
    (+5 lifecycle tests); `test/fixtures/browser-managed.ts` (now imports the production guards
    so the lane asserts the real thing).
  - **Proxy lifecycle:** single-flight `getSsrfProxy` (a close during startup fails closed
    instead of resurrecting a server); every owned socket tracked (proxied clients incl. idle
    keep-alives, upstream CONNECT dials, forwarded-HTTP upstreams); `closeSsrfProxy` destroys
    both sides and settles within the D2 bound; a generation counter invalidates in-flight
    DNS/dials so a pending lookup spanning a close never creates an untracked socket.
  - **Evidence:** `pnpm vitest run apps/daemon/test/lib/browser-proxy.test.ts
    apps/daemon/test/lib/browser-ssrf.test.ts` → 18 passed (single-flight; failed bind rejects
    every concurrent caller then a retry succeeds; close-during-startup fails closed; pending
    DNS spanning a close never dials an upstream and leaves 0 tracked sockets; a half-open
    CONNECT tunnel is destroyed and close settles < 2 s; rebinding still pins the validated IP —
    private CONNECT still 403). The gated lane (`BAZILION_TEST_BROWSER=1`) now tests the
    production guards via the fixture: 11/11 stable across runs.
  - **Depends:** T01 findings; Gate A accepted before claiming complete enforcement.
  - **Files:** `apps/daemon/src/lib/browser/{proxy,ssrf}.ts`;
    **new** `browser/guards.ts`; extend `test/lib/browser-{proxy,ssrf}.test.ts` and T01 fixtures.
  - **Do:** single-flight proxy startup, track client/upstream CONNECT sockets and request
    connections, close both sides, and settle within D2's deadline. Implement the reviewed
    persistent-context/target controls from T01; no untested CDP workaround.
  - **Prove:** concurrent get/close, failed bind, pending DNS, half-open tunnel and delayed connect
    cannot create an untracked socket after shutdown. Rebinding still pins the validated IP.
  - **Done:** proxy tests plus actual-context adversarial cases pass with guards enabled.

- [x] **T06 — owned persistent-context launcher and graceful close**
  - **Status (2026-09-25): COMPLETE.**
  - **Files:** new `apps/daemon/src/lib/browser/launch.ts`,
    `test/lib/browser-launch.test.ts` (7 unit tests via the injectable launcher), and the gated
    lane's real-launcher test (marker/lock bookkeeping, guards, graceful close, SIGKILL crash
    recovery as a new daemon instance).
  - **Behavior:** claim/reconcile the slot (T03, refuses anything not proven clean, reclaims a
    stale marker); refuse a foreign holder of Chromium's singleton lock; persist the owner
    marker BEFORE launch (phase `starting`); launch via the T05 controls and install guards;
    mark `running` with the singleton-lock pid; refuse to launch without a real daemon
    instance identity (a marker saying "unknown" cannot be reconciled at restart — fail
    closed); graceful close is `context.close()` (Playwright reaps the tree) then marker
    removal only after the lock no longer names a live owner within the 5 s D2 bound;
    unresolved retirement leaves the marker (next assessment: `recovery_required`).
  - **Evidence:** unit tests 7/7 (marker-before-launch, running-with-lock-pid, guards installed,
    recovery_required refusal without launching, foreign-lock refusal before any marker,
    proven-vs-uncertain startup cleanup, unresolved close keeps the marker); gated lane 11/11
    stable (real launch: marker `running` with a real owned pid; graceful close: no surviving
    processes, marker cleared, lock gone; SIGKILL crash: marker stays as restart evidence, the
    next daemon instance reclaims it only because the owner is positively absent, relaunch
    works end to end).
  - **Two real defects found and fixed during T06 verification (recorded in the log):**
    1. Chromium's process-singleton socket path is capped by `sockaddr_un.sun_path`
       (~104 bytes): a managed TMPDIR inside the owned slot made deep-path launches
       SIGABRT at startup (`process_singleton_posix.cc` "Socket path too long"). TMPDIR is
       now deliberately NOT part of the allowlist env; HOME stays managed inside the slot.
    2. The launcher's silent `daemonInstanceId: 'unknown'` fallback collapsed
       unknown-vs-unknown to "this instance" at assessment. The launcher now refuses to
       launch without a real identity.
  - **Depends:** T03, T04, T05 and **Gate A** (accepted 2026-09-25).
  - **Do:** implement D3 via `chromium.launchPersistentContext` with pinned options (validated
    executable, allowlist env, Bazilion args, `chromiumSandbox: true`, `serviceWorkers: 'block'`,
    proxy, download denial) and Playwright's default signal handling so normal daemon termination
    reaps browsers. Persist the owner marker before launch; return an owned session handle only
    after controls are ready. Graceful close is `context.close()` (Playwright reaps the child),
    then marker removal once the profile's singleton lock no longer names a live owner.
  - **Prove:** synthetic state survives graceful close/relaunch; abort/start timeout and failed
    enforcement clean up or return recovery-required; a SIGKILL-style crash that orphans the child
    yields `recovery_required` until the singleton lock's named owner is positively absent. Assert
    no merged credentials and no sandbox-disable flag.
  - **Done:** adapter can be called by tests safely; production pool switch waits for T07.

- [x] **T07 — integrate retirement, cancellation and concurrency into the pool**
  - **Status (2026-09-25): COMPLETE.** The production pool launches the managed adapter (T06
    launcher via the T05 controls); the bundled-Playwright ephemeral adapter, its UA rewrite and
    its context-level service-worker option are gone (`BrowserConfig.headless` was removed with
    the adapter; `mode` is the operator preference).
  - **Files:** `apps/daemon/src/lib/browser/pool.ts` (rewritten: D4 entries and transitions,
    per-agent transition queue, busy-aware capacity/LRU, 8-tab cap, posture-fingerprint
    retirement), `lib/resources.ts` (registry type; reaping never touches a busy session;
    ownership dropped only as each retirement settles; shutdown retires browsers first and closes
    the shared proxy last), `lib/agent-turn.ts` + `browser/host.ts` (daemon-owned admission:
    canonical Agent id, admitted Team id and paths captured from the turn, never worker input),
    `test/lib/browser-lifecycle.test.ts` (new), `test/lib/{browser-live,resources}.test.ts`
    (updated to the managed pool), `test/lib/browser-config.test.ts`.
  - **Lifecycle mechanics (D4):** `stopped → starting → running → stopping → stopped` serialized
    per agent (launches and retirements never overlap); a stopping slot counts toward capacity
    until retirement is proved; at capacity with every session busy, admission is refused
    (`browser_capacity_reached`); reaping/eviction skip in-flight work; a `recovery_required`
    slot is refused for every action and never re-launched, is not reaped, and does not hold a
    capacity slot; a configuration/posture change retires the old session before the next
    admission; cancellation retires the affected agent's browser and the in-flight action fails
    honestly; the shared proxy closes only after the browsers are gone.
  - **Evidence:** `test/lib/browser-lifecycle.test.ts` 7/7 (concurrent first use collapses to one
    launch; cancellation during startup retires once the launch settles and the in-flight action
    fails; capacity refusal with all sessions busy then LRU admission; reaper versus action;
    failed close → `recovery_required`, never reclassified, no revival; config-change
    retirement; stopping-slot capacity). Full focused regression 97/97 across 12 files, incl.
    `browser-live` (a real browser through the new pool, stable ×2) and the gated lane 11/11.
    `pnpm typecheck` clean; lint errors unchanged from the pre-existing baseline (15, untouched
    files). The shutdown caller in `src/index.ts` was audited — it calls `shutdownResources`,
    whose ordering is now correct.
  - **Depends:** T06.

- [x] **T08 — bounded snapshots, stable tabs and honest action errors**
  - **Status (2026-09-25): COMPLETE.**
  - **Files:** new `apps/daemon/src/lib/browser/observation.ts`,
    `test/lib/browser-observation.test.ts` (18 unit tests, fake pages — no browser needed);
    `browser/pool.ts` (dispatch rewired); `browser/guards.ts` (the DOM-generation
    instrumentation init script); `runtime/tools/browser.ts` unchanged (the tool surface is
    extended by args, not renamed).
  - **Bounded capture (D5):** every snapshot/action result is a bounded observation — opaque
    `observationId`, stable session-local `tabId`, capture time, explicit truncated/hasMore,
    `nextCursor` when retained text remains; UTF-8-safe, line-aligned chunks inside the 32 KiB
    response bound; retained bytes are always capped at 512 KiB. After review remediation,
    known oversized scopes are not serialized with a depth limit: a preflight-bounded main region
    supplies a labelled partial preview or capture refuses honestly. Shadow content/attributes
    participate in estimates; the final byte cap is authoritative, not a hard transient-memory
    guarantee for Chromium/Playwright. See the remediation evidence above.
  - **Frozen paging:** cursors are daemon-memory-only, random, single-use, agent/tab/
    observation-bound and expire after five minutes; continuation requires the captured document
    (docId + mutation generation) to still match — a changed page yields
    `browser_observation_expired`. New captures, navigations, mutating actions, tab switches /
    closes and popups invalidate previous cursors.
  - **Stable tabs:** `browser_tabs` list/select/close use stable session-local tab ids
    (`tab-N`); positional `index` is gone without a compatibility alias; popups and
    browser-created tabs register as they appear.
  - **Honest action errors:** ref interactions (click/type/hover/select/fill_form) require the
    current `observationId`; the false "The page was NOT changed by this call" claim is REMOVED —
    an action failure now reports that the effect is uncertain, re-observes, and never replays.
  - **Evidence:** `browser-observation.test.ts` 18/18 (UTF-8/surrogate/CJK chunk safety, long-line
    splitting, article past the first chunk, full paging within the response bound, over-cap
    capture never complete, expired/stale/cross-session cursors refused, DOM change and
    navigation invalidation, ref observationId requirement, tab stability/close, boundText,
    screenshot bound refusal); `browser-live` (real browser): the stale-ref flow, refusal
    without an observationId, forged-observation refusal and honest uncertain-effect reporting;
    full focused regression 111/111 + gated lane 15/15.
  - **Depends:** T01 capture feasibility (verified), T07.
  - **Do:** implement D5 frozen paging/ref scoping, stable tab ids, required ref observation id,
    text/image caps and stale/uncertain-action reporting. Bound all text-producing actions,
    including navigate/type/tabs/console/network, not only the snapshot tool.
  - **Prove:** UTF-8 and long-line limits, article beyond first chunk, over-cap capture, stale/cross-
    Agent cursor, DOM change, popup/tab close, repeated close, blank page and timed-out submit.
  - **Done:** source content remains reachable within bounds; no fabricated completeness or
    claim of "page unchanged" on an uncertain action; no arbitrary evaluation tool added.

- [x] **T09 — bind browser IPC and read-only status to the admitted turn**
  - **Status (2026-09-25): COMPLETE.**
  - **Files:** `lib/browser/host.ts` (the validation boundary), `lib/browser/pool.ts`
    (`BrowserAdmission.agentId`/`signal`, `BROWSER_ACTIONS` allowlist, read-only
    `browserStatusFor`), `lib/agent-turn.ts` (captures the turn's canonical id + cancellation
    signal), `runtime/tools/browser.ts` (`browser_status` tool; `browser_tabs` redefined onto
    stable tab ids — a T08 leftover in the worker-side definition). No new IPC method: the
    existing `browserInvoke` channel carries `action: 'status'`, intercepted daemon-side before
    any pool access.
  - **Validation before pool access:** a forged agent id, an unknown action, non-object/oversized
    args (> 64 KiB) or a cancelled turn are refused outright, and the pool is always keyed on the
    daemon-resolved canonical id, never the worker's claim. Protected workers reject the browser
    host at spawn (`protected worker rejects browser and MCP capabilities`); restricted kinds
    reject it on the forbidden list; dispatch-side denial is the host's identity binding.
  - **`browser_status`** returns the hermetic `BrowserStatus` wire shape (enabled, availability,
    lifecycle state, profile presence, selected browser with cached version) — computed read-only;
    it never launches, probes a version or creates a pool entry.
  - **Evidence:** `browser-mcp-tools.test.ts` (10 new tests: tool mapping, tab-id params, forged
    agent, unknown action, bad/oversized args, cancellation, canonical-id forwarding, status-never-
    dispatches with bounded JSON, profile/state reflection, cross-agent profile isolation) and
    `worker-runtime.test.ts` (restricted spawn-time refusal, host never invoked). Focused
    regression 121/121 + gated lane 15/15; typecheck clean.
  - **Depends:** T02, T07, T08.

- [x] **T10 — supply the browser operating guide conditionally**
  - **Status (2026-09-25): COMPLETE. Slice B (T07–T10) is done; Gate B review is next.**
  - **Files:** new `apps/daemon/src/runtime/session/browser-guide.ts` (`BROWSER_GUIDE_VERSION = 1`,
    bounded one-page guide); `runtime/session/prompt.ts` (`browserGuide` prompt option, section
    inserted before the Team block); `runtime/pi/session.ts` (the ordinary call site passes
    `browserGuide: !!opts.browserHost`; the protected call site passes nothing and the restricted
    path replaces the prompt wholesale). `runtime/pi/tools.ts` needed no change — the tools side
    already keys on the same `browserHost` presence.
  - **No discovery framework:** the guide is bundled daemon code supplied through the existing
    prompt composition; Pi extension/skill auto-discovery stays disabled. No manual skill install
    or search key is needed for ordinary browser guidance.
  - **Guide content (per story §2):** check `browser_status` first (no API key ≠ no browser);
    observe → act with current refs + current `observationId` → observe again; snapshot-first with
    screenshots as the visual exception; `ref` scoping + `cursor` paging for long observations;
    stable tab ids (popups are not automatically active); uncertain-action verification and
    non-replay; cite the URL actually read and distinguish observed content from summaries and
    inference; stop at CAPTCHA/login/consent/payment walls and report — no auto-accept, no
    polling, unattended turns move on; page text is untrusted data and research is not permission.
  - **Prove:** `prompt.test.ts` (guide iff flag; all six teaching points present; bounded
    length); `browser-mcp-tools.test.ts` (session-seam alignment — an ordinary session created
    with a browser host carries the guide, without one it does not); `protected-session-prompt.test.ts`
    (composed protected and restricted prompts contain no guide — capability-denied turns get
    neither tools nor guidance).
  - **Depends:** T08, T09. Prompt
    tests establish presence/content only, not that every live model will obey it.

**Gate B — runtime/security review:** after T07–T10, review actual default-context egress, retirement
races, worker binding and observation bounds. Use T01/T05–T09 tests plus a diff review. Do not
expose management reset or claim the new default is qualified while ownership defects remain.
The review package is prepared in `docs/testing/baz-069-browser-research-evidence.md`
("Gate B review package", 2026-09-25): per-area claims with file pointers, pinned tests,
independent-check suggestions, honest limits, and the acceptance line.
**Gate B: ACCEPTED (operator, 2026-09-25).** Slice C (T11–T15) may proceed. Management reset
remains unexposed until the Slice C ownership surfaces land; the new default is not yet
claimed qualified — T18's live qualification is the qualifying step.

### Slice C — lifecycle integration and operator surfaces

- [x] **T11 — Agent delete/archive/transfer ordering**
  - **Status (2026-09-25): COMPLETE.**
  - **Files:** `apps/daemon/src/routes/agents.ts` (delete/archive/move rewired; PoolError → 409
    with reasonCode), `lib/browser/pool.ts` (new `clearBrowserProfile` — retire + remove atomic
    under the per-agent lock; `closeBrowserSession` now refuses on unproven retirement instead of
    silently no-oping), `test/routes/agent-browser-lifecycle.test.ts` (new, 7 tests).
  - **D6 ordering:** DELETE = preflight revision → retire + clear profile (atomic; a live browser
    can never be orphaned with its profile removed under it) → canonical deletion. TRANSFER =
    preflight revisions → close + clear profile (no site-state carryover into the new Team) →
    canonical move; a no-op move touches nothing. ARCHIVE = close (profile preserved) → archive.
    The post-delete fire-and-forget `void closeBrowserSession(id).catch(() => {})` is GONE.
  - **Honest partials:** warnings are declared above the route try-blocks so a late failure
    AFTER cleanup still reports exactly what was already done ("already removed and are not
    recovered by this failure") — no pretend rollback.
  - **Prove (tests):** delete retires-then-removes then deletes (204); stale-revision delete/move
    are 409 preflights that do NOT touch browser state; unresolved cleanup (failed retirement)
    blocks delete with `browser_recovery_required` and the agent survives; late DB failure after
    clear reports the warning honestly and the slot stays gone; archive stops the browser and
    preserves the profile; successful transfer clears the slot. Active-turn refusal is pinned by
    the existing lease tests; unrelated agents are untouched (per-agent locks).
  - **Depends:** T03, T07 and Gate B.

- [x] **T12 — backup/restore, export and uninstall privacy**
  - **Status (2026-09-25): COMPLETE.**
  - **Files:** `apps/daemon/src/lib/backup.ts` (archive filter excludes the EXACT root
    `browsers/` slot), `apps/cli/src/commands/backup.ts` (`validateArchiveEntries` rejects any
    `browsers/` entry BEFORE extraction/install), `apps/cli/src/commands/uninstall.ts` (reset tier
    removes `browsers/` gated by CLI-local live-owner checks — no daemon runtime imports).
  - **Privacy policy = archive bytes:** profiles hold site credentials (cookies/logins) and are
    excluded from ordinary backup/export; restored Agents start without browser identity. The
    exclusion is the exact home-root slot only — ordinary operator files under
    `teams/<id>/browsers/` are retained. A hostile/stale archive carrying `browsers/` entries is
    refused pre-install, so planted session state can never reach a managed slot.
  - **Uninstall safety:** a slot whose owner marker names a LIVE process (orphaned browser)
    blocks the destructive uninstall fail-closed (alive → refuse with remedy; unreadable/corrupt
    marker or running-without-process-identity → unknown → refuse; EPERM never reads as "safe").
    A provably-dead owner proceeds. A symlinked `browsers` root is unlinked, never followed —
    external targets are untouched.
  - **Prove (tests):** `backup.test.ts` +6 lines of coverage (2 new tests: exclusion + retention;
    hostile archive rejected before the target home exists), `uninstall.test.ts` +4 tests (slot
    removed / symlink target untouched / live owner blocks with nothing removed / corrupt marker
    blocks). All 45 backup + 17 uninstall tests green.
  - **Depends:** T03, T11.

- [x] **T13 — status/stop/reset HTTP with existing auth scopes**
  - **Status (2026-09-25): COMPLETE.**
  - **Files:** `apps/daemon/src/routes/agents.ts` (GET `/:id/browser` → `BrowserStatus`; POST
    `/:id/browser/stop` → 204 preserving state; DELETE `/:id/browser/profile?confirm=reset-browser-profile`
    → 204; shared `browserControlErrorResponse` mapping), `lib/browser/pool.ts` (stop/clear now
    refuse busy sessions; `sanitizeBrowserDiagnostic` for status remedies);
    **new** `test/routes/agent-browser.test.ts` (10 tests); `apps/cli/test/authz-scopes.test.ts`
    (+1 end-to-end scope test). `lib/scopes.ts` needed NO change — the defaults already give
    GET → `read`, stop/reset → `write`; the new tests PIN that decision so a future carve-out
    cannot happen silently.
  - **Semantics:** unknown/alias-resolved agent 404 (canonical id always on the wire); malformed
    confirmation 400 `confirmation_required`; active turn (lease), busy session, and unresolved
    cleanup are 409 with the reason code — an uncertain browser is never silently reset. Status
    never launches. Diagnostics are single-line, ≤ 240 chars, with home/slot paths redacted —
    raw child stderr cannot reach an API error.
  - **Depends:** T02, T09, T11, T12.

- [x] **T14 — HTTP client and CLI parity**
  - **Status (2026-09-25): COMPLETE.**
  - **Files:** `packages/client/src/index.ts` (`getAgentBrowser`, `stopAgentBrowser`,
    `resetAgentBrowser` using only HTTP + hermetic `BrowserStatus`), `apps/cli/src/commands/agent.ts`
    (`agent browser status|stop|reset <id>`), new `apps/cli/test/agent-browser.test.ts` (3 tests),
    new `packages/client/test/browser.test.ts` (2 tests).
  - **Semantics:** status is safe JSON; stop explicitly says profile preserved; reset prompts on a
    TTY and refuses noninteractive use without `--yes`; refusal/API errors set nonzero exit and
    print the sanitized error/code. Reset's destructive effect is server-owned via the confirmed
    HTTP route — CLI never attaches to, deletes or cleans profiles locally.
  - **Evidence:** client tests assert the exact encoded GET/POST/confirmed DELETE paths and
    preserve the typed `browser_busy` refusal; CLI tests prove status/stop/reset, noninteractive
    confirmation refusal, and sanitized missing-agent failure. Focused tests 5/5; typecheck clean.
  - **Depends:** T13.

- [x] **T15 — Agent-page controls and browser configuration UX**
  - **Status (2026-09-25): IMPLEMENTED; Gate C accepted by operator (2026-09-26).**
  - **Depends:** T13, T14.
  - **Files:** `apps/web/src/routes/agents/$id/index.tsx`,
    **new** `apps/web/src/components/AgentBrowserCard.tsx` and `apps/web/src/lib/browser.ts`
    (server functions following `lib/git-review.ts`); `lib/daemon-client.ts`, shared
    Button/ConfirmDialog and `routes/config/services.tsx` as needed.
  - **Do:** render distinct configured/running/blocked facts, selected mode/binary, sanitized
    remedy, Stop and confirmed Reset. Explain profile loss on transfer/reset, preserve state on
    stop/archive, and keep web forwarding session/CSRF (never bootstrap bearer).
  - **Evidence:** responsive flex-wrapped controls and semantic buttons/dialog; explicit loading,
    error/409, unavailable, configured/disabled, mode/executable, remediation and stale-status
    refresh states. Stop/reset refresh status after every result; reset is confirmed and never
    reports optimistic success. Browser controls use server functions and `daemonClient()`, which
    forwards bounded session/CSRF cookies and never ships a bearer. Service descriptions document
    profile privacy/loss and that browser availability does not guarantee site access.
  - **Checks:** web typecheck and production build pass; 117 focused lifecycle, route, client, CLI,
    auth-scope, backup and uninstall tests pass. Automated web DOM/viewport/keyboard tests are not
    configured in this app; these visual/interactions remain for Gate C/operator review. Web and
    CLI use the same status/error wire contract.

**Gate C — destructive-surface review: ACCEPTED (operator, 2026-09-26).** Operator accepted the
review of preconditions, scope/CSRF rules, profile clearing versus canonical mutation, crash
interruptions and backup exclusions, including the requirement that recovery remain operator-only
and not become an Agent authorization bypass. Slice D may proceed. This acceptance is not T18 live
qualification authorization.

### Slice D — composed qualification and release evidence

- [x] **T16 — deterministic full daemon/worker research journey**
  - **Status (2026-09-26): COMPLETE (canned-model/offline lane only).**
  - **Depends:** T09, T10, T13 and Gate C.
  - **Files:** new `apps/cli/test/browser-research.test.ts`; `apps/daemon/src/runtime/tools/browser.ts`
    (ref actions now expose required `observationId`, which T16's real provider/tool-schema path
    showed was missing); tool-schema assertions in `apps/daemon/test/runtime/browser-mcp-tools.test.ts`;
    updated `examples/content-team/{tools,README}.md` with the ordinary-vs-restricted distinction.
  - **Journey:** real daemon → worker → browser IPC with canned-model observed-ref actions:
    search input → results → source article → new tab → stable-tab selection → next article page
    → citation. Also drives a changed-layout search, a CAPTCHA/blocker page with one submission,
    a navigation timeout whose server saw one request (Agent observes instead of replaying), and a
    provider-pending turn cancelled through the daemon.
  - **Evidence:** test asserts the real Chromium process uses the production SSRF proxy and
    `<-loopback>` bypass denial before switching the disposable fixture to explicit private-network
    mode; the browser child lacks a planted search-key environment value; search requests contain
    only `q`. The canned router only emits the citation after the page-two source text appears in
    the tool result. Run with `BAZILION_TEST_BROWSER=1 pnpm vitest run
    apps/cli/test/browser-research.test.ts`: 2/2 passed on installed Chromium. Related browser tool,
    protected-prompt, worker, proxy and SSRF regressions: 73/73 passed; root typecheck passed.
  - **Limits:** offline fixtures and canned responses prove transport/tool behavior, not live search
    availability or model research judgment. Protected search remains a separate BAZ-067 path.

- [x] **T17 — security manifest, install/docs and regression package**
  - **Depends:** T12, T14, T15, T16.
  - **Files:** `security/acceptance-manifest.json`, `scripts/installer-e2e.mjs`, new
    `docs/browser-research.md`, `docs/architecture.md`, `AGENTS.md`, and the focused browser,
    backup, CLI, and worker tests.
  - **Do:** added 11 named BAZ-069 denial cases without reducing the existing manifest; the packed
    installer now checks explicit-invalid and detected/explicit-installed browser diagnostics and
    reliably cleans its scratch npm prefix even after failures. Documented visibility, installation,
    sensitive unbacked-up profile state, reset/transfer, recovery and site-access limits.
  - **Prove:** `pnpm test` → 2,084 passed, 34 skipped; targeted browser/route/worker/backup/privacy
    regression → 233 passed, 11 skipped; root and web typechecks passed; `pnpm security:acceptance`
    validated and passed all 184 required cases. Linux packed CLI install + fresh-home deterministic
    provider/daemon/chat/uninstall E2E passed with `/usr/bin/chromium`; invalid configured path and
    installed-browser diagnostics were exercised. Artifact: `/tmp/baz069-pack/bazilion-0.22.0.tgz`,
    SHA-256 `7d632a786031e6339137fb233e10a80e5c4d5d43d5259d26119858fbf67f4379`.
  - **Lint:** targeted Biome check of the changed installer script and acceptance manifest passed.
    Repo-wide `pnpm lint` remains red with 10 formatting errors and 103 warnings in untouched
    baseline files (including `apps/cli/src/paths.ts`, `apps/daemon/src/lib/coding-environment/workspace.ts`,
    `apps/daemon/src/lib/result-source.ts`, and `scripts/check-coding-surfaces-ui.mjs`); no diagnostics
    were reported in T17's changed files. `git diff --check` passed.
  - **Limits:** no web DOM/viewport/keyboard harness is configured; visual interaction remains for
    independent inspection. The separate website repository was not available/authorized. T18
    evidence is recorded separately; the one authorized browser attempt was incomplete, and no live
    search/source/model success is claimed.

- [x] **T18 — separately authorized live qualification and close-out**
  - **Current checkpoint:** [native-search continuation](BAZ-069-t18b-active-remediation.md).
    The browser-only gate is explicitly superseded by operator scope approval, not satisfied.
    Prior attempts/diagnostics remain historical evidence. The [2026-10-03 post-accumulator trial](BAZ-069-native-t18b-post-accumulator-trial-20261003.md)
    supplied the now independently accepted source journey. Current Linux packed/CLI/web checks
    pass after the [packaging repair](BAZ-069-evidence-and-packed-closeout-20261003.md). Operator
    acceptance closed T18 and the story on 2026-10-03. No new live call or release is authorized.
  - **Depends:** T17 retained regressions, all **T18.N1–N5** below, independent native review,
    then fresh concrete query/model/account/attempt/time/spend authorization.
  - **Files:** existing `docs/backlog/BAZ-069-acceptance.md`, story/checkpoint/backlog status;
    proposed runtime/wire targets are recorded under each native subtask, not existing APIs.
  - **Do (current):** (a) retain optional-browser evidence and re-review boundaries if touched;
    (b) real ordinary Agent with no Brave/SearXNG and **no browser tools**, using the admitted
    subscription-native route, actual hosted search, guarded official NASA source reading,
    verified effective URL, cited answer and clean same-attempt `done`. API-key route smoke is
    separately authorized if advertised. No engine/account/model fallback or chained passes.
  - **Historical browser-only execution below (superseded search requirement):**
    Observe Google as result-or-blocker, not a mandatory anti-bot success. Mac is separate.
  - **Attempt record (2026-09-28):** four single-query journeys used installed Chromium
    152.0.7977.82, the managed pool, normal SSRF proxy and `allowPrivate: false`. Two headless
    Brave attempts returned an empty observation and an explicit slider challenge; a headless
    Google attempt matched the barrier detector; a headed Google attempt displayed the unusual-
    traffic interstitial in a visible window for 20 seconds. Each stopped without challenge
    interaction and cleanup succeeded. No source was read; this is **incomplete, not accepted**.
    Details: [`BAZ-069-acceptance.md`](BAZ-069-acceptance.md).
  - **Corrected-adapter follow-up:** the first direct/CDP headed Google attempt was also blocked.
    The next, at 14:15:10–14:18:42 UTC, succeeded after operator CAPTCHA and cookie-dialog
    assistance. The same managed session exposed a NASA search result, followed its link, verified
    the source URL and read the NASA Artemis II page. A post-click capture error was recovered by
    observing the destination, without click replay. Cleanup succeeded. **Successful human-assisted
    journey evidence met; independent acceptance pending.** This does not qualify unattended Google
    access or a real Agent/model turn; T18 remains unchecked.
  - **Prove (current):** candidate identity, admitted route/model/account, actual hosted-search
    execution/terminal evidence, observed mode where available, effective source URLs/content,
    bounded usage/timing, one complete Agent answer/`done`, and cleanup. A blocker report,
    provider summary, old browser read or diagnostic cannot substitute for this attempt.
  - **Done:** native subtasks/review/regressions and revised T18(b) evidence accepted; each
    advertised route separately qualified or explicitly disabled/experimental. Operator
    acceptance and release/publication remain separate. Keep T18 unchecked until then.

  - [x] **T18.N1 — route, capability, evidence and admission contract**
    - **Depends:** revised story/D7; no live access.
    - **Targets:** `core/services.ts`, existing config/secrets, `packages/api-types/src/`,
      `lib/agent-turn.ts` and current search-host preparation. New module names to be fixed here
      before implementation; do not treat examples as existing endpoints.
    - **Prove:** route precedence/disablement/explicit errors; official endpoint and exact admitted
      model/account; unsupported tuples; source-vs-search receipt distinction; query/stream/return
      limits; no implicit protected/restricted/scheduled/inbox enablement. Record API and OAuth
      capability compatibility separately. No availability claim from configuration alone.
    - **Done:** contract/tests and independent design acceptance, including a reviewed decision
      if direct subscription transport is unsuitable. No silent app-server substitution.

  - [x] **T18.N2 — bounded native transport and execution/citation projection**
    - **Depends:** N1. **Targets:** daemon `lib/` search adapter, provider/auth suppliers and
      hermetic evidence types; deterministic fake Responses HTTP/stream tests.
    - **Prove:** official API and existing OAuth request shapes; query-only input; hosted search
      as the only tool; actual search item + successful terminal response; citations, empty/
      missing/incomplete evidence; live/cached request versus observation; 2 MiB incremental
      cap, 30 s timeout/cancellation and late result retirement; redaction and no retries.
      Existing Pi payload injection alone is insufficient if hosted items/citations disappear.
    - **Done:** bounded adapter/evidence tests pass with zero authenticated provider calls; no
      shell/files/MCP/browser/peer or model/credential/endpoint override argument exists.

  - [x] **T18.N3 — turn-bound search host, tools and research guidance**
    - **Depends:** N2. **Targets:** existing daemon host/worker IPC (`runtime/worker/`),
      `runtime/tools/web.ts`, normal session/tool composition and prompt tests.
    - **Prove:** Agent/Team/turn/cancel identity enforced in daemon; no credentials to worker;
      native search independent of browser executable; exactly one selected route; no hidden
      native tool under denial; public guarded `web_fetch` and effective URL/source receipts;
      source-owned communication boundaries unchanged. Real worker fake-provider composed
      search/read/cite/clean-completion test, not only adapter unit tests.
    - **Done:** ordinary capability and negative protected/restricted/scheduled/inbox tests
      pass; no browser fallback or general auxiliary-agent capability introduced.

  - [x] **T18.N4 — canonical config, CLI/web readiness and operator docs**
    - **Depends:** N3. **Targets:** existing config routes, client/api-types, CLI config/status,
      web config/Agent surfaces and `docs/browser-research.md`/README as appropriate.
    - **Prove:** explicit route selection and consistent status; account/model/limits/billing
      labels; configured/unavailable/disabled/executed distinctions; secret-safe errors; optional
      browser status distinct; API/CLI/web parity. Any test action is explicit normal-billing
      search, never an automatic readiness probe. Unknown routes remain unqualified.
    - **Done:** route management/validation and root/web types pass, docs match implementation;
      no install/auth/engine migration silently done on operator's behalf.

  - [x] **T18.N5 — fresh independent native review and qualification freeze**
    - **Depends:** N4. Pin new adapter/IPC/projection/config candidate, obtain fresh security/
      correctness review and repair findings. Browser reviews do not approve native networking.
    - **Prove:** spoofed IDs/route, credential exfiltration, oversized stream/citations, hostile
      output/URLs, unsupported modes/models, malformed/missing search evidence, error/abort/
      timeout/late-result paths. Run root/web types, focused and full suites, relevant security
      release cases, browser/profile/privacy regressions and packed CLI checks. Update review
      manifest/evidence for new required cases; skipped/unobserved lanes are not passes.
    - **Done:** independent acceptance of the frozen native candidate and no unresolved narrow
      blocker. Then request fresh bounded authorization for revised T18(b) and any separately
      advertised API-key smoke. No paid/live call is implied by completing N5.

## Acceptance-to-task coverage

### Current native-search revision

| Revised story criteria | Tasks/evidence required | Current disposition |
| --- | --- | --- |
| 1, 3, 7: discovery/guidance/composed research | T18.N1–N3 fake-provider + worker/host + source-read evidence | Experimental implementation/offline narrow review passed; actual Agent judgment unqualified. |
| 4–6: native boundaries/lifecycle/privacy | T18.N1–N3 + N5 new adversarial/security coverage | New native/source reviews and 243 required security cases passed; old browser passes do not qualify it. |
| 2, 4–6, 8: retained optional browser safety | T01–T17 provenance and current regressions; assisted T18(a) history | No new browser-engine success requirement; touched boundaries need review. |
| 9: revised same-attempt subscription Agent journey | T18(b), after N5 and fresh authorization | **Source journey independently accepted 2026-10-03.** [Attempt record](BAZ-069-native-t18b-post-accumulator-trial-20261003.md) · [Acceptance](BAZ-069-evidence-and-packed-closeout-20261003.md). API-key route remains experimental/unqualified. |
| 6, 10: config/CLI/web/parity/release | T18.N4–N5, qualification evidence and operator disposition | Current Linux installer, ten installed CLI/web/offline research checks, types and regressions pass after SSR dependency repair. Operator accepted 2026-10-03; release/publication remains separate. |

### Historical browser-only criterion routing

This table records the original adapter's coverage. The direct-launch amendment supplies fresh
replacement evidence; adapter/lifecycle acceptance is reopened and packed-install/live checks
must not inherit the older launcher result.

Numbers refer to the story's ten acceptance criteria. This is a routing map, not evidence of a pass.

| Story criterion | Implementation evidence | Disposition |
| --- | --- | --- |
| 1. Capability and instructions | `apps/daemon/test/runtime/{prompt,protected-session-prompt,worker-runtime}.test.ts`; gated `apps/cli/test/browser-research.test.ts` | Implemented/tested; restricted capability and guide denial covered. |
| 2. Launch/discovery | `apps/daemon/test/lib/browser-{executable,launch,managed.integration}.test.ts`; packed `scripts/installer-e2e.mjs` | Implemented/tested. Packed Linux diagnostics pass for invalid and installed explicit paths; no live website claim. |
| 3. Agent-style deterministic journey | Gated `apps/cli/test/browser-research.test.ts` | Offline fixture journey passed; not live model judgment. |
| 4. Boundaries/adversarial pages | `browser-managed.integration`, `browser-proxy`, `browser-observation`, `browser-profile` tests; 11 `BROWSER-*` manifest cases | Implemented/tested within recorded fixture coverage; no claim beyond exercised cases. |
| 5. Lifecycle/persistence | `browser-lifecycle`, `browser-profile`, `agent-browser-lifecycle`, managed integration tests | Implemented/tested for ownership, restart, refusal and lifecycle cases in these suites. |
| 6. Isolation/privacy and surface parity | `apps/cli/test/{backup,uninstall,agent-browser}.test.ts`; browser route/client tests; web typecheck; `docs/browser-research.md` | API/CLI/privacy covered; web visual/interaction review remains unobserved (no harness). |
| 7. Blocker honesty | Observation and prompt tests; gated offline journey; blocker guidance in `browser-guide.ts` | Fixture/runtime contracts covered; real-model behavior remains T18. |
| 8. Live browser qualification | T18(a), [`BAZ-069-acceptance.md`](BAZ-069-acceptance.md) | **Successful human-assisted journey observed; acceptance pending.** Six attempts: five incomplete, then Google → NASA with operator CAPTCHA/consent assistance on the direct/CDP adapter. No unattended-success claim. |
| 9. Live Agent qualification | T18(b), [attempt 1](BAZ-069-t18b-evidence.md), [attempt 2](BAZ-069-t18b-retry-evidence.md), [attempt 3](BAZ-069-t18b-bing-evidence.md) | **Full successful journey still missing.** Attempt 1 delivered research but failed terminal completion. Attempt 2 handled consent but met Google verification. Attempt 3 / Bing completed a large frame but exposed R12. Separate R12 fixes/regressions/re-review now pass; no post-fix live success is claimed. These attempts are not combined into one pass. |
| 10. Regression/release | Full `pnpm test`, typechecks, security acceptance, packed installer, and docs | Test/regression work passed; release/live qualification decision remains outside T17. |

## Verification commands and test lanes

Run from the product repository root. Each task adds its focused tests to this list as applicable.

```sh
pnpm vitest run apps/daemon/test/lib/browser-proxy.test.ts \
  apps/daemon/test/lib/browser-ssrf.test.ts \
  apps/daemon/test/runtime/browser-mcp-tools.test.ts
pnpm vitest run apps/daemon/test/runtime/protected-session-prompt.test.ts \
  apps/daemon/test/runtime/worker-runtime.test.ts
pnpm vitest run apps/cli/test/backup.test.ts apps/cli/test/uninstall.test.ts \
  apps/cli/test/authz-scopes.test.ts
pnpm typecheck
pnpm --filter @bazilion/web typecheck
pnpm test
pnpm security:acceptance
pnpm lint
pnpm build
git diff --check
```

After T01 creates the suite, run its actual-browser lane explicitly:

```sh
BAZILION_TEST_BROWSER=1 pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts
```

T17 runs `node scripts/installer-e2e.mjs <packed-tarball.tgz>` against a freshly built/packed CLI
artifact using the existing CI scratch-prefix procedure, not a replacement of the operator's
real global install or home. Record the artifact identity.

Actual-browser fixture tests use an explicit **new test-only** `BAZILION_TEST_BROWSER=1` gate,
with a provisioned supported local binary; missing requirements skip the opt-in lane with a
reason, but **fail** when the gate is enabled. Unit/IPC/auth/privacy tests stay in normal CI.
The reviewed Linux browser lane must be explicitly enabled for candidate qualification; green
unit tests with all browser tests skipped cannot close Gate A or T17. Keep browser headless/
headed evidence distinct; GUI-dependent checks need a provisioned display (not an assumption).
No fixture test uses a public search engine. Live tests in T18 are manual opt-in, outside the
default Vitest run and security acceptance command.

## Inspection findings behind this plan

Source inspection during refinement found these existing seams; they are not new passing tests:

- `browser/host.ts` currently forwards the supplied Agent id; `worker/spawn.ts` dispatches it.
  T09 binds and validates at the daemon-owned host boundary rather than trusting the worker.
- `resources.ts:reapMap` and `pool.ts:closeBrowserSession` remove ownership before close settles;
  shutdown also clears the maps before awaiting close. T07 must not copy that ordering for disk profiles.
- `proxy.ts:closeSsrfProxy` awaits server close without tracking all CONNECT pairs. The earlier
  probe stalled during shutdown; T05 covers the mechanism without claiming that cause was proven.
- `routes/agents.ts` performs browser teardown after canonical deletion, fire-and-forget. T11
  changes the ordering under the existing lifecycle lease and covers DB/FS partial failure.
- `pool.ts:actOnRef` says the page was unchanged after any error. That is not generally true
  after a click/submission timeout; T08 removes the false certainty and automatic-replay temptation.
- Resolved Playwright 1.61.0 exposes no `serviceWorkers` field in `ConnectOverCDPOptions`.
  T01 must establish a supported safe default-context mechanism, not pretend an option exists.
  **Superseded 2026-09-25 by the operator decision:** the adapter is `launchPersistentContext`,
  which does expose `serviceWorkers` for the persistent context; kept as a historical record of
  why the CDP-attachment design was abandoned.
  `Locator.ariaSnapshot` exposes `depth`/`timeout`, not a byte limit: depth alone does not bound
  a wide tree or long text nodes. T01 must also prove bounded capture rather than just slice an
  already unbounded serialized result.

**Readiness:** the task handoff is explicit; the managed adapter is still subject to Gate A.
A smaller model can start T01 and the contract tasks without choosing product policy. It may not
approve its own unresolved security mechanism or silently reinterpret a failed gate as done.

## Implementation log

### 2026-09-25 — Slice A contracts (T02–T04) done; T01 Blocked at Gate A

Working tree only (uncommitted). Environment: Node 26.7.0, Playwright 1.61.0, installed Arch
Chromium 152.0.7977.82, no `DISPLAY`/`WAYLAND_DISPLAY`.

**Added**

- `packages/api-types/src/browser.ts` — hermetic `BrowserStatus`, availability/state/reason types.
- `apps/daemon/src/lib/browser/profile.ts` — D1 ownership/metadata/reconciliation.
- `apps/daemon/src/lib/browser/executable.ts` — D2 discovery, display and mode resolution.
- Tests: `apps/daemon/test/lib/browser-{config,profile,executable}.test.ts`,
  `apps/daemon/test/core/paths.test.ts`.

**Changed**

- `apps/daemon/src/core/paths.ts` — `browsersDir` + `browserDir(agentId)`.
- `apps/daemon/src/core/services.ts` — `BROWSER_EXECUTABLE_PATH`; mode/help text.
- `apps/daemon/src/lib/browser/config.ts` — three-way mode preference + executable path.
- `apps/daemon/src/lib/browser/pool.ts` — `BrowserConfig.mode`/`executablePath`.
- `packages/api-types/src/index.ts` — barrel export.

**Verification run**

```sh
pnpm vitest run apps/daemon/test/lib/browser-config.test.ts apps/daemon/test/core/paths.test.ts
# 2 files, 10 passed
pnpm vitest run apps/daemon/test/lib/browser-profile.test.ts
# 21 passed
pnpm vitest run apps/daemon/test/lib/browser-executable.test.ts
# 11 passed
pnpm typecheck   # clean
pnpm exec biome check <changed files> --write   # clean after format
```

Total: 42 passing focused tests; no browser process launched in any of them. Baseline note: the
pre-existing `apps/daemon/test/lib/browser-live.test.ts` screenshot test fails in this headless
environment (`Page.captureScreenshot: Unable to capture screenshot`) — unrelated to these changes.

**Blocked**

- T01/Gate A: persistent-default-context service-worker denial is not reachable with supported
  Playwright 1.61.0 public interfaces (see the T01 entry). T05/T06 and all of Slice B/C/D remain
  blocked until a reviewer resolves the mechanism or authorizes a documented alternative. T02–T04
  do not depend on Gate A and are complete.

### 2026-09-25 — upstream source inspection recorded (T01 Gate A input)

Read-only inspection of the pinned OpenClaw snapshot, fetched into the local bare clone at
`~/.cache/yay/openclaw-git/openclaw`. No product file changed by this step beyond documentation.

- Confirmed OpenClaw uses Playwright (`connectOverCDP` over a self-owned transport) plus raw
  `newCDPSession` for a few operations, on the **persistent default context**.
- Confirmed **no service-worker restriction exists in its product path** — zero `serviceWorkers`
  hits under `extensions/browser/src`, zero in non-test production code repo-wide.
- Confirmed its default egress is direct (`--no-proxy-server`), it inherits the ambient env minus
  proxy vars, and `--no-sandbox` is available.
- Recorded in `docs/testing/baz-069-browser-research-evidence.md` § "Follow-up source inspection
  (2026-09-25)" with reproducible `git grep`/`git show` citations.

Net effect at the time: the T01 blocker was corroborated rather than resolved. **Superseded later
the same day** by the operator decision below — the design question was answered neither by
authoring a CDP mechanism nor by an egress-only posture, but by changing the adapter.

### 2026-09-25 — Gate A resolved by operator decision: `launchPersistentContext` adopted

Decision sequence (all recorded in `docs/testing/baz-069-browser-research-evidence.md`):

1. **Architecture re-examination:** `chromium.launchPersistentContext` supports `executablePath`,
   `env`, `args`, `proxy`, `chromiumSandbox` **and `serviceWorkers`** on a persistent on-disk
   profile. Spike-verified on installed Chromium 152.0.7977.82: explicit binary honored (no
   headless-shell substitution), sandbox on (no `--no-sandbox`, zygote present), pipe transport
   (no debugging port at all), Playwright-owned child reaping (0 survivors after
   `context.close()`), service-worker cold start (nothing registered, worker script never
   fetched, nothing persisted to disk, invariant holds across restart), proxy loopback denial
   (zero fixture hits), cookies persist across restart.
2. **Bounded live re-measurement** (operator-authorized, 3 navigations, ≥45 s apart, headed on
   `:0`, same binary/query as baseline): all arms challenged **including an unattached native
   control**; proxy not implicated (proxied and direct arms identical); launch architecture is not
   the variable.
3. **Operator manual baseline:** ordinary manual Google works on the same machine/IP — the
   trigger is session state, not the network.
4. **Operator acceptance:** adopt on reliability and security grounds only, never as an
   anti-detection measure.

Amendments made in this step: story §3/§5, acceptance criterion 2 and the readiness section; plan
status, D1 (marker + singleton-lock reconciliation), D2 table, D3 (launcher/transport/egress +
resolved gate), T01 (re-scoped verification suite), T06 (persistent-context launcher). No product
code changed beyond documentation; T02–T04 remain implemented and passing (67 focused tests incl.
existing browser suites).

Next: T01 verification suite (argv/env pinning, service-worker cold start, instrumented
loopback/UDP denial, popups, downloads, bounded capture), then T05.

### 2026-09-25 — T01 verification suite COMPLETE (10/10); T05 proxy lifecycle (partial)

**Added**

- `apps/daemon/test/lib/browser-managed.integration.test.ts` — the gated actual-browser lane
  (`BAZILION_TEST_BROWSER=1`): 10 tests covering argv/env pinning, no debugging port, sandbox on,
  native UA/`webdriver` honesty, loopback HTTP/iframe/WebSocket/popup zero-hit denial, WebRTC/UDP
  zero-datagram denial, control arm, SW cold start incl. across restart, cookie persistence,
  download denial, bounded-capture feasibility, and bounded teardown as a hard assertion.
- `apps/daemon/test/fixtures/browser-managed.ts` — the pinned posture fixtures (encoded options,
  allowlist env, instrumented loopback HTTP/UDP targets, owned-process probe).
- `browser-proxy.test.ts`: single-flight and bounded-close-with-lingering-keep-alive tests.

**Changed**

- `apps/daemon/src/lib/browser/proxy.ts`: single-flight startup, tracked client/upstream sockets,
  close destroys both sides and settles within the D2 bound. This was forced by the T01 lane: the
  teardown assertion caught the exact stall the plan's inspection findings had recorded as
  unproven ("closeSsrfProxy awaits server close without tracking all CONNECT pairs"), reproduced
  and labeled as `ssrf proxy close:stalled` before the fix.

**Verification**

```sh
BAZILION_TEST_BROWSER=1 pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts
# 10 passed — stable across 3 consecutive runs (~16.4 s)
pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts
# skipped with a reason when the gate is unset
pnpm vitest run <browser + config/paths suites>   # 73 passed across 9 files
pnpm typecheck                                      # clean
pnpm exec biome check <new files>                   # 0 errors
pnpm lint                                           # 15 pre-existing errors in untouched files
```

**Honest limitations recorded in the T01 entry:** headless-lane evidence only; the WebRTC/UDP
control arm also observed zero datagrams (the denial is pinned policy, not a demonstrated
counterfactual); QUIC is argv-pinned without an HTTP/3 probe; Chromium rewrites child cmdlines
(single-string matching documented); Arch's `/usr/bin/chromium` is a wrapper script adding
`CHROME_*` env vars (documented allowance).

**Remaining:** Gate A review of the T01 evidence (operator/reviewer) before T06; T05's guards
(`browser/guards.ts`) and adversarial actual-context cases; then T06.

### 2026-09-25 — operator review run surfaced two real defects; both fixed, lane re-verified

The operator ran the Gate A lane (10/10) and its stdout revealed what my greps had hidden:

1. **Three in-page probe scripts never executed.** Playwright's `page.evaluate(string)` treats a
   string starting with `async (x) => {` as an *expression* (the function object, serialized as
   `undefined`) rather than a function to call — the logs printed `results: undefined` /
   `attempt log: undefined`. The loopback-egress test still meaningfully covered the popup path
   (Playwright-side `setContent` + click), but the WebRTC tests had passed **vacuously**. All
   probes are self-invoking IIFE expressions now, and the pitfall is recorded as T01 limitation 5
   so T08 does not repeat it.
2. **With the probes actually running, the WebRTC denial was exposed as insufficient.** 65 STUN
   binding requests (96-byte datagrams) reached the instrumented loopback listener **with and
   without** `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`: the policy governs
   candidate gathering, not connectivity checks to page-injected remote candidates, and no
   disable-WebRTC switch exists (binary strings searched; the tested value is the strictest in
   Chromium's own privacy-API enum).

**Mitigation (D3 amended accordingly):** layered denial — the flag stays, plus a supported
context init script that removes `RTCPeerConnection` from every document and frame, registered
at launch before any page is exposed (the pre-registration initial page is refreshed with a
covered document; dynamically created iframes verified covered — `error:TypeError` in the main
frame and the iframe, 0 datagrams). Capability removal, not stealth: a research browser has no
peer-connection use case. Story §5 and acceptance criterion 4 updated to name WebRTC/UDP.

**Result:** the lane is 10/10, stable ×3 (~16.5 s). The control arm now **asserts** the exposure
(>0 datagrams) so the managed arm's controls are load-bearing rather than decorative; the
managed arm asserts the probe fails with the API gone and 0 datagrams. Focused regressions
63/63; typecheck clean; biome 0 errors in the touched files (14 warnings: test non-null
assertions and console logs).

### 2026-09-25 — Gate A accepted; T05 and T06 complete

The operator accepted Gate A ("proceed with T05 and the rest") after independently running the
lane twice.

**T05 — guards + proxy lifecycle (complete)**

- New `apps/daemon/src/lib/browser/guards.ts`: the production pinned posture (denial args,
  P2P-removal init scripts, allowlist env, `managedLaunchOptions`, `installManagedGuards`).
  The test fixture now imports it, so the lane asserts the real production controls.
- `proxy.ts`: single-flight startup (a close during startup fails closed), every owned socket
  tracked, bounded close destroying both sides, and a generation counter so a pending DNS
  resolution spanning a close never dials an upstream — no socket may outlive its generation.
  Test seams for bind/DNS/dial never weaken validation.
- `browser-proxy.test.ts` +5 lifecycle tests (failed bind, close-during-startup, pending DNS,
  half-open tunnel, rebinding still pins the validated IP). 18/18 with `browser-ssrf.test.ts`.

**T06 — launcher + graceful close (complete)**

- New `apps/daemon/src/lib/browser/launch.ts`: claim/reconcile (T03) → foreign-lock refusal →
  marker-before-launch → launch with the T05 controls → guards → marker `running` with the
  singleton-lock pid; graceful close = `context.close()` then marker removal only after the
  lock no longer names a live owner (5 s bound); unresolved retirement leaves the marker
  (`recovery_required` at the next assessment).
- `browser-launch.test.ts`: 7 unit tests via the injectable launcher. The gated lane gained the
  real-launcher test incl. a SIGKILL crash recovered by a *new* daemon instance. Lane 11/11,
  stable ×2.

**Two real defects found and fixed during T06 verification**

1. **Chromium's singleton socket path is capped by `sockaddr_un.sun_path` (~104 bytes):** the
   managed TMPDIR inside the owned slot made deep-path launches `SIGABRT` at startup
   (`process_singleton_posix.cc`: "Socket path too long"). This is exactly the class of
   production bug the gated lane exists to catch — in production a long home or agent id would
   have crashed every first launch. Fix: TMPDIR is not part of the allowlist env (system temp
   hosts only the ephemeral per-instance socket); HOME stays managed inside the slot. D3
   amended.
2. **The launcher's silent `daemonInstanceId: 'unknown'` fallback** collapsed
   unknown-vs-unknown to "this instance" at assessment. The launcher now refuses to launch
   without a real daemon identity — fail closed.

**Verification**

```sh
pnpm vitest run <all browser suites + config/paths/core>   # 85/85 across 10 files
BAZILION_TEST_BROWSER=1 pnpm vitest run   apps/daemon/test/lib/browser-managed.integration.test.ts  # 11/11, stable ×2 (~17.5 s)
pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts  # skips when ungated
pnpm typecheck                                             # clean
pnpm exec biome check <all touched files>                  # 0 errors (18 warnings)
```

**Next:** T07 — integrate the managed launcher, retirement, cancellation and concurrency into
the pool (`pool.ts`, `resources.ts`, `lib/resources.ts`), then T08 bounded observations.

### 2026-09-25 — T07 complete: the pool runs the managed adapter

- `pool.ts` rewritten onto the T06 launcher with D4 transitions: per-agent serialized
  transitions (no launch overlaps a retiring profile), busy-aware capacity/LRU
  (`browser_capacity_reached` when every session is busy), the eight-tab cap, posture-fingerprint
  retirement on configuration change, `recovery_required` slots refused for every action and
  never re-launched, reaped or counted as capacity. Admission (`BrowserAdmission`) carries the
  daemon-resolved canonical Agent id, the admitted Team id and daemon paths — captured in
  `agent-turn.ts`/`host.ts`, never worker input.
- `resources.ts`: the registry holds managed entries; reaping skips busy sessions and
  `recovery_required` slots; ownership is dropped only as each retirement settles; shutdown
  retires browsers first and closes the shared proxy last.
- Removed with the old adapter: the bundled `chromium.launch()` path, the UA rewrite
  (`HeadlessChrome` substitution — story §3 forbids it) and the ephemeral context.
- Context-level D2 deadlines (30 s navigation / 10 s interaction) moved into
  `installManagedGuards` (they had been lost in the launcher switch — caught by review, not a
  test failure).
- Tests: `browser-lifecycle.test.ts` 7/7; `browser-live.test.ts` updated to the managed pool
  (real browser, stable ×2); `resources.test.ts` updated to the entry contract + busy/recovery
  cases. Focused regression 97/97 across 12 files; gated lane 11/11; typecheck clean; lint
  baseline unchanged (15 pre-existing errors in untouched files).

**Next:** T08 — bounded snapshots, stable tab ids and honest action errors.

### 2026-09-25 — T08 complete: bounded observations, stable tabs, honest errors

- New `observation.ts`: `SessionObservations` (tabs registry, one current capture, cursors),
  `chunkText` (UTF-8-safe, line-aligned, code-point-safe hard splits), bounded capture with the
  512 KiB bound and depth-limited oversize handling, the screenshot decoded-bound refusal
  (8 MiB, from the PNG IHDR — never truncated silently), and `boundText` for non-observation
  action text.
- `guards.ts` gained the trusted observation instrumentation: per-document id + content-mutation
  generation (childList/characterData; attribute churn excluded so animation-heavy pages don't
  spuriously expire) + a bounded DOM-size walk (no unbounded serialization for oversize
  detection).
- The pool dispatch was rewired: `snapshot` takes `ref`/`cursor` (mutually exclusive), all
  text-producing actions return bounded observations, `browser_tabs` uses stable tab ids, and
  the false "The page was NOT changed by this call" claim is gone — failures report the
  uncertain effect and re-observe without replaying.
- A Playwright pitfall hit during test authoring (and already during T01): string evaluates must
  be self-invoking IIFEs.
- Tests: `browser-observation.test.ts` 18/18 (unit, fake pages); live stale-ref/forged-id flows
  in `browser-live.test.ts`; focused regression 111/111 + gated lane 15/15; typecheck clean.

**Next:** T09 — bind browser IPC and read-only status to the admitted turn.

### 2026-09-25 — T09 complete: identity-bound IPC + read-only browser_status

- `BrowserAdmission` now carries the turn's canonical Agent id and cancellation signal,
  captured in `agent-turn.ts` from the turn's own binding. The daemon host refuses a forged
  agent id, unknown action, non-object/oversized args or a cancelled turn BEFORE pool access,
  and keys the pool on the canonical id regardless of the worker's claim.
- `browser_status` rides the existing `browserInvoke` channel (`action: 'status'`), intercepted
  in the host — no new privileged RPC. `browserStatusFor` reports the hermetic `BrowserStatus`
  from cached observations and filesystem/config resolution only (never launches/probes/unlocks).
- Worker-side tool defs gained `browser_status` and the T08 leftover `browser_tabs` positional
  `index` parameter was replaced with stable `tabId`.
- Spawn-time denial was already closed (protected workers reject the browser host; restricted
  kinds list it as forbidden) — a new worker-runtime test pins the restricted refusal and that
  the injected host is never invoked; dispatch-side denial is now pinned by the host tests.
- Tests: 10 new in `browser-mcp-tools.test.ts`, 1 in `worker-runtime.test.ts`; focused
  regression 121/121, gated lane 15/15 (one flaky re-run of the known environmental
  screenshot-capture failure, passing on retry), typecheck clean.

**Next:** T10 — the conditional browser operating guide (Slice B / Gate B).

### 2026-09-25 — T10 complete: the conditional browser operating guide

- New `browser-guide.ts`: bundled, versioned (`v1`), bounded one-page guide teaching the full
  loop — status before browsing, observe-act-observe with current refs and observationId,
  ref/cursor paging, stable tabs, honest non-replay, citation discipline, human-choice walls,
  and untrusted-page-content rules.
- `buildSystemPrompt` gained a `browserGuide` option; the ordinary session passes it iff the
  browser host is admitted — the SAME condition that registers the `browser_*` tools — so
  guidance and capability are structurally incapable of drifting apart. Protected turns (host
  denied at spawn) and restricted turns (daemon-authored prompt) compose without it.
- No Pi loader/extension discovery change; no manual skill install or search key needed.
- Tests: 3 new prompt-builder tests, 1 session-seam alignment test (ordinary session with/without
  a host), 2 protected/restricted absence assertions on composed prompts. Focused regression
  174/174 across 17 files; gated lane 15/15; typecheck clean; biome 0 errors in touched files;
  `pnpm lint` errors unchanged (all pre-existing, untouched files).

**Next:** Gate B — runtime/security review of T07–T10 (default-context egress, retirement races,
worker binding, observation bounds), then Slice C (T11–T15).

### 2026-09-25 — Gate B ACCEPTED (operator)

- The review package (per-area claims with file pointers, pinned tests, independent-check
  suggestions, honest limits) was prepared in the evidence doc; the operator accepted the
  runtime/security posture of T07–T10: default-context egress (mandatory validating proxy,
  no-TOCTOU dial, QUIC/WebRTC/service-worker/download denial, scrubbed env), retirement races
  (per-agent serialization, busy-aware capacity/reaping, permanent recovery_required), worker
  binding (spawn + dispatch denial, canonical-id pool keying), and observation bounds
  (response/capture/screenshot caps, cursor hygiene).
- Conditions carried forward: management reset stays unexposed until the Slice C ownership
  surfaces; nothing is claimed qualified until T18's live qualification.

**Next:** T11 — Agent delete/archive/transfer ordering.

### 2026-09-25 — T11 complete: D6 delete/archive/transfer ordering

- `clearBrowserProfile` (pool): retire + remove the slot atomically under the per-agent lock;
  refuses unproven retirement or unknown ownership — unresolved cleanup blocks the transition.
  `closeBrowserSession` no longer silently no-ops a recovery_required session; it throws, so
  lifecycle callers learn the browser may still be alive.
- Routes: delete/transfer preflight the team revisions BEFORE touching browser state (a
  stale-revision request never costs the profile), then clean up, then run the canonical
  mutation (which revalidates in-transaction). Cleanup failures map to 409 + reasonCode. A late
  failure after cleanup carries a `warnings` array describing the partial filesystem side
  effect — no pretend rollback.
- Tests: new `test/routes/agent-browser-lifecycle.test.ts` (7/7) with realistic claimed slots
  (real identity + owner marker, fake handles that mimic the real close contract); lease + CLI
  agent suites green.

**Next:** T12 — backup/restore, export and uninstall privacy.

### 2026-09-25 — T12 complete: backup/restore/uninstall privacy

- Daemon archive filter excludes exactly the root `browsers/` slot (cookies/logins never enter
  a backup); the CLI restore validator refuses any archive carrying `browsers/` entries before
  extraction — a hostile or stale archive cannot plant session state into a managed slot.
- Reset-tier uninstall now removes the browser slot tree behind safe owner checks (CLI-local
  JSON + pid probing, fail-closed on unknown ownership; symlinks unlinked, never followed).
- Tests: 2 new backup, 4 new uninstall; 45/45 + 17/17 green.

**Next:** T13 — status/stop/reset HTTP with existing auth scopes.

### 2026-09-25 — T13 complete: status/stop/reset HTTP routes

- Three routes under the existing auth (defaults: GET `read`, mutations `write`; session CSRF
  enforced by the middleware). Reset requires the explicit `confirm=reset-browser-profile`
  literal. 404/400/409 mapping shared via `browserControlErrorResponse`.
- `closeBrowserSession`/`clearBrowserProfile` now refuse busy sessions (in-flight actions are
  never killed by a stop); status diagnostics are sanitized (single line, bounded, path-free).
- Tests: 10 new route tests + 1 end-to-end scope test; suites green.

**Next:** T14 — HTTP client and CLI parity.

### 2026-09-25 — T14 complete: client + CLI parity

- Added three explicit HTTP client methods using hermetic `BrowserStatus`. CLI `agent browser
  status|stop|reset` is HTTP-only; status emits safe JSON, stop preserves the profile, reset
  requires TTY confirmation or explicit `--yes`, and refused operations exit nonzero.
- Tests: client exact-path/typed-error tests 2/2; CLI status/stop/reset/refusal tests 3/3;
  typecheck clean.

**Next:** T15 — Agent browser controls.

### 2026-09-25 — T15 complete: Agent browser controls

- Added the settings-only Agent browser card and authenticated server functions for status, stop and
  confirmed reset. It distinguishes configured/disabled/unavailable state, session/profile state,
  selected browser/mode/version, reason code and safe remedy. Stop/reset refresh status after both
  success and refusal; reset confirmation states that cookies/logins are permanently discarded.
- Updated browser service configuration descriptions with privacy, lifecycle and non-guarantee
  messaging. Browser diagnostics now use static operator-safe remedies rather than forwarding
  launch/child stderr or filesystem paths; lifecycle refusal routes share this policy.
- Evidence: root typecheck (including web), web production build, and 117 focused tests passed
  (route/lifecycle, client, CLI, auth-scope, backup/uninstall and observation). Lifecycle test
  assertions were corrected to match the implemented fail-closed behavior: close refuses busy work,
  and uncertain retirement is returned to the lifecycle caller. No DOM/viewport/keyboard test
  harness is configured for the web app; those interactions remain for independent Gate C review.
- **Gate C accepted by operator (2026-09-26).** T16 passed its gated offline journey (2/2).
  T17 regression, docs and packed installer checks are complete; see the T17 evidence entry below.
  T18 still requires separate operator approval.

### 2026-09-26 — T17 complete: regression, operator docs and packed install

- Added 11 named `BAZ-069` denial cases to `security/acceptance-manifest.json`; acceptance validated
  184 required cases and passed. The new names are collected from the real source test titles.
- Added `docs/browser-research.md`; updated `docs/architecture.md`, `AGENTS.md`, and the story's
  readiness/acceptance status. Docs distinguish browser availability from site success, explain
  visibility/install requirements, sensitive persistent state and backup exclusion, reset/transfer,
  fail-closed recovery, and explicitly make no universal Google or protected/scheduled claim.
- Packed installer E2E now covers an explicitly invalid executable and an installed executable
  selection. It passed against a freshly packed `bazilion-0.22.0.tgz` on Linux using
  `/usr/bin/chromium`, including fresh-home setup, deterministic provider turn, and uninstall. The
  script cleans its temporary npm prefix on both success and failure. Artifact SHA-256:
  `7d632a786031e6339137fb233e10a80e5c4d5d43d5259d26119858fbf67f4379`.
- `pnpm test`: 2,084 passed, 34 skipped (7 test files skipped). Focused browser/route/worker/backup
  regression: 233 passed, 11 skipped. Root and web typechecks passed. The gated T16 Chromium
  journey separately passed 2/2; it remains offline/canned-model evidence only. `git diff --check`
  and targeted Biome on `scripts/installer-e2e.mjs` + `security/acceptance-manifest.json` passed.
- Repo-wide `pnpm lint` remains red: 10 formatting errors and 103 warnings in untouched baseline
  files; no T17-changed file was reported. Web UI visual interaction remains untested because there
  is no configured DOM/viewport/keyboard harness. Criteria 8–9 remain blocked T18 pending explicit
  operator authorization; no public-site or live-model success is implied.
