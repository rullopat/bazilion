---
id: BAZ-072
title: Apple Silicon macOS feature parity with Linux
status: in_progress
size: XL
created: 2026-10-23
priority: high
target_release: '0.25.0'
---

# BAZ-072 — Apple Silicon macOS feature parity with Linux

## Current qualification decision

**Incomplete.** Implementation `9d1bc31` passes all ten jobs in CI `40242186202`, including both
Docker and browser/runtime baselines. Latest-stable physical qualification now exposes Node
26.4.0's upstream SQLite backup completion defect; its required source run fails. Node 24.22.0
contains the fix, first shipped on 26.x in 26.9.0. Changing the explicitly agreed Node baseline or
introducing a compatibility adapter requires an operator decision; neither has been done.

## User outcome and release intent

As an operator on an Apple Silicon Mac, I want the same Bazilion capabilities as on Linux,
without macOS-only feature refusals or a requirement to move coding, MCP or protected work to Linux.
The requested target is **0.25.0**. Apple Silicon is sufficient; Intel Mac qualification and
Windows support are out of scope.

This is implementation work, not a request to delete warnings or rename untested features as
supported. It supersedes none of the shipped 0.24 limits until replacements are implemented and
qualified. See [BAZ-057](../done/BAZ-057-portable-safe-reads.md) and
[released support](../../releases.md).

## Agreed support policy and technical floor

- Hardware: native macOS arm64 on Apple Silicon. Intel and Rosetta qualification are not required;
  this does not call for adding new Intel runtime refusals.
- Qualification: only the latest stable macOS version is available for testing. Record its exact
  version at qualification time; do not infer it from a runner's `latest` label. Older versions
  are untested, not automatically incompatible.
