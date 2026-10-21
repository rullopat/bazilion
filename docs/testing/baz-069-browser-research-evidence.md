# BAZ-069 — browser research investigation and revised evidence

> Historical investigation, not the current launcher contract. The operator clarified the required
> direct local launch + CDP architecture on 2026-09-28. See the
> [implementation amendment](../backlog/BAZ-069-direct-launch-amendment.md) for the replacement
> adapter and fresh evidence. Descriptions below of the old ephemeral or Playwright-owned pool
> describe the code at the time of those probes, not today's implementation. The later
> [review/remediation record](../backlog/BAZ-069-review-remediation.md) records counterexamples to
> earlier WebRTC, capture-bound and lifecycle claims, the fixes, and current regression evidence.

Date: **2026-09-25**. Product source tested: `ee2a896dd7306fc534f4192786b2697bfb60a2d0`
(on `0.23.0`). This is refinement evidence, **not acceptance of an implemented BAZ-069**.

## Summary

The useful OpenClaw pattern is **Agent instructions + general browser tools + a managed browser
profile**, not a special Google scraping API. The Agent can observe a search box, submit a query,
inspect links, open a source, select its tab and read it. Bazilion already has most of those tool
primitives. The proposed work improves browser provisioning, persistent lifecycle, guidance and
honest availability rather than building a fixed-engine results scraper.

The new tests do **not** identify the exact cause of Google's challenge. Directly launching an
installed browser and attaching Playwright did not reliably avoid it. A complete scripted
search-to-source journey did work through **Bazilion's actual browser actions and SSRF proxy**
on Brave. No API key, personal browser profile, LLM call or paid provider was used.

## What the earlier record got wrong

The September 23–24 probes are exploratory observations, not a controlled causal experiment:

- They used standalone Playwright scripts, not the production pool/SSRF proxy. Calling them
  "pool-equivalent" was inaccurate.
- Google returned a `/sorry/` challenge in headless, headed and persistent-profile attempts.
  Hiding `navigator.webdriver` did not help in those attempts; this does not establish that
  Google ignores that signal or that browser configuration is irrelevant.
- Early CAPTCHA-wait loops re-navigated about every 12 seconds, potentially interrupting the
  operator and generating dozens of requests. Only the final loop observed without reloading.
  The operator confirmed attempting the CAPTCHA without success. This is not proof that human
  assistance never works, or that the challenge was successfully solved and then rejected.
- Google's generic "unusual traffic" message and displayed request IP do **not** prove an IP
  or range is blacklisted. The Mac's network, VPN, browser version and profile history were not
  established. A different machine does not imply a different network.
- The operator observed OpenClaw opening Google on **Chrome/macOS**, not this Linux machine.
  Lee's transcript reports browser-based research after the dedicated search service was
  unavailable. The exported chat omits the research child's browser-call arguments; it does
  not establish the selected profile, launch flags, exact navigation sequence, or absence of
  earlier human assistance. Its cited URLs were not independently validated by this study.
- Eight extracted links are not eight verified, relevant sources. The earlier Bing probe's
  first result for the Bazilion query was unrelated. The broad Brave selector also counted
  links, not a fully qualified title/URL/snippet contract.
- There is no evidence that personal Chrome cookies are necessary, that macOS is inherently
  exempt, or that Chromium and branded Chrome are interchangeable for this comparison.

These corrections supersede the former story's "clean Mac IP / flagged Linux IP" explanation,
its universal CAPTCHA conclusions, and its claim of implementation-ready Google reliability.

## Source inspection: what OpenClaw actually launches

