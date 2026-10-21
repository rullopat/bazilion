# BAZ-069 — independent review (2026-09-28)

> Historical initial review. See [remediation and final re-review](BAZ-069-review-remediation.md)
> for the fixes, follow-up findings, final no-blocker recommendation and completed regression gates.
> The original findings below are retained, not retroactively rewritten as passes.

## Disposition at initial review

- **Revised adapter/security/lifecycle: CHANGES REQUIRED.** Five findings remain open. No
  implementation fixes were made during this review; the browser gate is blocked.
- **Human-assisted T18(a): reviewer recommends acceptance of the documented journey evidence.**
  This is not independently witnessed browsing, unattended success, acceptance of the unsafe
  adapter, T18(b), operator gate approval or release approval.

## Independence and provenance

The operator authorized independent review. A fresh Codex CLI 0.156.1 session used
`gpt-6-astra`, high reasoning, `--sandbox read-only --ignore-user-config --ephemeral`. It had a
review brief and repository access, not the implementation conversation. This is **separate-session
AI review**, not a separate human reviewer or a claim of model-family diversity. The brief asked
for defects and separate adapter/evidence dispositions, not approval. No Bazilion Agent/provider
qualification, public-site browsing or paid research service was invoked.

- Repository base: `ee2a896dd7306fc534f4192786b2697bfb60a2d0` plus the existing dirty working tree.
- All **71 dirty tracked/untracked files** were hashed before review and compared afterward:
  unchanged, including after the parent's isolated reproduction. No code/test/Git-state changes.
- Reviewer thread: `01a0e871-edee-7ba0-ba7a-c395d70566b9`; exit code 0.
- Local review artifacts: `/tmp/baz069-independent-review-h766Hn/` (`prompt.txt`, `events.jsonl`,
  `review.md`, `manifest-before.json`, reproduction scripts/log). These are temporary artifacts,
  not a durable transcript or profile store. This document retains the material findings.
- SHA-256 of original reviewer report:
  `22ebe68c954fc60d0296726bbf5230728aa20593491d6162eabc1f4325066bb3`.
- SHA-256 of initial dirty-file manifest:
  `9e0a63ef3774bbc47caedf41e8c5a9881f0af1fe817bba0619a49423818698ea`.

The reviewer inspected tracked and untracked browser implementation, relevant callers/tests,
security manifest and local verification logs. It executed in-memory reproductions only; no
browser, network research, credential access or repository modifications. The real-browser
WebRTC confirmation below was run separately by the implementation assistant **after** the
reviewer identified the alias gap, and is attributed separately.

## Findings — all open

### R1 — P1: cancellation can be followed by browser actions

`apps/daemon/src/lib/browser/host.ts:57` checks cancellation before dispatch, but admission can
await startup. `apps/daemon/src/lib/browser/pool.ts:342` publishes the session without rechecking
that signal; no browser abort handler retires it.

The reviewer independently reproduced cancellation during a suspended injected launch, then
released startup: the requested navigation executed and the session remained `running`. This
permits side effects after operator cancellation. The current workflow cancellation test
(`apps/cli/test/browser-research.test.ts:373`) cancels a pending provider response, not browser
startup or an active interaction.

**Required:** cancellation checks after asynchronous admission/queuing, owned-session retirement
for cancelled browser work, and regressions covering startup, queued and active actions.

### R2 — P1: prefixed WebRTC constructor bypasses the egress guard

`apps/daemon/src/lib/browser/guards.ts:40` removes only `window.RTCPeerConnection`.
`window.webkitRTCPeerConnection` remains callable on the installed Chromium. The launch flag
alone is already documented as insufficient against injected remote ICE candidates. The existing
real-browser test exercises only the standard constructor.

The reviewer proved that the actual guard leaves a two-alias fixture callable, but explicitly
**did not claim an actual UDP escape**. The parent then confirmed the escape in the installed
browser using the production direct-launch adapter and normal SSRF proxy:

- `/usr/bin/chromium`, headless, isolated scratch managed HOME/profile; no public-site navigation.
- Production fixture `launchLaneContext`, `getSsrfProxy` and `createUdpProbe`.
- On the guarded `about:blank` page, the standard constructor was `undefined`, the prefixed one
  was a `function`.
- Two prefixed peers completed an offer/answer exchange; a remote ICE host candidate pointed only
  at the instrumented `127.0.0.1` UDP port. After four seconds, the listener had received
  **65 datagrams, each 96 bytes**. This is a confirmed private-network/proxy bypass, not merely
  the presence of an API name.
- Both peers were closed, the owned browser and proxy closed, and zero owned browser processes
  remained before scratch profile deletion. Probe command exited 0.

Retained output excerpt:

```json
{"result":{"standard":"undefined","prefixed":"function","steps":["signaled","loopback-candidate-added"]},"loopbackDatagrams":65}
{"remainingOwnedBrowserProcesses":0}
```

