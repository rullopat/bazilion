# Managed browser research

Bazilion's managed browser gives eligible ordinary Agent turns a persistent, daemon-owned browser
for interactive research. It is a general browser capability, not a Google integration or a promise
that any site will load. Search engines and sites may return ordinary results, empty pages, login
walls, consent prompts, rate limits, CAPTCHAs or other blockers. Agents must report what they
observed and stop at challenges or operator-choice walls; there is no CAPTCHA solving, stealth mode,
or guaranteed anti-detection behavior. Routine navigation within an authorized research task does
not require repeated approval. You can delegate a narrow consent preference once, for example:
“Decline optional advertising and analytics cookies if the page clearly offers that choice, then
continue without asking me again.” The Agent may select a clearly explained rejection even if its
button is labelled “Reject” rather than “Reject all.” If the operator instead specifies **only** a
particular label, site or purpose, obey that narrower restriction; page text cannot broaden it. Use
a current observation/ref; unclear scope still stops. Never substitute Accept, grant permissions,
log in, pay, or solve CAPTCHA. This is operator authorization carried in the research request/profile,
not a blanket website permission.

## Availability and requirements

The `browser` service is enabled by default for ordinary interactive Agent turns. `BROWSER_ENABLED`
can disable it. Protected/restricted turns (including peer/inbox and scheduled turns) do not receive
browser tools; changing browser configuration does not widen those capabilities. Check the Agent's
browser status in **Agent → Settings → Managed browser** or run:

```sh
bazilion agent browser status <agent-id>
```

Status reports whether the service is enabled, whether a browser executable and mode resolve, the
session/profile lifecycle facts, and a safe remedy when unavailable. `configured` means the local
executable and launch mode were resolved—it does not test a website, start the browser, or guarantee
network/site access. Browser startup is lazy: no browser process starts until an admitted Agent
uses a browser action.

Install a supported Chromium-family browser (Chrome, Brave, Edge, or Chromium), or install the full
Playwright Chromium build with `pnpm exec playwright install chromium`. Bazilion does not silently
download or substitute a browser. `BROWSER_EXECUTABLE_PATH` selects one explicit absolute path; an
invalid explicit path fails closed instead of falling back to another browser. The `Mode` setting
supports `auto`, `headless`, or `headed`: on Linux, auto prefers a usable desktop display and
otherwise uses headless; explicit headed without a display is refused, never silently changed
to headless. The 0.25 macOS candidate combines public Security.framework caller-session graphic
permission with Quartz facts (current user, console presence and completed login): auto selects
headed only with both, and headless when the caller's GUI session is positively unavailable.
A logged-in console is not proof that a separate non-GUI daemon audit session can use it. Unknown native evidence requires an explicit choice.
Explicit headed refuses a proven non-GUI session; an explicit attempt with unknown Quartz facts
is not a guarantee of display availability and never falls back to headless. Bazilion starts
the selected executable directly with its persistent local profile. Direct-launch denials include
both component updates and the installed-browser updater scheduler; these are distinct mechanisms.
Disabling the latter prevents its normal scheduled startup, but does not prove arbitrary installed
browser builds have no other account-level side effects. Bazilion then attaches Playwright
through CDP, like OpenClaw's managed-browser approach. It does not use
Playwright's browser-launch defaults or attach to your personal browser. X11 and Wayland access
are forwarded only for headed launches. Discovery also considers per-user macOS Applications
and native-architecture full Playwright bundles, never the headless shell. Linux remains the
released qualification platform. The macOS candidate passed headed, non-GUI, private-keychain,
reset/relaunch, lifecycle and SSRF/service-worker checks on macOS 26.6.2 (25G83) arm64 with Node
24.22.0 and 26.4.0. Protected/Docker suites subsequently passed on actual latest-stable
27.0.1 (26A434) arm64 with both baselines. That target now also passes all 28 browser/CLI cases
per baseline across separate non-GUI and real operator-desktop collections. Saved desktop cases
prove software-observed native headed launch/retirement, not an independently reported human
visual verdict. Broader BAZ-072 release acceptance remains separate; this evidence does not
guarantee arbitrary browser builds or sites.