Pinned upstream snapshot: [`88df612b941d909cf3a3dabdf97ae4d2f71d6491`](https://github.com/openclaw/openclaw/tree/88df612b941d909cf3a3dabdf97ae4d2f71d6491),
2026-09-19 13:33:46 UTC, near the supplied chat. This is **not** a verified installed version
from the operator's Mac. Current docs/source were also inspected at
`60bd171ca52fae6d5a414682955f29489c98160c`.

- [Executable discovery](https://github.com/openclaw/openclaw/blob/88df612b941d909cf3a3dabdf97ae4d2f71d6491/extensions/browser/src/browser/chrome.executables.ts#L566):
  installed Chrome first on macOS, then other supported Chromium-family browsers. Linux also
  has installed-browser candidates, with Playwright-managed binaries later in discovery.
- [Managed launch](https://github.com/openclaw/openclaw/blob/88df612b941d909cf3a3dabdf97ae4d2f71d6491/extensions/browser/src/browser/chrome.ts#L754):
  dedicated `<config>/browser/<profile>/user-data`, explicit launch flags, direct `spawn()` of
  the selected executable, a configured debugging port; not `chromium.launch()`.
- [CDP transport](https://github.com/openclaw/openclaw/blob/88df612b941d909cf3a3dabdf97ae4d2f71d6491/extensions/browser/src/browser/pw-session-cdp-transport.ts#L245):
  Playwright attaches with `connectOverCDP()`.
- [Browser skill](https://github.com/openclaw/openclaw/blob/60bd171ca52fae6d5a414682955f29489c98160c/extensions/browser/skills/browser-automation/SKILL.md):
  observe → act → verify, tab/ref hygiene, and stop/report permission or CAPTCHA blockers.
- Official [isolation](https://docs.openclaw.ai/tools/browser/isolation) and
  [profiles](https://docs.openclaw.ai/tools/browser/profiles) docs distinguish the managed
  isolated profile from optional attachment to a personal browser. We need not copy the latter.
- Official [web-search docs](https://docs.openclaw.ai/tools/web) describe a separate
  provider-backed tool. Its availability does not determine the Agent's ability to browse.
- Google's [unusual-traffic help](https://support.google.com/websearch/answer/86640?hl=en)
  lists multiple possible sources and describes human reCAPTCHA completion as a recovery path;
  it does not disclose the scoring cause for our sessions.

Bazilion's `apps/daemon/src/lib/browser/pool.ts` instead uses `chromium.launch()` plus an
in-memory `newContext()`, rewrites the UA's HeadlessChrome token, blocks service workers, and
routes normal browser traffic through `lib/browser/proxy.ts`. Its session survives turns but
not pool teardown/restart. Playwright 1.61.0's installed launcher chooses Headless Shell by
default for headless and full bundled Chromium for headed, so those tests also change binary.

## Follow-up source inspection (2026-09-25): transport ownership and the absent service-worker control

**Method.** The AUR package cache on this machine holds a bare clone of OpenClaw at
`~/.cache/yay/openclaw-git/openclaw`. The pinned snapshot was fetched into it
(`git fetch --depth=1 origin 88df612b941d909cf3a3dabdf97ae4d2f71d6491`) and inspected with
`git grep <FETCH_HEAD>` / `git show <FETCH_HEAD>:<path>`. Every claim below is reproducible against
the same commit this review pinned. No working tree, build, product file or provider setting was
changed; this is read-only source inspection.

1. **OpenClaw uses Playwright — it is not a from-scratch CDP client.**
   `extensions/browser/src/browser/pw-session-cdp-transport.ts:245` calls
   `getPlaywrightCore().chromium.connectOverCDP(transport, { timeout: opts.timeout })` and imports
   `ConnectOverCDPTransport` from `playwright-core`.
2. **But it owns the CDP transport underneath Playwright.** It does not hand Playwright a URL: it
   opens its own WebSocket through `openCdpWebSocket` (its own DNS `lookup` hook, headers and
   handshake timeout) and passes that socket in as the transport. It also rewrites CDP frames in
   flight — `contextlessTargetParams` releases contextless root `Target.attachedToTarget` events so
   Playwright's browser-root handler accepts them.
3. **Raw CDP sessions supplement Playwright** for a few operations:
   `page.context().newCDPSession(page)` in `pw-session.ts`, `pw-tools-core.snapshot.ts` and
   `pw-tools-core.state.ts`. Chrome itself is spawned directly
   (`spawn(preparedSpawn.command, preparedSpawn.args, { env })`), never via `chromium.launch()`.
4. **The product path uses the persistent default context.**
   `extensions/browser/src/browser/pw-session-actions.ts:489` →
   `const context = browser.contexts()[0] ?? (await browser.newContext())`.
5. **There is no service-worker restriction anywhere in the product path.**
   `git grep serviceWorkers <snapshot>` returns **zero** hits under `extensions/browser/src`
   (including that extension's own tests) and zero in non-test production code repo-wide. Every hit
   in the snapshot is a UI/e2e test or capture script for OpenClaw's *own* web UI
   (`ui/src/e2e/*`, `test/e2e/qa-lab/*`, `scripts/capture-*.mts`, `scripts/mantis/*`).
   `launchPersistentContext` is likewise test-only (`.chromium.test.ts` fixtures). This refines the
   earlier "CDP transport: Playwright attaches with `connectOverCDP()`" bullet: the attachment is
   real, and it carries **no** service-worker control.
6. **The default egress posture is direct, not proxied.** `buildOpenClawChromeLaunchArgs`
   (`extensions/browser/src/browser/chrome.ts:776-812`) pushes `--no-proxy-server` unless the
   operator supplied a proxy-control arg. `browser-proxy-mode.ts` strips inherited
   `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` (upper and lower case) so the launched Chrome
   follows only configured args, and resolves the navigation-guard mode to `direct` unless an
   explicit `--proxy-server`/`--proxy-pac-url`/`--proxy-auto-detect` routing arg is present.
   SSRF/navigation guarding is therefore **navigation-level**, not a socket-level pinned-IP proxy.
7. **The child inherits the ambient environment.** `chrome.ts:1071` spawns with
   `{ ...omitChromeProxyEnv(process.env), HOME: os.homedir() }` — proxy variables removed,
   everything else (including any provider API keys present in the host process env) passed through.
   Linux additionally gets managed `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` under an OpenClaw tmp dir.
   `--no-sandbox` is pushed when `resolved.noSandbox` is set.

**Consequence for BAZ-069.** The reference implementation offers **no mechanism to copy** for a
persistent-default-context service-worker control, and its network posture is weaker than Bazilion's
mandatory pinned-IP proxy (direct by default, ambient env inherited, optional sandbox disable).
Bazilion's `serviceWorkers: 'block'` is therefore Bazilion-specific defense-in-depth that exists only
because the current pool uses an ephemeral `newContext()`. Resolving the BAZ-069 T01 blocker is a
Bazilion policy decision — author a mechanism, or accept a documented egress-only posture — not an
upstream-parity question. An egress-only posture would still be strictly stronger than the upstream
reference.

## Controlled Linux comparison

Environment: Node **26.7.0**, Playwright **1.61.0**, installed Arch Chromium
**152.0.7977.82**; Bazilion's bundled Chromium **149.0.7827.55**. Display `:0`. Dedicated
scratch profiles, no operator profile/cookie import or login. Same machine and intended network
path throughout; actual public egress IP/VPN equivalence was not measured.

Seven explicit Google search navigations, at least 45 seconds apart. Same query:
`nodejs sqlite documentation`. No CAPTCHA interaction, hidden-marker patches, or automatic
retry in this round. The next action for a challenged variant was cleanup. Browser-generated
subrequests/redirects are not included in the seven-navigation count.

| Arm | Configuration | Observation |
| --- | --- | --- |
| A | Installed Chromium, direct minimal launch, fresh disk profile, debugging port enabled, **no automation attachment** | HTTP target metadata reported `/search` and a query title after 15 seconds. No DOM inspected: **not proof of usable results**, and not a genuinely manual user test. |
| B | Installed Chromium, OpenClaw-style explicit flags + fresh disk profile, CDP attached before search | `/sorry/`, no result headings; `webdriver=false`, five plugins. The launch shape alone did not avoid the challenge. |
| C | Same installed executable, Playwright `launchPersistentContext`, headed, fresh disk profile | `/sorry/`, no result headings; `webdriver=true`, five plugins. |
| D | Direct/CDP launch + **Bazilion SSRF proxy**, loopback bypass disabled; separate SW-blocked context | `/sorry/`; `webdriver=false`. Uses an ephemeral context, so **not** an end-to-end persistent-profile adapter qualification. |
| E | Actual Bazilion `invokeBrowserAction → pool → SSRF proxy`, headed | `/sorry/`; bundled Chromium 149, `webdriver=true`, five plugins. |
| F | Actual Bazilion pool, default headless, proxy retained | `/sorry/`; `webdriver=true`, zero plugins. UA string says Chrome while UA client-hint brands include HeadlessChrome: rewriting the UA string is not a complete fingerprint change. |
| G | Repeat A's fresh native launch; inspect target metadata before attachment, then inspect existing page after CDP attachment **without reloading** | Already at `/sorry/` **before** attachment, remained there afterwards; `webdriver=false`. The planned follow-on UI query was skipped. |

A's limited metadata and G's different outcome prevent attributing the challenge solely to
CDP attachment. No matched Mac run or ordinary manual Linux baseline was performed. The root
cause remains unresolved: launch flags, binary/version, profile state, timing/request history,
network and other browser signals were not all isolated.

### SSRF checks

- D attempted an HTTP navigation to an instrumented loopback fixture through the proxy:
  **403, zero fixture requests**. The diagnostic launcher explicitly used
  `--proxy-bypass-list=<-loopback>`; a direct-launch implementation must preserve this property.
- E/F used the real top-level navigation guard and refused a loopback URL before access.
- Existing deterministic browser proxy/SSRF/tool tests: **19 passed across three files**:

  ```sh
  pnpm vitest run apps/daemon/test/lib/browser-proxy.test.ts \
    apps/daemon/test/lib/browser-ssrf.test.ts \
    apps/daemon/test/runtime/browser-mcp-tools.test.ts
  ```

These are narrow checks, not fresh full browser security acceptance. Redirects, popups,
WebSockets, service workers and all other egress paths remain required implementation tests.
No guard was disabled in the production-pool runs. The direct-network comparison arms are
research controls, not a proposed production fallback.

## Bounded live re-measurement (2026-09-25, operator-authorized): does the launch adapter change Google's response?

Purpose: before adopting `launchPersistentContext` as the BAZ-069 adapter, re-measure whether the
launch architecture affects Google's challenge on this machine. Operator-authorized live lane,
outside the default Vitest run and the security-acceptance command.

**Budget and hygiene.** Exactly **three** Google navigations, ≥45 s apart (11:28:35Z, 11:29:35Z,
11:30:24Z). Same binary and version as the September 25 baseline: installed Arch Chromium
**152.0.7977.82**. Same query (`nodejs sqlite documentation`). **Headed** on `DISPLAY=:0`
(`/tmp/.X11-unix/X0` present), matching the baseline's headed arms — headed launch succeeded in all
three arms, so this is not a headless-only observation. Fresh scratch profile per arm; no cookie or
profile import, no login, no CAPTCHA interaction, no reload loop, no automatic retry, no UA or
fingerprint patching. Scratch profiles were deleted at the end; none is retained.

**Redaction.** Google's `/sorry/` interstitial echoes the requested URL as its title, including a
`sei` session identifier. Those identifiers are **redacted here**; only the path is recorded.

| Arm | Configuration | Observation |
| --- | --- | --- |
| R-A | **Control**: native launch, `--remote-debugging-port=0`, fresh profile, **no automation client attached**, no Playwright, `navigator.webdriver` never set | `https://www.google.com/sorry/index` — **challenged**. Title was the requested search URL (`sei` redacted). Metadata read via `/json/list` only; nothing attached. |
| R-B | `launchPersistentContext` + `executablePath`, headed, `chromiumSandbox: true`, `serviceWorkers: 'block'`, **SSRF proxy** with `bypass: '<-loopback>'` | `https://www.google.com/sorry/index` — **challenged**. 0 `h3` result headings, `navigator.webdriver: true`, `serviceWorkers: 0`, navigation itself did not error. |
| R-C | Same adapter, **direct** (no proxy) — research control | `https://www.google.com/sorry/index` — **challenged**. 0 `h3` headings, `webdriver: true`. |

**Conclusion.** All three arms were challenged, **including the unattached native control**. A
browser with no automation client, no CDP attachment and no `webdriver` flag was challenged on this
machine and network path. Therefore:

- **The launch architecture is not the variable.** Neither `connectOverCDP`, nor
  `launchPersistentContext`, nor a completely unautomated native launch avoided the challenge.
  Removing `--enable-automation` would not be expected to help either — the baseline's Arm B/G had
  `webdriver: false` and were still challenged.
- The proxy is not implicated: R-B (proxied) and R-C (direct) behaved identically. The proxy neither
  caused nor prevented the challenge.
- The adapter change is justified by **reliability and security**, and must not be represented as an
  anti-detection measure.
- Root cause remains a **research unknown** (binary/version, profile state, timing, request history,
  network/egress IP were not isolated). This re-measurement narrows it further — it is not the
  automation posture — but does not resolve it.

**Limits.** One machine and one network path; three navigations; no macOS lane; no human CAPTCHA
assistance attempted (so this says nothing about whether assistance can succeed); browser-generated
subrequests are not counted in the three-navigation budget. A challenge proves **error reporting**
only, never that results are unreachable by other means or on other networks. This is not a claim
that Google is unusable everywhere, and not a claim that any configuration defeats detection.

### Operator manual baseline (2026-09-25)

After the re-measurement, the operator confirmed that **ordinary manual Google use works
normally in their daily browser on this same machine and intended network path** — the ordinary
manual Linux baseline the September 25 study lacked.

**Caveats.** Observed, not instrumented; the daily browser's own network path (browser-level
proxy/VPN) was not verified; that session carried the operator's normal cookies, history and
consent state, unlike every study arm's fresh scratch profile.

**Consequence.** A whole-IP/whole-machine block is unlikely: the same IP and machine browse Google
normally. The differentiator is therefore **session state and behaviour**, not the network:
every study arm used a **cold, cookie-less, history-less profile** navigating **directly to a
`/search?q=` URL at t=0**, with no prior Google reputation for that profile. This is consistent
with the arm pattern — non-automated, `webdriver=false` arms were challenged too, so automation
signals are not required to trigger the challenge — and with Arm A's single metadata-only success
suggesting a probabilistic or reputation-window overlay on top. It does **not** identify a
mechanism or promise any configuration succeeds.

## Positive Agent-style workflow through the existing browser tools

Two explicitly separate Brave research trials (not a hidden fallback inside a Google call),
more than 45 seconds apart. Each used the real headed Bazilion pool with `allowPrivate=false`:

1. `browser_navigate` to `https://search.brave.com/`.
2. Observe textbox `Search` in the returned accessibility snapshot.
3. `browser_type` using that current ref, submit the query.
4. `browser_snapshot`: results include `https://nodejs.org/api/sqlite.html`.
5. `browser_click` on a source link from the observed snapshot.
6. The source opens a new tab. The first trial's snapshot remained on the search tab; it did
   **not** prove the source was read. The second trial listed tabs, selected the observed
   Node.js tab, and obtained **SQLite | Node.js v26.10.0 Documentation** at the source URL.

The second trial establishes **search → inspect → click → select tab → read source** through
production browser primitives and the SSRF proxy. It uses refs and page state, not a fixed
search-engine DOM scraper. The full saved source snapshot includes the module introduction and
an in-memory `DatabaseSync` example with insert/query operations (lines 527–576), not just the
title or table of contents. The returned search page included AI-generated prose; the source
page, not that prose, is the evidence for research claims.

The current tools returned **46,439 bytes** for the search snapshot and **234,883 bytes** for
the source snapshot. Merely truncating those at a small response cap would hide useful content.
The new story therefore needs bounded, ref-scoped reading or continuation, with explicit
truncation, as well as good tab guidance. This is an observed usability issue, not a reason to
replace page interaction with an engine-specific parser.

This was **scripted tool driving, not a live-model turn**. The source snapshot was inspected;
no wider research-quality or model-judgment claim follows. The form submission also carried
CR/LF in the query URL; acceptance should check input/submit semantics rather than treating
any loaded page as correct.

## Profile lifecycle and shutdown findings

- A synthetic, expiring `example.org` cookie was present before closing a direct/CDP profile,
  but absent after the first restart protocol (disconnect/termination path).
- A separate **offline** test set the synthetic cookie, requested `Browser.close` over CDP,
  observed process exit **0**, and relaunched the same dedicated profile. The cookie survived;
  the second close also exited **0**. No Google requests or real account cookies were involved.
- This supports graceful-close/readback acceptance, not a theory about Google trust. The two
  protocols also differed in settling time; exact cause of the first loss was not isolated.
- The six-arm runner finished all browser observations but stalled while awaiting resource/proxy
  shutdown. No owned Chromium processes remained; its Node runner was terminated explicitly.
  Later workflow/profile probes completed cleanup. **Baseline teardown is not a pass**; bounded
  shutdown and connection cleanup must be regression-tested in the new lifecycle.

## Evidence retention and remaining limits

Local-only artifacts (ephemeral):

- `/tmp/baz069-audit/controlled-study-baseline.mts` and `controlled-study.log`
- `/tmp/baz069-audit/controlled-study.mts` (`--followup`) and `followup.log`
- `/tmp/baz069-audit/browser-workflow.mts` and `browser-workflow-with-tabs.log`
- `/tmp/baz069-audit/profile-lifecycle.mts` and `profile-lifecycle.log`
- Browser observations under `/tmp/baz069-controlled-MGyHI8/` and
  `/tmp/baz069-controlled-mc78wM/`; successful workflow under `/tmp/baz069-workflow-XPMHxu/`;
  offline profile experiment under `/tmp/baz069-profile-xPbgLw/`.

Screenshots/profiles can contain challenge identifiers and cookies and are **not committed**.
This document is the durable, redacted observation record. The scripts are exploratory harnesses,
not product tests. Do not count skipped UI queries, human/macOS controls, full daemon/worker IPC,
or live-model research as passed. No production code, provider settings, personal profile or
release artifact was changed by the experiments.

## Consequence for BAZ-069

Proceed with the operator-selected **OpenClaw-style browser experience** for functional usefulness:
installed-browser discovery, isolated persistent profiles, daemon-owned lifecycle, and an
always-supplied browser-use guide alongside ordinary-turn `browser_*` tools. Do not promise that
it defeats bot detection. Drop the forced-engine scraper design, the universal Google claims,
and the proposed automatic mapping of browser visibility to engine availability. Keep all
Bazilion egress and restricted-turn boundaries. A working ordinary browser journey does not
qualify scheduled/protected content turns, which still have no browser capability.

---

## Gate B review package (2026-09-25): runtime/security review of T07–T10

**Reviewer:** the operator (acceptance below must come from a reviewer other than the
implementing agent). **Scope, per the plan:** actual default-context egress, retirement races,
worker binding, observation bounds. Method: this package's claims + an independent diff review
(`git diff` for modified files; untracked new files listed below) + independently run tests.

### 1. Default-context egress

**Claim:** every page the managed browser renders can only egress through the daemon's
validating SSRF proxy (unless the operator explicitly sets `BROWSER_ALLOW_PRIVATE_NETWORK=true`,
which is a labeled local-dev posture, never the default). The proxy resolves DNS itself,
rejects any host resolving loopback/private/link-local (403), and dials the resolved IP — no
re-resolve race between check and connect. Chromium's implicit loopback proxy bypass is
disabled (`bypass: '<-loopback>'`), so loopback targets also traverse validation. QUIC is
disabled (a proxy cannot carry UDP). The P2P/`RTCPeerConnection` API is removed from every
document in every frame via init script (proven necessary: the flag alone was insufficient —
see the Gate A re-measurement above). Service workers are blocked context-wide (cold-start
invariant); downloads are denied (`acceptDownloads: false`). The child env is a scrubbed
allowlist (`PATH`, managed in-slot `HOME`, `LANG`, optional display vars) — no provider keys,
no proxy vars, no ambient home.

**Where:** `guards.ts` (`managedLaunchOptions`, `managedBrowserEnv`, `MANAGED_DENIAL_ARGS`,
`MANAGED_INIT_SCRIPTS`), `proxy.ts` (`resolveSafeIp` → 403, single-flight lifecycle, tracked
sockets, generation guard). **Pinned by:** the gated lane
(`BAZILION_TEST_BROWSER=1 pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts`
— 11 tests incl. zero fixture hits for private targets, WebRTC removal, SW cold start, download
denial, no debugging port) + `browser-ssrf.test.ts`, `browser-proxy.test.ts`.

**Reviewer may independently:** re-run the gated lane; run a private-target navigation through
a live session and observe the bounded refusal; `ss`/tcpdump during a session to confirm no
non-proxy flow.

### 2. Retirement races

**Claim:** all lifecycle transitions are serialized per agent (a per-agent `withLock` queue) —
no launch overlaps a retirement for the same agent. A stopping slot counts toward capacity
until retirement is *proved*; capacity eviction only retires an idle, running session and
refuses (`browser_capacity_reached`) when all are busy. `recovery_required` is never reaped,
relaunched or revived; it fails every admission until an operator intervenes. A config change
(fingerprint drift) retires the old session before the next admission. The reaper skips busy
sessions and fires the same locked close. At shutdown, browsers close before the shared proxy.
Ownership (profile claim) is exclusive via a hard link + marker and is never dropped except as
retirement settles.

**Where:** `pool.ts` (`withLock`, `admitEntry`, `retireEntry`, `reapIdleBrowserSessions`,
`ManagedBrowserEntry.close`), `resources.ts` (reaper + shutdown ordering), `profile.ts`
(exclusive claim, stale reclaim). **Pinned by:** `browser-lifecycle.test.ts` (7 tests: launch
collapse, capacity refusal, busy-aware reaping, recovery_required permanence), `resources.test.ts`,
`browser-profile.test.ts`, `browser-launch.test.ts` (incl. SIGKILL crash reconciliation).

### 3. Worker binding

**Claim:** a worker's `browserInvoke` is denied at spawn for protected workers
(`protected worker rejects browser and MCP capabilities`) and restricted kinds
(forbidden-host list), and at dispatch for ordinary workers: the daemon host captures the
turn's canonical Agent id, admitted Team id, daemon paths and cancellation signal from the
turn's own binding, refuses a forged agent id / unknown action / non-object or > 64 KiB args /
aborted turn BEFORE any pool access, and always keys the pool on the canonical id — the
worker's claim is never the key. `browser_status` rides the same channel, intercepted
daemon-side, and provably never dispatches (never launches).

**Where:** `host.ts` (validation boundary), `agent-turn.ts` (canonical admission capture),
`spawn.ts` (`assertSpawnCombination`). **Pinned by:** `browser-mcp-tools.test.ts` (forged id,
unknown action, bad/oversized args, cancellation, canonical-id forwarding, status-never-dispatches,
status reflection), `worker-runtime.test.ts` (restricted spawn-time refusal, host never invoked).

### 4. Observation bounds

**Claim:** no browser result can be unbounded. Snapshots and all text-producing actions are
delivered in UTF-8-safe, line-aligned chunks within the 32 KiB response bound (metadata
included); the retained capture is capped at 512 KiB and an oversized DOM is detected via a
bounded stats walk (never by serializing unbounded first), captured depth-limited and NEVER
reported complete. Continuation cursors are daemon-memory-only, random, single-use,
agent/observation-bound, expire after 5 minutes, and require the captured document's identity +
mutation generation to still match (`browser_observation_expired` otherwise). Console/network
records are capped (100 each). Screenshots are refused — never silently truncated — above 8 MiB
decoded, checked from the PNG IHDR before decode. Non-observation action text goes through
`boundText`. The model-facing guide teaches the same bounds.

**Where:** `observation.ts`, `pool.ts` (dispatch), `guards.ts` (instrumentation init script).
**Pinned by:** `browser-observation.test.ts` (18 tests: surrogate/CJK safety, over-cap never
complete, expired/stale/cross-session cursors, invalidation matrix, screenshot refusal), plus
the live stale-ref/forged-id flow in `browser-live.test.ts`.

### Diff under review

Modified: `pool.ts` (rewritten onto the managed launcher + observation dispatch), `proxy.ts`,
`host.ts`, `agent-turn.ts`, `resources.ts`, `config.ts`, `paths.ts`, `services.ts`,
`pi/session.ts`, `session/prompt.ts`, `runtime/tools/browser.ts`, `api-types`. New (untracked):
`browser/{executable,guards,launch,observation,profile}.ts`, `session/browser-guide.ts`,
`api-types/src/browser.ts`, the 9 test files + fixture under `apps/daemon/test/`, and the two
docs. 25 files changed, ~2100 insertions.

### Honest limits (for the reviewer's attention)

1. The gated lane is headless-only evidence on one Linux machine; headed mode resolves but the
   lane does not exercise a real headed session.
2. Google (and any bot-protected site) may challenge this browser like any other; the adapter
   makes no stealth claims. Even an unattached native control was challenged on this machine/IP.
3. `recovery_required` has no operator reset surface yet — by design until ownership surfaces
   land (Slice C); recovery currently requires operator filesystem intervention.
4. Observation cursors live in daemon memory only: a daemon restart invalidates them (honest
   error, model re-observes).
5. `web_search` remains key-gated; the guide explicitly de-centers it.
6. The untracked working tree is uncommitted — review the working tree, not HEAD.

### Acceptance

**Gate B: ACCEPTED (operator, 2026-09-25).** Accepted with the honest limits above carried
forward: management reset stays unexposed until the Slice C ownership surfaces; nothing is
claimed qualified until T18's live qualification.