Reproduction artifacts: `webrtc-probe.mts` and `webrtc-probe.log` in the directory above.
Script SHA-256: `3cc643cb7f952c58d76014ec2d7cbbafc0ee1941dbc4323859f33083646b3e75`.
Log SHA-256: `13fb43c5a5c6f912611351eaeaf28b8e15e171451fc0f5879fe0c6c10f488f2d`.

**Required:** deny all exposed peer-connection aliases and test actual offer/answer plus injected
loopback-candidate attempts through each, including relevant frame contexts. Previously passing
zero-UDP tests and the 190-case manifest do not establish the broader egress claim.

### R3 — P2: reused sessions are not marked busy

`apps/daemon/src/lib/browser/pool.ts:283` returns an existing session without incrementing
`busy`; action cleanup still decrements it. Only the initial admission increments at line 374.

The reviewer independently suspended a second navigation: `busy` was zero and
`closeBrowserSession()` successfully retired that active session. Further completed actions
can drive the counter negative. Capacity eviction can therefore close an actively used browser.

**Required:** increment every successful admission inside the admission lock; test reused-session
activity against close, eviction and other retirement, including nonnegative accounting.

### R4 — P2: failed cleanup retains stale numeric signalling authority

`apps/daemon/src/lib/browser/process.ts:333` throws before unregistering the group, and caches the
rejected `closing` promise. Later exit therefore cannot finish unregistering through another close.
The daemon exit hook at `process.ts:210` unconditionally SIGKILLs stored numeric groups.

If cleanup times out, the browser exits later and its group number is eventually reused, an
unrelated process group can be signalled. The reviewer established the code path, **not actual OS
identifier reuse**. A recovery marker is not indefinite permission to signal a numeric identifier.

**Required:** separate fail-closed recovery records from live signalling authority; validate live
identity before signalling and retire stale authority. Add deterministic cleanup-timeout → late-exit
→ identifier-reuse coverage.

### R5 — P2: explicit headed mode cannot work on macOS

`apps/daemon/src/lib/browser/executable.ts:287` returns `unsupported` for macOS display detection;
`executable.ts:308` requires `available` even for explicitly selected headed mode.

The reviewer independently exercised injected Darwin probes: `auto` and `headed` both refused,
while only `headless` succeeded. The remedy suggesting explicit `BROWSER_HEADLESS=false` cannot
resolve this. This is a code blocker, not only an unobserved platform qualification.

**Required:** support an explicit macOS headed attempt with truthful launch failure or implement
an appropriate platform check. Keep actual macOS execution/ownership/cleanup qualification separate.

## Additional evidence gap

The persisted-worker test clears private-target counters **after relaunch**
(`apps/daemon/test/lib/browser-managed.integration.test.ts:455`). It demonstrates post-attachment
fetch confinement, not zero target hits throughout startup before guard installation. Preserve
counters across relaunch and exercise restored activity during that interval. The amended allowance
for service-worker registration/persistence is not itself a rejection reason; proxy confinement
still needs adequate startup evidence.

## T18(a) recommendation and limits

The independent reviewer recommends accepting the **documented human-assisted journey evidence**:
five attempts remain incomplete; the sixth completed Google → NASA at 14:15:10–14:18:42 UTC,
with human CAPTCHA and cookie-dialog assistance in one isolated managed session. A failed
post-click capture was followed by tab inspection and a new source capture, not a replayed click.
See [the contemporaneous qualification record](BAZ-069-acceptance.md).

The reviewer did not witness the journey or inspect removed raw reports. This evidence does not
prove unattended access, challenge clearance after restart, real ordinary Agent judgment, or the
absence of R2's demonstrated bypass. The adapter rejection is not overridden by a successful
source-reading sequence. Operator acceptance remains a separate decision.

## Checks and next gate

The reviewer read logs supporting 2,096 passed / 35 skipped, 190 security cases, 12 headed X11
checks, 12 Wayland checks and two canned-model workflow checks; it did **not independently rerun**
these suites. The format log contains fixes/warnings and alone does not prove a final clean check.
The review's in-memory outputs included:

```text
after first action busy: 0
during reused-session navigation busy: 0
close accepted during navigation; close calls: 1
after cancellation: navigations: 2 state: running close calls: 1
```

Next: fix R1–R5, add adversarial regressions and startup-worker evidence, rerun targeted, actual-
browser and full/security regressions, then request independent re-review. At minimum:

```sh
pnpm vitest run apps/daemon/test/lib/browser-lifecycle.test.ts apps/daemon/test/lib/browser-process.test.ts apps/daemon/test/lib/browser-executable.test.ts
BAZILION_TEST_BROWSER=1 pnpm vitest run apps/daemon/test/lib/browser-managed.integration.test.ts
```

T18(b) still needs separate authorization; fresh packed-installer, web UI interaction, macOS
execution and release approval remain outstanding. Do not proceed as though the browser gate passed.