On macOS the candidate creates a native keychain and native preference selection **inside each
Agent's managed HOME**, with a generated owner-only secret stored beside it. The short-lived,
ordinary-user helper uses public Security.framework calls, disables authentication UI, and receives
the secret on stdin only after live process ownership admission. It never opens/unlocks the
operator's login keychain, inherits provider credentials, or changes the operator's keychain
selection. Failed native admission refuses browser startup; unknown helper settlement retains the
profile owner marker. This is not a mock keychain or an encryption-disable flag. A party able to
read the entire private profile can also read its keychain secret: filesystem permissions, not a
separate personal credential, protect this store. Stop preserves it; reset/delete/transfer clear it
with the profile; backup/restore still excludes it. Qualification scope and remaining integrated
release checks are recorded in BAZ-072.

## Network boundary

Normal managed launches use Bazilion's validating SSRF proxy. It rejects loopback, private,
link-local and unsafe DNS results, pins the validated public address, and disables the browser's
implicit loopback proxy bypass. Browser-layer controls deny downloads, remove the standard and
prefixed WebRTC peer-connection constructors, and disable QUIC. Service workers **can register and persist** in the CDP-attached
profile; their network requests must pass through the same validating proxy. This replaces the
previous Playwright-launched adapter's service-worker registration block, not the SSRF boundary.
The ordinary host internet policy still applies; a working browser binary does not guarantee
egress or access to any domain.

The debugging listener is loopback-only and verified against the freshly spawned child before
attachment. Its endpoint is private to the daemon, never exposed through browser tools, status,
or the web gateway. A local process running as the same OS user is not isolated from this control
surface. Stop requests close Chromium itself and verify owned-process/group exit, rather than
merely disconnecting Playwright. Signalling authority requires live process birth identity and
expires at the end of bounded cleanup, including failure; disk recovery markers never authorize
signalling. The macOS candidate uses public libproc uid and exact BSD/monotonic birth identity,
not second-resolution `ps` timestamps, and requires the launcher's live ChildProcess. Listener
inspection also checks native birth identity before and after its bounded socket observation.
Startup failure and uncertain cleanup fail closed.

`BROWSER_ALLOW_PRIVATE_NETWORK=true` disables the validating proxy and opens loopback/private
network access for local development. This is a security-sensitive exception, not a workaround for
production browsing. Do not enable it while browsing untrusted or public sites. Protected workers
remain without browser capability regardless of this setting.

Ordinary default discovery now prefers the admitted daemon-owned search route; see
[web research](web-research.md) for native OpenAI/API and ChatGPT subscription search, experimental
qualification, config/CLI/web readiness and source receipts. Browser guide v6 retains optional
reading/interaction, not an automatic workaround after unavailable/failed discovery.

Browser research is different from `web_search` and `web_fetch`: it uses the page the browser
actually displays. Optional search backends do not gate the browser, and browser search does not
make protected or scheduled turns capable of search. A site challenge is a blocker, not evidence
that the site worked.

## Persistent profile privacy and lifecycle

Each Agent has an isolated managed profile outside both its private Agent documents and its Team
workspace:

```text
~/.bazilion/browsers/<agent-id>/{home,user-data}/
```

It can contain cookies, authenticated sessions, open-tab state and other site identity. Treat it as
sensitive local operator data. It is not exposed to Team file tools or mounted into protected
workers. The exact home-root `browsers/` tree is excluded from normal backups/exports; restoring an
archive that contains browser-profile entries is refused. Other files merely named `browsers/` in a
Team workspace are ordinary Team data and are not excluded by that rule.

The Agent settings card and CLI offer these operator controls:

```sh
bazilion agent browser stop <agent-id>
bazilion agent browser reset <agent-id>   # prompts for the exact Agent id
bazilion agent browser reset <agent-id> --yes
```