- Audited technical floor: **macOS 13.5**, not the tested 27.0.1. Both pinned Node baselines
  [declare arm64 13.5 support](https://github.com/nodejs/node/blob/v26.4.0/BUILDING.md#platform-list)
  and their actual arm64 Mach-O load commands target **13.5.0**. Active fs-safe, koffi, Pi terminal,
  SQLite and tree-sitter native artifacts target **11.0.0**; the public libproc, audit-session,
  Quartz and keychain APIs used here impose no higher floor. The optional llama/Metal artifact
  targets 14.0 but is not loaded by the admitted BM25-only path (qmd imports it lazily for LLM work).
  Selected browser/Git/Docker distributions retain their own prerequisites. This audit is not
  execution qualification on 13.5 or intervening releases, and adds no older-OS refusal or bypass.
- Node: retain `^24.22.0 || ^26.4.0`, with real arm64 coverage of both supported lines. Do not
  silently narrow the engine range to make macOS qualification pass.
- Parity means the same supported capabilities and safety contracts, not identical OS mechanisms,
  universal filesystem support, provider entitlement or guaranteed access to external sites.
- Linux remains supported with its existing protections. OS-independent prerequisites and
  capability restrictions stay: Docker/image availability, credentials, Team Policy, approvals,
  restricted-worker tool admission and unknown-ownership refusals.

## Concrete implementation scope

### 1. Safe repository access and hardened Git

Extend the existing capture substrate and **single** `lib/git/capture.ts` implementation with a
macOS worktree-access strategy whose safety contract is established before admission. Merely
returning a pathname from `ContextDirectory.gitWorktreePath` is not sufficient. Preserve bounded
metadata capture, neutral Git configuration, no repository-configured helpers, read-only
inspection, source identity/freshness validation and Linux descriptor-relative access. Do not
claim that guarded pathname observations are atomic snapshots.

Enable the dependent source snapshots, retained command evidence, change review, specialist
review/verification and operator-controlled publication workflows on supported Macs. Keep captured
source/environment contracts immutable; refuse drift rather than substituting bytes. Publication
stays deterministic and owner-controlled, with no model publication tool or force push.

### 2. Owned process lifecycle and MCP stdio

Implement macOS ownership/retirement for MCP stdio and the worker/resource paths needed for parity.
Do not remove `assertStdioPlatform()` before a safe replacement exists. Preserve opening-client
retirement, busy reaping, cancellation, bounded escalation, descendant checks and ownership until
close settles. Exercise surviving children that ignore TERM or close inherited pipes; leader exit
alone cannot release a slot.

Worker completion, cancellation, daemon shutdown/restart and supported workspace recovery must
have explicit macOS behavior. Persisted PID/group numbers or restored receipts alone never
become signalling authority. Unknown ownership still blocks, on both platforms. Arbitrary detached
host-writer recovery is not promised by Linux today and is not a new requirement here.

### 3. Managed browser usability and lifecycle

Resolve the macOS `auto` launch-mode limitation with explicit, tested GUI-session semantics,
including non-GUI daemon use. Preserve explicit-mode behavior and truthful refusal rather than
silently substituting a different explicit selection. Qualify installed Chromium-family discovery,
headed/headless use, direct owned launch, listener verification, CDP attachment and stop/reset.

Retain persistent-profile privacy, validating SSRF proxy coverage (including service workers),
download denial and conservative ownership/cleanup. No stealth, CAPTCHA bypass or guarantee of
Google/site access. Browser/MCP admission remains denied to protected and restricted turns.

### 4. Protected and background execution

Implement any missing macOS adapters required for Docker-backed coding, credential-minimal
protected turns, restricted review/verification, scheduled/inbox turns and resource settlement.
Qualify an actual local Apple Silicon Docker runtime, image architecture and mount behavior;
synthetic Docker responses are not proof of container execution. Missing prerequisites fail closed,
never fall back to host execution. Preserve workspace exclusivity, read-only private inputs,
network/credential boundaries, approval handling and scheduler at-most-once/uncertain semantics.

### 5. Remaining supported user journeys

Exercise fresh installed CLI/API/web workflows on macOS arm64, including provider login/refresh,
text/image input, file Results, shared memory, search, image generation/rework and authorized
result delivery. Retained results, approvals, backup/restore, linked Teams and upgrade/refusal
behavior must retain their existing contracts. Fix macOS-specific defects found in these paths.

Image generation must receive actual macOS qualification for the already accepted ChatGPT route;
Linux observations are not transferable evidence. Keep direct OpenAI/OpenRouter live-unqualified
where they are also unqualified on Linux. Provider-backed tests require separately authorized
credentials/spend; this story does not authorize paid calls or use of personal accounts.

## Acceptance criteria and release gates

1. Document the audited technical minimum separately from the tested OS. CI and installed-release
   jobs run on the latest stable macOS available for qualification, assert actual `darwin`/`arm64`
   and report OS, architecture and Node versions. Cover both supported Node lines. Simulated
   platform branches cannot establish support; older macOS releases remain explicitly untested,
   not an additional hardware/test-matrix requirement.
2. Hardened Git and MCP stdio work on actual Macs, with adversarial filesystem/process tests,
   cancellation and failure-path cleanup. Previously Linux-only suites covering now-supported
   capabilities run on macOS; remaining skips are individually justified, not treated as passes.
3. A captured coding change completes the command-evidence, snapshot, review, verification and
   owner-publication paths on macOS, including changed-source refusal and uncertain-effect handling.
   The local publication adapter can establish deterministic host-independent behavior; live host
   publication needs separate authorization and cannot be inferred from a local pass.
4. Actual macOS managed-browser and Docker/protected runs pass the scoped lifecycle and security
   checks above. Scheduled/inbox execution retains its narrower tools and policy enforcement.
5. Installed CLI/API/web journeys and authorized ChatGPT image generation/rework run on macOS.
   Synthetic provider/transport checks, live-provider results and human visual acceptance remain
   distinct; no missing live acceptance is relabelled as a synthetic pass.
6. Linux regression, typecheck, lint, build/pack, security acceptance and upgrade gates pass. Extend
   relevant security gates for macOS rather than simply disabling their Linux-specific assertions.
   Preserve the clean-install schema contract; no ALTER/import/compatibility adapters.
7. Update the CLI/web platform report and tests only as execution paths become supported. Update
   README, platform/product guides and the separate website consistently before release; keep
   remaining prerequisite/provider/security limits explicit. Do not change historical release
   evidence into broader claims.
8. Publish 0.25.0 only after these gates pass for the agreed support matrix. The release statement
   is **macOS Apple Silicon feature parity with Linux**, not an unbounded “100% compatible” claim.

## Open work and sequencing

- Git, MCP stdio, owned-worker, managed-browser and protected/background implementations have
  observed acceptance. Latest-stable arm64 hardware/local Docker and the separate technical-floor
  audit are available. Older-OS qualification is not required or inferred.
- The bounded workstream goal now has actual latest-stable desktop/non-GUI, source, installed,
  local Docker, Linux/security/upgrade/build evidence on both Node baselines. Retain the explicit
  hosted TCG capacity failures; do not call the current CI run all green or infer universal Docker
  performance. Ordinary SSH remains non-GUI; no privileged personal-Mac fixture was used.
- Keep unrelated release acceptance open, including separately authorized live-provider/image
  generation and any remaining broader captured-change workflows. The bounded implementation
  goal is not all eight release gates and does not authorize publication, website deployment or
  version bumps. Keep concise outcomes here and in CI/PR records, not progress/evidence sidecars.

## As built

The initial Git increment extended the single hardened inspector while retaining Linux fd-relative
access and adding a bounded private-worktree backend for macOS. Ignore-aware guarded copying,
independent source validation, frozen snapshot bytes and scratch disposal have focused tests on
Linux; Git capture/changes/identity suites run on the actual macOS CI path. Initial candidate
`0ae74d6` passed all eight jobs in [CI](https://github.com/rullopat/bazilion/actions/runs/39955676046),
including Linux/macOS source/build/installed trials, the existing security/upgrade gates and all 67
focused cases on actual macOS **26.6.2 arm64**, Node **24.22.0** and **26.4.0**. The hosted
`macos-latest` label is not latest-stable OS qualification; that remains a separate release gate.

The follow-up admits the source-snapshot suite to macOS with explicit private/live backend read
contracts, updates CLI/web Git capability diagnostics, and adds seven BAZ-072 cases to the security
manifest. See [repository context](../../repository-context.md) for bounds and layout limitations.

Local normal-suite tests, the expanded 406-case security gate, lint and root/web typechecks passed.
Follow-up `6cdd512` passed source/build, security/upgrade and focused macOS jobs in
[CI](https://github.com/rullopat/bazilion/actions/runs/39957517544), but the installed macOS trial
failed on its stale expected Git-unsupported projection. The fixture expectation is corrected;
installed revalidation passed with all eight jobs at `7bbcb3c` in
[CI](https://github.com/rullopat/bazilion/actions/runs/39969375375). An initial root/PID-namespace invocation failed browser startup, permission-sensitive
backup and delayed-child settlement checks; the normal suite passed without relaxing checks. A concurrent security run timed
out; a standalone run passed. These do not establish macOS qualification.

Latest-stable macOS acceptance, broader coding workflow acceptance and private-worktree layout
parity remain open. Browser/protected lifecycle work, image/live acceptance and the technical-minimum
audit are not implemented/qualified by the Git increment. No version bump, publication or expanded
released-support claim has occurred.

### MCP stdio — bounded native macOS checks passed

The next increment adds daemon-only public libproc inspection through pinned `koffi@3.3.3` in the
daemon and packed CLI. Its install script stays disabled; prebuilt loading needs no compiler or
shell process-inspection fallback. Admission checks native identity/list access before client/slot
allocation and spawn. Exact BSD and monotonic Mach birth facts, uid/session/group checks, bounded
enumeration and empty-group confirmation feed the shared retirement guard; Linux keeps `/proc`.
Unknown identity never enters Pi's unsafe native close or gains permission to signal stored PIDs.

Candidate `21ab568` passed all eight jobs in
[CI](https://github.com/rullopat/bazilion/actions/runs/39979009335): source/build, guarded installed
Linux/macOS trials, upgrade checks and all 418 required security cases. Actual **macOS 26.6.2
arm64**, Node **24.22.0** and **26.4.0**, each passed 153 focused Git/process/MCP cases (four legacy
Linux `/proc`-mock cases remain Linux-only, with separate Darwin coverage). Native cases exercised
real libproc birth/group observations; stdio cases exercised tool invocation, cancellation/busy
reaping and opening/failed-initialization retirement. The installed macOS trial loaded the packaged
native path, discovered the fixture catalog and retired its descendants with install scripts off.

Local normal-suite checks passed 2,753 tests with 50 skips (49 existing plus the actual-Mac-only
native case). The CLI/web capability/help follow-up passes its focused checks and root/web
typechecks locally; it describes native-owned stdio without running probes in passive reports.

The MCP stdio milestone is implemented and has bounded native/protocol evidence. This does not
qualify worker/browser/protected process parity or latest-stable macOS: the hosted runner reported
26.6.2. Those milestones, broader layout/coding acceptance and unrelated image/live criteria remain
open; no merge, release publication, package-version bump or website deployment is authorized.

### Worker ownership — implemented, bounded platform evidence

The candidate now records live ChildProcess authority plus the shared public-libproc birth,
uid/session/group observations before executable input, checking native readiness before spawn.
Original-group anchors are captured while the parent is live, before termination; later escalation
revalidates an original anchor. Unknown descendants are never adopted after leader exit, and a
stored/restored PID receipt cannot reconstruct a live owner. Linux retains its `/proc` path.

Independent close/coded-exit/natural-EOF facts are not success verdicts or receipt signalling
permissions. Natural EOF, actual child closure and original-group absence govern cleanup. Coded
nonzero exit can establish cleanup without becoming successful execution; forced host-command
termination still cannot prove detached work stopped. Unknown cleanup retains its writer and
private scratch. Cleanup confirmation now atomically requires the exact resource identity,
creation acknowledgement and owned (not restored) writer, preventing asynchronous metadata drift.

A shutdown integration gap was also fixed: the scheduler stops, new turn registrations are fenced,
active controllers abort and registered turns settle before long-lived resources/DB close, within
the existing shutdown cap. Local real daemon/worker tests exercise active-turn shutdown, no retained
writer after settlement and a new explicitly requested turn after restart. Focused Linux checks
pass (60 tests), as do root/web typechecks. The security manifest now names 431 required cases.

Initial candidate `c275bb7` passed the nine native worker, five native workspace and real
daemon/worker shutdown/restart cases on actual **macOS 26.6.2 arm64**, Node **24.22.0** and
**26.4.0**, but both focused jobs failed the broader runtime's exact-environment assertion:
CoreFoundation added `__CF_USER_TEXT_ENCODING` after exec. Production minimal bootstrap now removes
only that OS-generated bookkeeping key before the unchanged exact key/value validator; the
six-key assertion and rejection of other ambient variables remain. The security gate also exposed
an omitted describe-prefix in its new readiness-case name; that exact manifest name is corrected.
Those failed candidate checks remain failures, not relabelled passes. Fixed candidate `164c61b`
passes both baseline jobs in [CI](https://github.com/rullopat/bazilion/actions/runs/39991428077):
**237 passed** per job, four existing Linux `/proc`-mock cases separately covered on Linux, on
**macOS 26.6.2 (25G83) arm64**, Node **24.22.0** and **26.4.0**. This includes native normal/abnormal
settlement, ignored-TERM original descendants, no adoption of unknown descendants, local-pipe EOF
refusal, workspace exclusion, receipt substitution, restart/restore refusal, supported management
acknowledgement and real active-turn daemon shutdown/restart. Packaged Linux/macOS trials and the
431-case CI security gate also pass. Documentation follow-up `7f96470` passed all eight jobs in
[CI](https://github.com/rullopat/bazilion/actions/runs/39992654254), including full Linux/macOS
source/build, packaging and upgrade checks. The earlier `164c61b` run's unfinished jobs were
cancelled by that new push, not recorded as passes.

Local normal-suite checks pass **2,767 tests / 64 skips** (the prior 50 plus 14 actual-Mac-only
worker/workspace cases); all **431 required security cases** pass standalone. Root/web typechecks
and lint pass with existing warnings. The broader worker-runtime suite now runs on macOS after
canonicalizing temporary fixture roots and forwarding actual child/lifecycle hooks. The worker
milestone has its bounded real-platform evidence, not actual Docker, live-provider, GUI-browser or
latest-stable qualification. Those later milestones and unrelated BAZ-072 acceptance remain open.

### Managed browser — in progress

The next candidate reads public Quartz-session facts rather than Unix display/TTY guesses for
macOS auto mode. Current-user console/login evidence selects headed; a positively non-GUI session
selects headless; unknown/malformed native evidence requires an explicit choice. Proven non-GUI
headed requests refuse, never silently switch. Discovery includes system/per-user applications
and native-architecture full Playwright Chrome-for-Testing bundles, not the headless shell.

Browser group ownership now uses the shared public libproc exact birth/uid/session facts instead
of second-resolution `ps` timestamps. The real Darwin group authority requires the fresh launcher's
ChildProcess; persisted marker PIDs cannot reconstruct it. Native readiness precedes profile
preparation/spawn, original leader identity is checked around CDP admission, and bounded listener
inspection rechecks native birth identity before/after. Darwin group absence uses native bounded
inspection with unknown states retained, never a guessed cleanup confirmation.

Local focused checks pass **67 cases**, with one actual-Quartz case appropriately waiting for a
Mac, plus root/web typechecks. Native GUI and existing browser process/profile/launch cases are
added to both baseline jobs. Five new adversarial cases bring the manifest to **436**; their gate
passed in [CI](https://github.com/rullopat/bazilion/actions/runs/39996145521) for candidate
`7bb1d05` (all eight jobs). Actual **macOS 26.6.2 (25G83) arm64**, Node **24.22.0** and **26.4.0**,
passes **305 focused cases** per job; public Quartz reports an available console session for
uid 501. These are native-adapter facts, not yet actual headed/browser/non-GUI qualification.

The actual managed-browser lane is now being extended to macOS without removing the Linux
assertions or OS-independent SSRF, download, privacy, observation and lifecycle checks. Native
process evidence uses bounded public libproc/sysctl argv/environment observations for the exact
profile; Linux retains `/proc`. Linux's zygote evidence remains; macOS checks the renderer's
Seatbelt policy channel instead. The existing Linux real-browser/worker lane passes 25 cases.
A controlled Mac child uses public `SessionCreate(0, 0)` before application/security handles to
establish only its own transient non-graphical session, then must actually select headless, refuse
headed, launch and retire the real managed browser. It changes no operator login or system
configuration; refusal is a failed check, never an escalation or fallback. Both baseline jobs
request actual headed and headless/browser lanes.

Candidate `bd02a3d` **failed** the actual browser lane on both Node baselines in
[CI](https://github.com/rullopat/bazilion/actions/runs/39998984396): **24 failed / 3 passed** per
job, with an additional unhandled cancellation assertion. Native argv inspection reported
`Darwin process arguments cannot be inspected`; several controlled local navigations timed out.
The non-GUI child was refused by `SessionCreate` with status **100001** on both baselines. This
runner therefore did not establish the required non-GUI context. No privilege escalation,
session/system-configuration change, fallback, test weakening or qualification claim followed.
Other six CI jobs passed, including the 436-case security gate, source/build, installed trials and
upgrades. Browser milestone remains incomplete. Work pauses for an operator-authorized actual
non-GUI Apple Silicon Mac/runner context; argv/navigation defects also remain to diagnose and fix.
The hosted OS remains 26.6.2, not latest-stable qualification.

Resumed diagnosis on the existing runners: `72ceb42` in
[CI](https://github.com/rullopat/bazilion/actions/runs/40076545771) narrowed native process
observation to the launching uid, checked process state before argv reads, and added bounded
controlled-fixture diagnostics. Native argv/sandbox assertions now pass; the Node 24 browser lane
improved to **8 passed / 19 failed**, not a qualification pass. Navigation and the exact browser-env
assertion still fail. The non-GUI fixture reports existing graphic access, then status 100001 with
**errno 1 (EPERM)**. Apple's public Authorization.cpp/ccaudit.cpp implementation confirms that
SessionCreate calls setaudit_addr; XNU's public audit_syscalls.c explicitly calls suser in that
syscall before changing audit identity. The current unprivileged fixture therefore needs an
authority decision, not more mode guessing. No privilege escalation or alternative
session/configuration change is attempted. This fixture's failure is not proof that every authorized runner setup is
incapable of non-GUI qualification.

Diagnostics also observed installed Google Chrome starting GoogleUpdater, touching the actual
runner-user application-support tree and requesting Google's update endpoint despite the component
update denial. This is an unresolved isolation finding, not an accepted browser qualification or
permission to modify operator settings. Chromium's distinct documented
`--disable-updater-scheduler` denial is now added to direct launch and asserted alongside the
component-update denial; real-platform revalidation remains required. No browser substitution or
weakened network/ownership checks hide this finding. CI additionally exposed an intermittent Linux
MCP cancellation-retirement failure (retained slot, followed by two teardown cascades); the
standalone 436-case security gate passed, but the failed full Linux run remains failed.

Local follow-up with the updater denial: the normal full suite passed **2,777 tests / 66 skips**;
the standalone **436 required security cases**, root typecheck, **49 focused browser/process/MCP
cases**, and **25 actual Linux browser/worker cases / two platform-only skips** passed. The
cancellation test now observes invocation settlement immediately and reports an early navigation
failure instead of leaving a detached rejecting assertion; it still requires actual cancellation
and complete owned-process/marker retirement. The MCP test explicitly awaits the cached close
result to expose a retained-slot error without retrying, force releasing or weakening ownership.

Updater-denial candidate `8c9b230`,
[CI](https://github.com/rullopat/bazilion/actions/runs/40078464440): six non-runtime jobs passed,
including Linux/full source builds, installers, upgrades and the 436-case security gate. Each Mac
baseline passed 305 focused cases (four Linux-only mocks skipped), but actual browser qualification
still failed: Node 24 **7 passed / 20 failed**, Node 26 **8 passed / 19 failed**. No GoogleUpdater
startup appeared in the new controlled stderr; this absence alone is not an account-isolation proof.
Bounded read-only native samples on both baselines observed the browser inside SecItemAdd,
defaultKeychainUI and makeLoginAuthUI while controlled navigation remained pending. No mock
keychain, encryption downgrade, keychain creation/unlock/preferences operation or privileged session
helper was used. Continuing with CI keychain/session provisioning requires explicit operator
approval; alternatively an approved Apple Silicon environment can supply those prerequisites.
Other unresolved fixture findings remain explicit: the environment decoder appears to include
Darwin's post-environment apple-vector entries (ptr_munge/main_stack/etc.; do not widen the env
allowlist), and a same-user process-exit/start race produced KERN_PROCARGS2 EINVAL on Node 24.
These findings require bounded parser/identity fixes, not skipped checks. Browser, protected and
latest-stable integrated milestones remain incomplete.

The operator subsequently authorized provisioning and resumed the goal. The next candidate adds
an explicitly GitHub-hosted-Apple-Silicon-only temporary test keychain with a generated disposable
password, mode-0600 state, original account selection capture and always-run restoration/deletion.
No personal keychain is unlocked or read. A minimal privileged CI child creates its own audit
session and binds the runner audit uid, permanently drops supplementary groups/gid/uid, then
execs ordinary-user Node before tsx/application/browser imports. Its new audit session unlocks
only the disposable test keychain after privilege drop. This is test infrastructure, not a product
privilege capability or a mock-keychain/encryption relaxation; desktop session facts and headed
refusal remain actual native assertions. New parser tests preserve unexpected real environment
variables while stopping at the first empty native entry instead of filtering padding and adding
apple-vector strings. EINVAL is ignored only with a fresh positive exit/zombie/uid-change
observation. Cross-platform parser/account-refusal tests (six), root typecheck, and 25 actual Linux
browser/worker cases passed locally. `be51f9f` / [CI 40086104934](https://github.com/rullopat/bazilion/actions/runs/40086104934)
proved that setup/restoration and root-to-runner privilege drop worked on both Mac baselines;
each passed 311 focused cases (four Linux mocks skipped), but actual browser remained **9 passed /
18 failed**. The parser/env assertion now passes. The fresh caller audit session had no graphic
permission while the Quartz-only adapter still saw console information: this exposed a real mode
admission defect, not an unavailable runner. Runner-wide keychain setup also could not satisfy
private browser HOME preferences. Apple's public DLDBListCFPref.cpp explicitly resolves those
preferences through HOME, explaining the continuing keychain UI samples. All six other CI jobs
passed. One local full run failed a content-Team coordinator cleanup assertion under load (2,782
passed / one failed / 66 skips); its isolated rerun passed, not a relabelled full-suite pass.

The next product candidate therefore combines public caller SessionGetInfo graphic permission
with Quartz console facts and provisions a native keychain **inside each managed browser HOME**.
It uses public Security.framework APIs in a short-lived ordinary-user helper, disables UI, sends
the generated owner-only profile secret on stdin only after exact live birth/group admission,
and reuses existing OwnedDarwinWorker EOF/group settlement. Unknown admission or retirement keeps
the profile recovery marker; coded/timeout/native failures refuse startup. No mock keychain,
encryption-disable flag, personal keychain selection, root product path or browser substitution
is introduced. The helper is a separately packed CLI payload; private keychain/preferences/secret
state follows the existing browser profile exclusion/reset/deletion contract. Cross-platform
private-path, credential, redaction and ownership-failure tests expand the required security gate
to **447 cases**, passed locally along with the 25 actual Linux browser/worker cases, root
typecheck and bundled build. Actual native private-keychain and complete browser requalification
on both Mac baselines remain pending.

The first private-keychain candidate `c602ae0` /
[CI 40088437522](https://github.com/rullopat/bazilion/actions/runs/40088437522) failed at native
SetSettings (status -25293) on both baselines: **318 focused cases passed / six failed / five
platform-only skips**; the actual-browser step was therefore not reached. No failed assertion was
weakened. Public SecKeychain.cpp ignores useLockInterval when setting policy, while Apple's
security(1) source uses INT_MAX, not zero, for no timeout. The follow-up corrects that encoding and
reads the native settings back before admitting the browser. It also requires coded helper exit
alongside EOF/absent group because Security.framework can request external system-service writes;
a forced exit cannot acknowledge those side effects. Unknown settlement retains recovery.
The expanded **448-case security gate** and root typecheck passed locally. A fresh normal Linux
full suite passed **2,797 tests / 67 skips**; the earlier failed full run remains recorded above.

`d0a1410` / [CI 40089482047](https://github.com/rullopat/bazilion/actions/runs/40089482047)
passed all six non-runtime jobs and **325 focused cases per Mac baseline / five platform-only
skips**. Native private keychain create/reopen, caller-account default preservation, actual headed
and non-GUI screenshots, process/marker retirement, service-worker persistence/egress and the
other direct-browser cases passed on both Node versions. Each actual lane was **26 passed / one
failed**: the CLI's second research scenario timed out waiting for body attachment after a tab
switch. The bounded capture deadline is unchanged. Inspection found logical tab selection did not
activate the native page; two new deterministic lifecycle tests fail before correcting that
behavior. The next candidate awaits native bringToFront under the same entry lease, invalidates
old authority before activation, and refuses fresh-ref publication on activation failure. It adds
an actual select/observe/navigate regression and strengthens the non-GUI fixture's permanent-drop
and final native-session assertions. The **450-case security gate**, root typecheck, 79 focused
observation/lifecycle cases, and **26 actual Linux browser/worker cases / two platform-only skips**
passed locally. In `4a9d113` /
[CI 40090814788](https://github.com/rullopat/bazilion/actions/runs/40090814788), all six other
jobs and Node 24's **355 focused / 28 actual-browser cases** passed. Node 26 passed the same 355
focused cases and both CLI research/cancellation journeys, but its actual suite was **27 passed /
one failed**: the fixture read proc_pidpath after a matched process exited during crash retirement.

The follow-up rechecks birth/liveness before rejecting that path read and waits inside the same
retirement bound for a fresh positive absence observation; UNKNOWN never counts as empty. Fixture
cleanup now requires confirmed launches/retirements, no remaining owners and positive absence;
uncertain slots are retained, not manually removed. CLI qualification additionally resets the real
browser profile, verifies keychain removal, launches a fresh profile with a different secret digest,
and resets it again. Native qualification now checks caller search-list preservation too.
The WebRTC exposure control is credential-scrubbed and explicitly removes Playwright's default
mock-keychain flag, using the same real private keychain path as the product. The temporary
runner-wide account keychain setup/unlock is retired as unnecessary: only the process-private
non-GUI audit-session bootstrap needs explicitly opted-in hosted-CI privilege, with ordinary-user
execution after permanent credential drop. Closed command-construction/refusal tests cover that
boundary; no product sudo path is added. Root typecheck, **453 required security cases** and
**26 actual Linux browser/worker cases / two platform-only skips** passed locally. The final
both-baseline Mac reset/retirement rerun then passed in `81c331d` /
[CI 40095104539](https://github.com/rullopat/bazilion/actions/runs/40095104539): **all eight jobs
passed**, including both actual Mac browser lanes. Each baseline passed **357 focused cases /
five platform-only skips** and **all 28 actual-browser cases with no skips** on macOS **26.6.2
(25G83), arm64**, using Node **24.22.0** and **26.4.0**. This includes native keychain
create/reopen and caller default/search-list preservation, headed and genuinely non-graphical
caller-session screenshots, permanent privilege drop, native tab activation, complete CLI
research/cancellation and actual reset/relaunch with changed secret digest, SSRF/persisted-service-
worker egress, crash retirement and strict fixture cleanup. Local whole-tree typecheck/lint and
**2,801 normal tests / 68 skips**, **453 required security cases**, and **26 actual Linux browser/
worker cases / two platform-only skips** passed. The managed-browser milestone is complete for
this observed environment; it is not latest-stable integrated qualification or release readiness.
Protected/Docker/background execution is now active; final latest-stable qualification follows.

### Protected execution qualification (in progress)

The existing Docker backend already admits supported POSIX numeric uid/gid hosts and uses a
local Unix endpoint, pinned executable/image identity, clean env-fd input, recursive-bind denial,
read-only inputs and exact-container settlement. No platform-independent admission control was
removed to force Mac execution. Nine actual Docker/scheduler-inbox integration cases passed on
the local Linux Docker 29.9.1 / linux-amd64 engine. The obsolete Linux-only gate on the dead-runtime
refusal journey is extended to the already-supported macOS operator-turn path.

New hosted Apple Silicon jobs on both Node baselines provision an owned local ARM Docker VM
through Colima/Lima/QEMU, sharing the canonical home/temp paths needed by real mounts. They record
host OS/architecture/Node, exact VM accelerator/CPU through birth-bound native argv observation,
Docker engine/image architecture and real container uname; TCG, if selected, is explicitly CPU
emulation, never synthetic Docker responses or Intel/Rosetta qualification. Only public images
are pulled during explicit CI provisioning; runtime commands retain pull-never and fail closed.
Real filesystem/env/network isolation, cancellation, create/restart recovery and protected inbox
boundaries remain required.

The first actual VM run (`f5e8b2c`, CI `40098342588`) established local Docker execution on
macOS **26.6.2 (25G83) arm64**, Node **24.22.0 / 26.4.0**: Colima **0.10.3**, QEMU **11.1.2**,
Docker **29.5.2 linux/aarch64**, Debian image/container **arm64/aarch64**. Native observations
reported **`virt,accel=tcg` / `max`** on both runners; HVF was unavailable. These are real local ARM
VMs, not hardware-accelerated Docker qualification. The required suites **failed**: Node 24
**five passed / four failed**, Node 26 **four passed / five failed**. Failures included unchanged
two-second image/start deadlines, unconfirmed removal and coordinator HTTP 500s. No timeout was
raised and no uncertain workspace was released. Subsequent CI serializes files (preserving every
case and intentional within-test concurrency) to distinguish artificial TCG contention, retains
controlled daemon failure diagnostics, and preserves unresolved integration workspaces/receipts.
Actual local Linux rerun: all **nine** Docker/protected cases passed with that serial invocation.
Mac protected qualification, approval handling and remaining background/restricted journeys are
still pending.

The same run's Node 24 browser lane failed its crash-recovery assertion: profile-argv absence
preceded positive original-group absence. Node 26's browser lane passed. The fixture now observes
both facts within its **existing eight-second bound**, without changing production admission,
removing markers or retrying a launch. Actual Linux browser/CLI regression: **26 passed / two
platform-only skips**. The failed Mac lane remains failed evidence; a new full run is required.

The serial follow-up (`958c3e1`, CI `40100201002`) passed both full browser/runtime lanes and all
six other source/build/installer/security/upgrade jobs, but **both Docker jobs still failed**:
Node 24 **eight passed / one failed**, Node 26 **six passed / three failed**, plus the expected
fixture-retention failure for an unresolved writer. Protected coordinator errors were confirmed
as `ProtectedExecutionUnavailableError`; Node 26 also hit the unchanged two-second container-start
limit. Serialization alone is not a qualification pass. The next provisioned VM uses one generic
ARMv8 Cortex-A72 vCPU instead of two max-feature vCPUs and records setup operation latency;
application deadlines and checks remain unchanged. This configuration's Mac outcome is pending.

The scoped real-Docker lane now also includes four actual HTTP/IPC shell-approval journeys
(allow with duplicate decision and exactly-one append, deny, auto-deny and pending cancellation),
four real cron/policy/tool-admission journeys and four captured verification executor journeys.
The approval fixture uses a harmless literal risk trigger, never a personal credential lookup.
Protected daemon and verification teardown retain the home, DB and receipts when writers remain
unconfirmed. Actual Linux execution of all six suites passed **21 real cases**, with only the
one mutually exclusive non-live guard skipped. These are real containers and schedulers with
synthetic model responses, not live-model or human acceptance. Expanded Mac results are pending.

`beb2d58` / CI `40101859770` passed all eight non-Docker jobs, including both browser/runtime
lanes. Both Cortex-A72 VM profiles failed before SSH admission; **no expanded Mac Docker cases
ran**. The next provisioning attempt restores the image's default `max` CPU model while keeping
one vCPU, with bounded owned-profile boot logs and independent setup timings. It is not a pass
or evidence of a product incompatibility.

The observed coordinator 500s also exposed a separate, reproduced API diagnostics defect. Two
regressions failed before the route fix: known protected-runtime refusal now returns **409** /
`protected_execution_unavailable` with only daemon-authored remediation, while guarded repository
context retains **422** and its actual issue code without the obsolete Linux-only claim. CLI/web
share this daemon response; pre-provider refusal and no fallback remain unchanged. Qualification
fixtures now plant synthetic selected-provider credentials and check names **and values** stay out
of scheduled/inbox containers. Root typecheck/lint and the **455-case** security gate passed;
selected actual Linux diagnostics/approval/inbox **10 cases** and the real scheduled-container
sentinel case passed. The earlier full **21-case** Linux run remains distinct from these reruns.
Mac protected and latest-stable integrated qualification remain open.

`6b22207` / CI `40103510815` again passed all eight non-Docker jobs. Both default-`max`,
one-vCPU ARM VMs booted and executed the expanded lane, which **failed**: Node 24 **21 passed /
two failed**, Node 26 **15 passed / eight failed**, with retained-writer hook failures on Node 26;
each skipped only the mutually exclusive non-live guard. Standalone setup container-start times
were **3.735 s / 2.360 s**, exceeding the unchanged **2 s** product admission limit. Coordinator
refusals, missed cron execution, one allow journey and a lifecycle preflight still prevent
qualification. The next explicit provisioning change gives the guest the runner's three CPUs and
records native `-smp` evidence; no deadline is raised and no failed Agent effect is replayed.

Local regression now passes **2,803 tests / 72 gated or platform skips** and all **455 required
security cases**. Four existing host-approval journeys also pass after replacing their real-home
SSH path with an explicit synthetic credential-shaped file under the fixture-owned Agent home;
local regressions must not touch personal credentials. The Mac Docker failures above remain failed
evidence, not a partial milestone completion.

`98c2c0f` / CI `40105838246` passed all eight non-Docker jobs, but the three-vCPU Docker run
**failed**: Node 24 **20 passed / three failed**, Node 26 **15 passed / eight failed** plus a
retained-writer hook failure. Native observations confirmed `3,sockets=1,cores=3,threads=1`;
standalone starts improved to **1.124 s / 1.738 s**. That does not explain every per-turn refusal
or justify declaring the runner incapable. Cron execution, admission and retry-count assertions
remain required and failed.

Follow-up fixes retain private readiness scratch after unconfirmed cleanup, distinguish closed
`engine/create/start/cleanup` failures without publishing raw errors, and reject even non-Error
create-acknowledgement failures before start. The standalone probe also records the actual create
acknowledgement: a missing unacknowledged create cannot authorize scratch removal when Docker
may still materialize it late. Independent cron scenarios now use separate daemon
homes so unfinished dispatches cannot consume another scenario's canned responses; each scenario's
own occurrences, assertions and deadlines are unchanged. Bounded fixture dispatch facts omit raw
error material. A source-worker strip-only parsing regression in the new diagnostic class was
caught and fixed with erasable TypeScript, not loader fallback. New Linux execution passed all
**23 required suite cases** (21 real-Docker cases plus two admission checks; one non-live guard
skipped), **51 focused cases**, and all **460 required security cases**. Fresh Mac evidence is
pending; neither the protected milestone nor latest-stable qualification is complete.

`340771c` / CI `40111914657` still failed both actual Docker jobs: Node 24 **16 passed / seven
failed**, Node 26 **22 passed / one failed** (each one non-live guard skipped). The closed
boundaries identified `start`/`cleanup` refusals; all four isolated cron scenarios passed on Node
26, whose remaining cancellation case was refused before command approval admission. This is
not a completed milestone. Both browser/runtime lanes, macOS source/build, installers, upgrades
and the 460-case security gate passed. Linux source tests failed one old exact diagnostic-string
assertion; the strict replacement requires the new `(engine)` tag while preserving retry/count
and zero-provider assertions. Local full rerun: **2,808 passed / 72 skips**; actual Linux browser/
CLI: **26 passed / two platform skips**. The failed CI run stays failed.

A follow-up distinguishes daemon-timer `timeout` from other closed preflight failures, without
changing bounds or exposing raw cause material, and includes the refusal body in the actual
approval fixture's failed-status assertion. Focused **57 cases** and all **460 security cases**
pass. The next complete Mac run remains required; no isolated rerun or partial result substitutes
for it.

### Hosted capacity failures

`57540de` / CI `40114411729` **failed** the required Docker suites: Node 24 **10 passed / 13
failed**, Node 26 **21 passed / two failed**, each with only the non-live guard skipped. Closed
`start: timeout` and `protected_docker_start_timeout` evidence confirms expiry of the unchanged
**two-second** guard; cleanup uncertainty also retains resources. This recurs across actual
one-, two- and three-vCPU TCG attempts, not a missing-Docker assumption. It is not proof that
macOS or every runner configuration is incompatible. The separate Linux live-browser probe also
failed its startup deadline; it is not relabelled by local browser passes.

At that point qualification needed an approved Apple Silicon Mac/runner with responsive local
Docker. The tested hosted Macs expose no HVF. [GitHub's larger-runner documentation](https://docs.github.com/en/actions/concepts/runners/larger-runners)
limits that paid alternative to organizations/enterprises; this repository is user-owned, and
[macOS nested virtualization remains unsupported](https://docs.github.com/en/actions/reference/runners/larger-runners#limitations-for-macos-larger-runners).
No repository transfer, billing change, personal credential search, unapproved remote access,
limit relaxation or retry-until-green was used to bypass this prerequisite. These failed hosted
runs remain failed evidence.

### Approved physical-Mac qualification

The operator subsequently authorized an isolated Apple M2 Pro Mac Mini setup. Observed host:
**macOS 27.0.1 (26A434), arm64**. On **2026-10-25**, Apple's
[security releases](https://support.apple.com/en-us/100100) explicitly identifies **27.0.1** as
the latest macOS version (Golden Gate, released 2026-09-28). This establishes the OS selection,
not completion of the integrated journeys. Portable Node
**24.22.0 / 26.4.0**, pnpm **12.14.0**, Colima **0.10.3**, Lima **2.2.1** and Docker CLI **29.9.2**
leave existing software/defaults untouched. The private VM uses actual **Virtualization.Framework**,
three CPUs, 3 GiB RAM and verified **8 GiB root + 12 GiB data** sparse capacities. Its only host
share is the qualification directory; personal SSH-key loading/agent forwarding are disabled.
Actual engine **29.5.2 linux/aarch64** and Debian **linux/arm64** execution are observed, not
simulated Docker responses. No personal browser profile, credential or keychain is used.

Initial `baca243` physical runs: Node 26 **23 passed / one mutually exclusive non-live guard
skipped**; Node 24's **23 bodies passed**, but the suite **failed teardown** with a retained active
workspace writer and no registered resources. That failed run remains failed. Investigation
reproduced a shutdown gap: scheduler stop neither drained lifecycle/readiness work nor aborted
inbox readiness before Agent registration. The fix tracks complete ticks, fences late admission,
aborts that readiness, and drains finalizers before resource/DB closure. It does not change Docker
or shutdown deadlines, release unknown receipts, or replay an attempt. Two deterministic
regressions failed before the fix; **19 focused tests**, **2,810 normal tests / 72 gated skips**,
**462 required security cases**, typechecks and lint now pass locally.

The complete fixed-candidate `0a60937` physical suites now pass on **both** baselines: Node
**24.22.0: 23 passed / one mutually exclusive non-live guard skipped** (452.77 s), Node
**26.4.0: 23 passed / the same guard skipped** (440.96 s), all seven files with clean teardown.
These include actual approval/duplicate-decision/deny/cancel, cron minutes and occurrence grants,
protected inbox/search, credential/network/mount isolation, captured verification and resource
settlement. Provider responses are synthetic; Docker, native workers and scheduling are real.
No deadline, tool admission or isolation assertion was weakened. The protected milestone is
complete for this observed environment, not a latest-stable integrated or full-release claim.

Latest-stable installed CLI/API/web and integrated qualification follow. Failed hosted runs, the
initial physical teardown failure and the unresolved Linux CI browser startup failure are not
relabelled by these observations. The fixed candidate's CI `40189624374` passes all eight
non-Docker jobs, including the new Linux live-browser run; both hosted TCG Docker jobs still fail.
That does not turn the earlier Linux startup failure or hosted Docker failures into passes.

The first physical latest-stable Node 26 full source run passes the actual four-case headless
browser-live probe, then **fails three tests** (2,454 bodies pass): no default keychain in isolated
HOME, an X11 fake-launcher unit depending on actual macOS GUI availability, and overlapping
HOME/checkout ancestry in an uninstall fixture. These are being corrected without changing
production refusals, skipping cases or provisioning a caller keychain. The ordinary SSH caller
is positively non-graphical; same-UID `launchctl asuser` refuses audit-session switching, so a real
GUI-session execution remains required, never a simulated mode result. `8ffbc29` corrects all
three fixture assumptions without skipping assertions or changing production refusals. The full
Node 26 rerun passes **2,457 source bodies / 71 gated skips**, plus the **four actual headless
browser-live cases**; root/web typechecks, build and pack pass on the physical latest-stable Mac.

The next actual Node 26 managed-browser run **fails one environment-evidence assertion**:
**26 passed / one failed / one separately required headed case not selected**. A birth-checked
owned Chrome read ends exactly after argv, while a controlled owned Node child reports its real
supplied environment. Apple's [public XNU implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c)
explicitly omits restricted-target environment bytes under SIP absent a private entitlement.
No SIP setting, privilege or entitlement is changed. The evidence adapter now distinguishes
**not reported** from an observed empty environment, scopes environment decoding to an exact
profile/birth, and clears unmatched buffers. An internal opt-in observer records immutable
creation inputs from the **same options object passed to the real direct spawn**, under its
existing cleanup guard. The case retains all allowlist/secret assertions for those actual inputs
and for native strings whenever reported; an unreported native view is explicitly Not checked,
not a secret-free result. Neither observation is signalling authority or a new wire surface.
The same inputs are independently checked against an actual controlled child's self-report.
Linux actual browser **26 passed / two platform skips**, focused **19 passed**, full regression
**2,812 passed / 72 gated skips**, **464 required security cases**, typechecks and lint pass.
The updated physical `dec4deb` native reruns now pass on **both** exact Node baselines:
**19 process/evidence cases**, and **27 managed-browser/CLI cases** with the separately required
headed case left for a real desktop caller. Full source runs each pass **2,459 / 71 gated skips**,
plus **four actual headless browser-live cases**, typechecks, builds and packed artifacts. Guarded
fresh installed trials each pass native fs-safe/Pi 1.4.0 admission, stdio descendant retirement,
empty/instructed Team chat through actual CLI/API/browser UI, 1280/390-pixel diagnostics and
settled uninstall. Local ARM Docker is truthfully reported ready across API/doctor/Config. Package
provisioning may fetch public dependencies; only admitted rebuilds run, not unrestricted npm
lifecycle hooks. Providers are synthetic; no live-model or human visual acceptance is inferred.

`8ffbc29` / [CI 40193120372](https://github.com/rullopat/bazilion/actions/runs/40193120372) passes
**all ten jobs**, including both complete hosted TCG Docker lanes. This does not retroactively
relabel earlier hosted failures or prove every TCG run meets the deadline. `dec4deb` / CI
`40196430852` passes all eight non-Docker gates, including Linux source/browser, upgrades,
installers and 464-case security, but **fails both hosted TCG Docker jobs**: Node 24 **15 passed /
eight failed**, Node 26 **19 passed / four failed**, each with the exclusive non-live guard
skipped. Closed `start: timeout` / `protected_docker_start_timeout` recurs; these failures remain
failed. On the approved physical latest-stable VZ target, the **same `dec4deb` complete seven-file
suite passes all 23 cases on both baselines**, with clean teardown: Node 26 **457.68 s**, Node 24
**439.43 s**. No required case, two-second deadline, security check or isolation boundary changed.
This establishes responsive local-Docker behavior, not a green hosted-CI claim.

The operator subsequently ran the desktop-only script on **2026-10-25**. Saved results show
**exit 0 on both baselines**, with the real headed-launch case and teardown passing: Node 24
**4.37 s**, Node 26 **3.72 s**. The script first requires positive native GUI availability on each
baseline; the case checks a real local window, no headless/pipe flags and final owned-process
absence. Its frozen source is `8ffbc29`, while the non-GUI collection uses `dec4deb`; the direct
headed launch/mode/retirement behavior is unchanged by the later optional spawn-evidence hook.
The desktop collection selects one case (25 deselected); it complements, rather than replaces,
the **27 passed** non-GUI/CLI collection. All **28 cases per baseline** are therefore observed on
actual latest-stable Apple Silicon, without privileged session manufacture, fake GUI labels or
personal-Mac service changes. The operator reported the script's successful result; no separate
human visual approval or live-model judgment is inferred.

Documentation head `cbdfdfb` / [CI 40200056722](https://github.com/rullopat/bazilion/actions/runs/40200056722)
passes nine jobs, including the Node 24 hosted Docker lane. The Node 26 hosted TCG lane still
**fails: 16 passed / seven failed / one exclusive non-live guard skipped**, with start-timeout
refusals. That failed job remains failed; physical VZ's complete 23-case passes are the scoped
latest-stable Docker evidence, not a relabelled hosted pass. No job was retried merely for green.

### Observed qualification and remaining required CI gate

The implementation and physical latest-stable trials have the bounded evidence above: MCP stdio,
owned processes/recovery, managed browsing and protected/background execution on both exact Node
baselines. Linux regressions, 464-case security, typecheck/lint/build/pack, guarded installers and
upgrade gates pass; Docker's complete cases pass on the approved responsive physical target.
However, the required hosted regression gate still fails as recorded. **Physical passes do not
waive that gate, and declaring the workstream goal complete was premature.** Completion requires
resolving the required runner/gate failure without weakening checks, or an explicit operator
change to that requirement. `66edd21` / CI `40228958987` completes with nine jobs passing,
including Node 24 Docker, but Node 26 Docker **fails: 14 passed / nine failed / one exclusive guard
skipped**. Start timeout and cleanup uncertainty recur; its standalone start took **1.771 s**
against the unchanged two-second admission guard. The next CI-only provisioning hypothesis uses
ARMv8.2 **`neoverse-n1`** instead of QEMU `max`, avoiding optional-extension advertisement while
keeping three CPUs, memory, every case and every product deadline/security assertion unchanged.
Native QEMU birth/argv evidence still reports the actual model; an unbootable profile fails rather
than skipping qualification. `0d520cf` / CI `40230590237` booted both profiles and passed nine
jobs, including the Node 26 Docker suite, but Node 24 **failed: 13 passed / ten failed / one
exclusive guard skipped**. Its standalone start was **1.755 s**. The CPU-feature hypothesis did
not resolve the gate and is not promoted as a fix. One final bounded capacity adjustment restores
the default CPU model with **two guest vCPUs**, leaving headroom on the three-core host for the
actual daemon/CLI workload. Memory, cases and product bounds remain unchanged. If it also fails,
a suitable approved CI runner or an explicit requirement decision is needed; not more variants or
unmodified reruns until green. `680755e` / CI `40232467634` passes the eight other jobs but
**fails both two-vCPU Docker lanes: 19 passed / four failed / one exclusive guard skipped each**.
Standalone starts are **2.657 s (Node 24)** and **1.435 s (Node 26)**; startup timeouts, bounded
scheduler retries and retained cleanup uncertainty remain. The headroom hypothesis is not a fix.
No further capacity variants are scheduled. The operator must choose a suitable approved CI
execution target, authorize a reasoned product-level admission-budget review (not a blind test
relaxation), or explicitly change the required-gate contract. Physical acceptance cannot waive it.
The workstream goal remains incomplete; those capacity trials changed no product deadline,
assertion or required case.

#### Approved product admission-budget review

The operator approved reviewing the startup contract rather than assuming either that two seconds
is immutable or that it should be raised merely for CI. Audit of the introducing `1d2052a` change
and BAZ-027 finds bounded, fail-closed preflight as the contract, with no documented two-second
security/SLO requirement. Metadata inspection is a short read; OCI start includes runtime/mount
setup and executes only the fixed isolated `true` shell/env probe. OCI create already allows five
seconds. Aligning **probe-start to that existing five-second admission budget on every platform**
is a production availability decision, not a CI override. Every identity/image/mount/environment
check still precedes admission; no model work, extra privilege, startup replay or host fallback is
introduced. Two-second metadata checks, 650-ms cleanup attempts/three attempts, command-declared
execution deadlines and the daemon shutdown cap are unchanged.

The review also reproduced a cancellation defect: `prepareAgentDockerInputs` accepted but dropped
the caller's AbortSignal before Docker preflight. It now forwards that same signal for configured
and protected work. Active create/start cancellation still waits for exact registered cleanup;
read-only engine inspection retains its short bound. A responsive 2.5-second probe and both
high-level cancellation tests failed before the change; already-aborted refusal passed. After the
fix, the focused **54 cases** pass. The hang test now explicitly requires refusal at **5,000 ms**
and before **6,000 ms**, with exact removal; its outer harness bound tracks that production
contract. Existing cleanup-uncertainty/unacknowledged-create and shorter command-timeout assertions
are retained, not relaxed. Startup beyond the metadata budget must succeed **once**, while hang,
abort and uncertain cleanup still refuse. New and preserved checks are hard-required in the
security manifest: **475 cases pass**, along with root/web typechecks and lint. Full Linux source
regression passes **2,817 / 72 gated skips**; the complete real Linux Docker/background suite
passes **23 / one exclusive non-live guard skipped**, seven files with clean teardown. These
results do not substitute for required CI and latest-stable Mac qualification.

The reviewed implementation `857d3b9` / CI `40237310069` passes eight jobs, including
Node 24 Docker (**23 passed**). Node 26 Docker improves to **22 passed / one failed** but
still refuses one preflight at **cleanup**; each Docker collection has its one exclusive non-live
guard skipped. Node 24 browser/runtime has **27 passed / one failed** at retirement, with its
uncertain profile retained. Neither failure is waived. Unlike probe-start, the existing cleanup
bound has an explicit regression contract: three 650-ms attempts plus retry delays must finish
below the worker's three-second kill grace. It remains unchanged; a startup-budget review does
not justify extending it to make hosted TCG pass.

On the latest-stable physical **macOS 27.0.1 (26A434), M2 Pro arm64**, the revised Docker
implementation passes the complete seven-file **23-case** suite on **24.22.0 (461.15 s)** and
**26.4.0 (439.02 s)**, with clean teardown and only the exclusive guard skipped. The native
configured/protected preparation unit collection passes **11 cases** on Node 24; the lower-level
fake-Docker unit file is Linux-only, not native evidence. The Node 24 normal collection has
**2,462 passed / one failed / 71 gated skips**, plus four passing actual headless cases: its backup
fixture writes through a second DB handle while asynchronous daemon review/queue finalizers can
still write. The fixture now stops its owned daemon before private SQL seeding and restarts before
live backup; no SQLite timeout/transaction or application contract is changed. Browser retirement
now reports only its closed failing step (process, profile lock or marker), without raw causes,
extra authority, longer bounds or clearing uncertain profiles. These are diagnostics, not a claim
to have repaired the CI retirement failure. Focused fixture/launcher tests pass **56**, Linux
normal regression **2,818 / 72 skips**, security **476**, root/web types and lint.

Implementation `9d1bc31` / [CI `40242186202`](https://github.com/rullopat/bazilion/actions/runs/40242186202)
subsequently passes **all ten required jobs**: both hosted Docker and browser/runtime baselines,
Linux/macOS source/build/package checks, guarded installers, security and upgrades. This clears
the required hosted gate for that implementation; prior failed runs are not relabelled or evidence
of a guaranteed retirement/cleanup latency.

On latest-stable **27.0.1 (26A434), arm64**, the corrected Node **24.22.0** collection passes
**2,464 / 71 gated skips**, plus four actual headless cases, **27 non-GUI browser/CLI cases**
(the separately qualified headed case is not replayed over SSH), types, build, pack and guarded
installed CLI/API/real UI/MCP trial. Native fs-safe/Pi versions, both viewports, actual Docker
readiness and settled uninstall pass. The **26.4.0** source collection has **2,463 passed / one
failed / 71 skips**: corrupt-result snapshot refusal waits past its unchanged 30-second bound.
Subsequent current-candidate Node 26 browser/build/installed steps stop rather than claiming a pass.

A bounded diagnostic identifies **native backup Promise completion**, not integrity validation or
Docker, as the wait: on Node 26.4.0 both an in-memory and a real file/WAL backup resume only when
an unrelated five-second diagnostic timer fires; the same corruption refusal on 24.22.0 takes
**8 ms**. Upstream [Node #65666](https://github.com/nodejs/node/pull/65666) fixes exactly this
missing callback scope and adds a final-active-request child regression. Official 24.22.0 source
contains it; 26.4.0 and 26.8.0 do not. Official **26.9.0** source and its release changelog contain
fix `18c3867d19`, establishing the first fixed 26.x release. This is runtime-version evidence,
not an OS-floor change. No heartbeat, timeout increase, test skip, baseline substitution or native
runtime patch was added. The agreed `^24.22.0 || ^26.4.0` range and exact baseline remain intact;
the operator must decide whether to amend them or authorize a compatibility design. The goal
remains incomplete despite the green hosted gate.

Ordinary configuration, credential, local image/runtime and policy prerequisites remain; no
detached-host-writer recovery or signalling authority from receipts is promised.

This is **not full 0.25 release readiness or closure of this story**. The Node 26.4.0 latest-stable
source failure is unresolved; unrelated live-provider/image and broader release acceptance above
remain open. The private VM was positively empty and gracefully stopped after follow-up
qualification; data and the uncertain failed fixture remain retained. No unknown writer or
receipt was cleared. No merge, release publication,
website deployment, version bump or personal credential use occurred.

The packed UI driver also disables the installed-browser updater scheduler and checks protected
readiness against actual shared Docker facts, rather than assuming every Mac lacks Docker.
No release publication or version bump occurred.
