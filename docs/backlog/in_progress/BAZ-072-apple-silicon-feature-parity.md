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
- Minimum macOS version: **not decided**. Derive a technical floor from the selected native APIs,
  Node and packaged dependencies, rather than equating the tested OS with the minimum. Older
  versions above that floor may work but receive no release-qualification claim. Prefer avoiding
  unnecessary recent-only APIs; never bypass a safety check to support an older version.
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

- Audit the technical minimum and arrange latest-stable actual arm64 runners/hardware, GUI browser
  sessions and a local Docker runtime. Testing older macOS versions is not required by the operator;
  this Linux development host cannot provide macOS evidence.
- Establish safe macOS Git access and process-ownership designs first; downstream features depend
  on them. Neither ordinary-chat success nor a `ps`/PID probe alone establishes these contracts.
- Then implement the dependent coding, stdio, browser and protected-runtime paths. Keep feature
  gates closed until their own safety requirements pass, even if another macOS capability works.
- Keep release acceptance here and in CI/release records, not separate progress/evidence dumps.
  The story is In Progress for the 0.25 release effort; technical-floor auditing and safe platform
  designs are the first implementation tasks, not settled prerequisites. Split bounded
  implementation stories if needed without dropping any parity requirement.

## As built

Initial Git implementation is in progress: the single hardened inspector retains Linux fd-relative
access and adds a bounded private-worktree backend for macOS. Ignore-aware guarded copying,
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