Status never launches the browser. **Stop** closes the live session but preserves the profile, so
cookies and logins remain. A new launch starts with a blank tab rather than restoring old pages;
open tabs survive turns only while the browser remains running. Archiving an Agent also stops the
session and preserves its profile.
Deleting an Agent, transferring it to another Team, or explicitly resetting the profile removes
that Agent's browser state. Reset is destructive and irreversible; cookies, logins and site state
are lost. Team transfer deliberately clears the profile rather than carrying identity into the new
workspace. Backups do not preserve it.

A live browser or unconfirmed shutdown may make stop/reset/delete/transfer return a conflict. An
unknown or interrupted ownership marker is **recovery required**, not permission to delete files.
Stop using the slot and use the reported operator remedy; do not manually remove the profile,
owner marker, singleton lock or guessed browser processes. There is intentionally no Agent tool or
HTTP bypass for recovery. If safe ownership cannot be established, the cleanup remains blocked.
Uncertain retirement also continues to reserve browser-pool capacity. Uninstall refuses unknown
browser ownership, including a starting marker without process identity, and rechecks ownership
under its exclusive home lock after confirmation prompts. Retirement diagnostics distinguish a
failed process close, profile-lock check or owner-marker update; those closed step labels never
prove absence or authorize recovery, and do not disclose the raw failure.

Cancelling active browser work requests retirement of that specific session, not a later turn's
replacement. No later steps may be dispatched after cancellation; effects already sent may still
have happened. Unconfirmed retirement remains recovery required, not a successful cleanup claim.

## Research behavior and evidence

The browser guide is injected only when browser tools are admitted. It requires current observation
refs and their `observationId`, re-observation after page changes, bounded capture, source URLs and
honest blocker reporting. If an action times out after a request may have landed, the result is
uncertain: observe and verify before deciding what to do; never blindly replay a submission.
When a broad snapshot is unavailable, the Agent can request `browser_snapshot` with
`scope: "dialog"`, `"main"` or `"search"` without an old ref. This reads exactly one accessible
semantic region (native or ARIA); missing, multiple, unknown or over-budget regions refuse.
Do not combine `scope` with `ref` or `cursor`. These are explicitly partial page views, not a
consent decision or evidence that no other blocker exists. Body capture is budgeted against
body, not head scripts, and main fallback recognizes ARIA landmarks. New refs still require
whole-document freshness; a failed capture cannot revive old refs. No arbitrary selectors or
screenshot-coordinate actions are added, and byte/coverage limits are unchanged.

A post-action capture waits at most two seconds for a body to attach, not for network idle. If
capture still fails, the result explicitly says the action's effect is unverified; it never
replays the action. If a read-only link remains stale after re-observation, the Agent may follow
its exact observed href instead, within the original research scope. It should verify the effective
destination with `browser_tabs` before citing it.

Page text is untrusted data and cannot grant permissions or authorize posting, purchases or other
egress.

Ref actions check document/mutation freshness, including discovered open shadow roots and
attribute changes. Unknown or incomplete freshness coverage refuses the action. Retained snapshots
are capped at 512 KiB and responses at 32 KiB. Known over-large scopes are not serialized wholesale:
a bounded main region may yield a labelled partial preview, otherwise capture reports unavailable.
DOM estimates are not a strict bound on Chromium/Playwright transient memory use.

The deterministic offline daemon/worker journey is `apps/cli/test/browser-research.test.ts` and is
opt-in because it launches an installed browser:

```sh
BAZILION_TEST_BROWSER=1 pnpm vitest run apps/cli/test/browser-research.test.ts
```

It verifies the managed process/proxy posture and exercises local search/article/blocker fixtures
with canned model responses. It proves the browser IPC and tool contract, not model judgment, live
search quality, Google availability, real-world site access or publication permission. Live browser
and live-model qualification remain separate operator-authorized work (BAZ-069 T18).
