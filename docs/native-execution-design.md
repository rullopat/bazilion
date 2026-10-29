# Native command isolation — approved design and feasibility gate

**Status: approved native backends, closed worker admission and source integration implemented; native CI and installed/latest-stable qualification in progress.**
The operator approved the base review on 2026-10-26 and both refinements in section 8 on 2026-10-27,
separately from goal confirmation. This is the
approved validation-first design for [BAZ-072](backlog/in_progress/BAZ-072-apple-silicon-feature-parity.md),
not a statement of current native product support. Approval covers the bounded Mac feasibility
milestone and conditional transition below, not weaker guarantees or additional permissions.

## Recommendation and approval boundary

Use one daemon-owned execution contract with different native OS backends:

| Platform | Candidate | Docker / Linux VM | Current assessment |
| --- | --- | --- | --- |
| Linux | Unprivileged Bubblewrap namespaces plus mandatory seccomp policy | Neither required | Established kernel mechanisms; integration and actual qualification still required |
| Apple Silicon macOS | `/usr/bin/sandbox-exec` / Seatbelt, with Bazilion-authored policy and owned launch supervision | Neither required | Deprecated-API risk remains; the accepted live-observer lifetime foundation is observed, but integrated qualification is pending |

Bubblewrap uses the host Linux kernel's namespace features, also used by containers. It is not
Docker, an OCI image service or a VM. Native Mac commands would use the Mac kernel and Mac tools,
not execute a Linux userspace under another name.

**Do not approve production enablement based on a thin `sandbox-exec` wrapper.** The first
approved implementation milestone must establish the Mac lifecycle boundary described below.
If it cannot be established under the agreed permissions, stop and request a decision; do not
replace it with process-group optimism, a VM or weaker host execution.

Approved Docker disposition: **retire the execution backend after the native replacement is
qualified on both platforms**, rather than permanently maintain two primary sandbox products.
The subsequent macOS-only removal below supersedes that platform's deferred retirement gate.
Linux Docker's approved disposition is unchanged; while it remains, preserve its behavior and
applicable regression coverage. Retirement must not erase or bypass unresolved resource history. If safe cutover cannot
be established, defer retirement and ask the operator. Keeping Docker as an independently selected
optional backend instead is a separate decision, with explicit retained-backend test obligations.

**macOS-specific disposition, 2026-10-29:** the operator explicitly requested removal of all Mac
Docker support/infrastructure. Mac Docker execution now refuses before CLI/socket access; protected
Mac work selects native, while ordinary explicit host mode remains unisolated. The old Mac VM CI
job is removed, its applicable Docker cases remain on Linux, and native tests cover the Mac matrix.
The dedicated stopped private VM/data disk were deleted through Colima after manager identity/state
checks; matching live helpers were absent before private tools/caches were removed. No VM restart,
personal Docker access, receipt-derived signalling or historical DB-row/marker deletion occurred.
Historical failed evidence remains failed. Linux Docker is unchanged by this macOS-only request.

**Node 26-only amendment, 2026-10-29:** current support is `^26.12.1`, exact qualification baseline
26.12.1 and pnpm 12.15.0. Node 24 compatibility/CI/qualification is retired. Older dual-baseline
observations below remain historical evidence, not current requirements or passes of the amended
contract. Existing security fixes and uncertain resources are not discarded with runtime support.
A fresh physical 27.0.1 arm64 source run on Node 26.12.1 passes 22 SDK/worker/preparation/lifetime
checks; after Node 26-only cleanup the expanded physical Mac source CI slice passes 42 cases in
14 files. Linux passes 3,156 cases/76 gated skips plus four headless probes, 477 security cases,
types/lint/build and genuine packed-library offline consumers. The preceding Node 24 run remains
21 passed/one readiness failure, drift then unknown scoped identity. The new detached-writer control requires positive canonical live-owned recovery after
natural expiry, never expiry as authority. These source results are not installed or hosted-CI
acceptance. Native CI now has a pinned non-setuid Bubblewrap Linux lane without host sysctl/policy
relaxation and explicit real Mac suites; those workflow edits have not yet run on hosted CI.

## 1. Threat model and common policy

Treat commands, repository scripts, dependencies and their descendants as untrusted. The trusted
boundary is the daemon, admitted provider/Pi worker code, native launch/supervision components and
kernel enforcement. This is not protection against a compromised host user, compromised daemon,
kernel vulnerability, or arbitrary code execution inside the trusted provider worker.

The approved protected policy is:

- Writable: exactly the admitted Team workspace, excluding protected subtrees, plus fresh private
  per-command HOME/temp storage. Workspace source/dependencies persist; command temp does not.
- Read-only: the Team-root `memory/` store, admitted uploads/skills and explicitly admitted native
  toolchain/runtime inputs. Never grant an entire personal HOME simply to find Node or a cache.
- Unavailable: daemon DB/auth/secrets, private Agent/session/browser storage through shell access,
  unrelated Teams, personal credentials, SSH agents, host service sockets and ambient caches.
- IPC-only command networking on both platforms: pipes and explicitly admitted per-job pathname
  Unix IPC, but no command TCP/UDP, including localhost. Deny DNS/broker escape and host service
  sockets. No provider credential, Docker socket, daemon bearer, reusable RPC channel or credential
  file is inherited by commands. Close unrelated descriptors before untrusted code starts.
- Spawn with an explicit scrubbed environment and resolved executable/toolchain roots; do not
  source personal shell startup files. Do not silently discover another executable from the
  repository, adopt an arbitrary operator environment, or fetch missing dependencies.
- Preserve dangerous-command approval and unattended auto-denial. These are tripwires in addition
  to kernel policy, never the sandbox implementation. Communication approvals remain separate.
- A writable workspace can still be damaged. Authorized workspace contents may contain sensitive
  data; this design is not a universal secret detector. Toolchain roots deliberately admitted for
  reading are part of the readable surface, not guaranteed secret-free stores.

Both backends share host resources. Timeouts and bounded output do not constitute aggregate
CPU/RAM/process quotas or protection against denial of service. Linux cgroup limits would require
usable, authorized delegation; Mac per-process limits do not automatically provide an equivalent
whole-job budget. Do not promise VM-equivalent resource isolation or silently introduce privileged
resource management. If such guarantees are required, obtain an explicit design decision.

Root overlap, symlink/rename races, hardlinks and read-only carveouts require explicit handling.
In particular, a writable hardlink can change an inode also named outside the workspace. A directory
allowlist alone is not a solution. The candidate admission policy must refuse unsafe shared-inode
writable layouts within documented bounds and prevent new link/carveout escapes; large or
uninspectable layouts must refuse rather than silently omit checks. Read-only dependency inputs
and package-manager copy behavior need qualification, not an assumption that every existing pnpm
store layout works. Keep Linux descriptor-pinned validation and the existing guarded Mac capture
checks; do not describe them as atomic snapshots.

## 2. Linux backend

Use an explicitly resolved, identity-validated unprivileged Bubblewrap release. Select the tested
version by required capabilities and reproducible artifact provenance, not an arbitrary `PATH`
binary. Do not install a privileged/setuid substitute when unprivileged namespaces are unavailable.

Construct an initially minimal filesystem view, not a read-only bind of the entire host with a
small denylist. Admit only required read-only system/toolchain inputs and the workspace. Isolate
user, mount, PID, IPC and network namespaces; use a fresh `/proc`, minimal devices, a new session,
no-new-privileges and no payload capabilities. Keep Team memory and other inputs read-only.

Seccomp is mandatory defense in depth: prevent changing/re-entering namespaces or remounting the
policy, privilege/debugging escape paths, host socket families, `io_uring` bypasses and terminal
injection. Compile for the admitted architecture; missing/unsupported enforcement refuses. Private
related-process IPC needed by tools is not permission to reach host AF_UNIX sockets or inherit
connected descriptors. Enforce the accepted IPC-only policy even though a Linux network namespace
could otherwise permit job-local IP loopback; do not silently provide a broader native network mode.

A dedicated PID namespace supplies a stronger lifetime mechanism than a process group: Linux kills
its remaining processes when namespace init exits. Use Bubblewrap's trusted status/ownership
channel plus live process/birth authority and a supervisor that remains until settlement. A JSON
PID by itself is not signalling authority, and `--die-with-parent` is not a replacement for checking
exit, acknowledgement and cleanup.

Landlock is useful potential defense in depth, but not the selected sole boundary. Rights vary by
ABI; it does not by itself supply the required filesystem view and process lifetime domain. Its
upstream best-effort compatibility examples must not be copied into Bazilion's fail-closed policy.
Likewise, seccomp alone is not a complete sandbox.

Prerequisites include usable unprivileged namespaces and the pinned native components. Some Linux
policies, notably Ubuntu's AppArmor user-namespace restrictions, can prevent setup. Report that
condition. Do not change global sysctls, install privileged helpers or weaken the profile as an
automatic remediation. Any disposable-CI prerequisite configuration must be separately approved.

## 3. macOS backend: restrictions and conditional lifetime proof

Seatbelt can apply deny-by-default filesystem, process/IPC and network policy to a command and its
inheriting children. Both Codex and Anthropic's runtime use this native route. That is useful
implementation precedent, **not evidence that Bazilion's stricter contract already works**.

Resolve `/usr/bin/sandbox-exec` explicitly. Apply the policy before releasing untrusted command
input, with a trusted fixed entry/supervision helper and a closed acknowledgement channel. Do not
call an irreversible sandbox API inside the multithreaded daemon. Do not expose profile text,
relaxation switches, arbitrary helper paths or daemon control descriptors as model capabilities.

### API/support risk

Apple's copied SDK `sandbox.h` explicitly deprecates `sandbox_init` as unsupported and recommends
App Sandbox. The custom Seatbelt-profile route must be treated as a maintenance dependency with
no promise of future OS compatibility; successful use by another CLI does not remove this risk.
Availability and effective restrictions must be checked on the actual supported OS before admission.
Do not equate the deprecated C API and a stable supported profile API.

Apple's supported App Sandbox model is an alternative architecture, not an established drop-in
replacement here. It involves signed app/helper entitlements and scoped file access; Apple's file
documentation also restricts executing programs in user-selected locations. Mapping arbitrary
Team roots, generated executables and unattended daemon operation into that model needs a separate
packaging/permission design. It is not approved by choosing native execution generally.

Endpoint Security can provide kernel process events, but Apple requires a requested entitlement.
It would introduce a different installation/permission model. No entitlement, privileged service,
Full Disk Access, SIP change or personal keychain change is assumed or authorized for this design.

### Blocking lifecycle question

A Seatbelt filesystem/network label is not a complete process-lifetime container:

- An untrusted program can fork, create another session/group, close its inherited pipes and leave
  a writer behind while the original command exits normally.
- Original-group absence, normal leader exit and pipe EOF therefore do not prove that all such
  writers are gone. Existing provider-worker ownership code must not be relabelled as that proof.
- XNU's `setsid_internal` changes the group/session. Its public kqueue header says fork events do
  not deliver the child's PID and `NOTE_TRACK`/`NOTE_CHILD` have not been supported since 10.5.
  Parent unique identity is also changed during reparenting in the inspected XNU source.
- Periodically enumerating libproc parents/births is valuable for known-process authority but does
  not prove an exhaustive lineage across unobserved short-lived parents and reparenting.

This was the base review's blocking feasibility gate. The accepted census refinement and
[source foundation](#implementation-foundation-not-an-enabled-backend) now demonstrate a live
fenced observer/controller that keeps detached writers blocked. That scoped observation is not
production enablement or integrated qualification. A candidate must demonstrate how
detached/double-forked writers are contained or reliably keep the correct workspace blocked. It may not signal guessed PIDs, infer a clean job from one group, or release a
lease because the command returned zero. Before any production enablement, prove that the chosen
supervision design detects the relevant uncertainty—not merely that it would retain a lease if
some other component happened to report it. If an acceptable unprivileged mechanism cannot be
established, stop for an operator decision instead of silently relaxing the contract.

### Networking and capability differences

macOS does not acquire a private Linux-style network namespace through Seatbelt. Denying external
connections while allowing arbitrary host loopback would expose unrelated local services.
Docker's `none` network and a private Linux namespace can still support job-local loopback; a Mac
policy cannot simply translate that to `localhost:*`. The operator explicitly accepted the narrower
common IPC-only native contract on 2026-10-27: no protected-command TCP/UDP on either platform,
including local test servers. This is a disclosed capability change, not private-TCP parity with
Docker. No broad loopback exception or automatic host/Docker fallback is allowed.

Deny DNS/service-broker routes as well as direct sockets: allowing a resolver Mach service can
send requests on a command's behalf. Likewise, broad Mach/XPC, Apple Events, system service or
keychain permissions are not safe compatibility shortcuts. Normal provider HTTP, approved
`web_fetch`/search, messaging and result delivery remain separate Bazilion-owned capabilities;
command network policy must not be widened to make them work.

Native Mac tools produce Mac artifacts and use Mac utility semantics. This does not reproduce a
Debian image or promise Linux tool availability. Admit explicit host-native prerequisites and
report missing tools; never start a Linux VM to satisfy them automatically.

## 4. Integration: one admission/execution boundary, not a shell-only patch

Current relevant boundaries are:

- `lib/protected-execution.ts`: branded, one-use daemon admission selects native on macOS and
  explicitly selected native on Linux; Linux Docker remains transitional under its unchanged disposition.
- `runtime/shell/tooling.ts`: native/Docker selection removes all seven host-backed Pi coding tools.
- `runtime/pi/coding.ts`: `coding_command` has its own executor selection in addition to `bash`.
- `lib/verification/executor.ts`: captured specialist checks execute daemon-side, not through the
  specialist's two-tool worker.
- `runtime/worker/runtime.ts` and worker IPC: exact input keys, minimal selected-provider runtime
  and explicit capability admission.
- `lib/coding-environment/{workspace,lifecycle,resources}.ts`: canonical ownership and settlement.

Approved integration (implemented in source; installed qualification remains pending):

1. The daemon resolves a closed native policy, canonical roots, toolchain identity and turn/lease
   binding. Readiness/deny probes use private synthetic sentinels, not personal files. No model
   invocation starts before required admission succeeds.
2. Register the actual owned launch resource before releasing executable input. Require a trusted
   acknowledgement that policy and input scope are installed. Cancellation during preparation
   still waits for bounded settlement; uncertainty retains resources and scratch.
3. Route `bash`, `coding_command`, skill helpers and captured verification through one native
   execution adapter and lifecycle. An opaque daemon/turn binding must not become a caller-chosen
   Team, backend, credential, arbitrary profile or host override.
4. Keep all direct host-backed Pi `read/edit/write/grep/find/ls/bash` disabled in native protected
   mode. Initially preserve the existing protected coding surface rather than expand it. Any
   later first-class file tool needs an equally enforced broker/native path, not just a JS path
   prefix check outside the sandbox.
5. Keep scoped `home_*`, memory, context/Git inspection, result delivery and communication as
   their existing explicitly authorized capabilities. Audit their boundaries too; a native shell
   does not secure unrelated file readers. Preserve the single hardened Git implementation and
   private Agent/session/result ownership. Protected/restricted turns do not gain browser or MCP.
   Ordinary explicitly admitted browser/MCP capabilities remain separate; this is not a claim
   that the coding sandbox confines every operator-configured external server or browser.
6. Keep provider credentials in the selected provider worker/daemon control plane, never command
   env/argv/HOME/descriptors. Refresh remains daemon-owned; live diagnostic redaction and
   source-owned output release remain in force.
7. Reuse canonical workspace/resource/receipt ownership rather than create another runs/workflow
   layer. Distinguish backend, policy/toolchain identity and environment in wire reports and
   frozen verification contracts; do not rename an image into a native identity. Reject backend
   drift and unsupported old captures rather than substitute a new environment.

Ordinary explicit unprotected host mode must remain visibly unisolated, not a fallback from a
failed native request. The recommended primary backend for protected/sandbox-requested work is
native. Do not silently rewrite existing operator selections or Agent/Profile settings.

Prefer avoiding SQL shape changes. If canonical schema edits are necessary, the existing alpha
clean-install/refusal contract applies: no ALTER/import compatibility adapter or silent data reset.
Any resulting upgrade-matrix expectation change must be justified and approved, not used to turn
a failure green. Backend retirement likewise requires existing resources to be safely settled,
not discarded during cutover.

## 5. Required qualification and CI transition

The initial design review used source inspection only. The subsequent private Mac probes in
section 7 are bounded feasibility observations, not completion of this qualification matrix or
native product support.

| Area | Required real behavior |
| --- | --- |
| Admission | Missing/deprecated/unsupported mechanism, identity substitution and failed policy acknowledgement refuse before model work; no command replay or host/Docker fallback |
| Filesystem | Ordinary workspace edits/builds succeed; outside reads/writes, Agent/session/state access, memory/input mutation, link/rename/truncate and descriptor escape attempts are denied or explicitly refused at admission |
| Networking | Instrumented direct IPv4/IPv6/TCP/UDP, host loopback, DNS/service-broker, pathname/abstract socket and inherited-FD escape attempts do not reach forbidden endpoints; job-local networking differences are reported |
| Lifetime | Fork/setsid/double-fork, closed pipes, normal leader exit, timeout, supervisor/worker/daemon crash and shutdown cannot falsely free a workspace; unknown authority never signals a foreign/reused process |
| All entry paths | `bash`, `coding_command`, helpers and captured checks use the same policy; no file-tool or IPC override bypass |
| Restrictions | Scheduled/inbox approvals, restricted two-tool workers, selected credentials, frozen verification, private output release and live redaction remain enforced |
| Recovery | Restart/restore never converts receipts into PID authority; interrupted resources and unavailable evidence remain blocked/unknown, not replayed or marked passed |
| Product | CLI/API/web diagnostics agree; actual latest-stable Apple Silicon and Linux native runs, installed artifacts and browser journeys pass on the required baselines |

Before broader migration, the first bounded Mac implementation/validation milestone must exercise:
(1) denied filesystem/network and descriptor/broker escapes; (2) a writer that double-forks,
changes session and closes pipes before leader exit; and (3) timeout/supervisor-loss settlement.
No successful empty-shell probe can substitute for these. If the lifetime or network contract
cannot be met, pause rather than enable a partial backend under a full-protection label.

After approval and native proof, replace Mac Docker VM jobs with native integration in the
existing Mac runtime matrix on Node 26.12.1 only. Add/retain corresponding real Linux
native checks. Preserve general OS tests/builds, guarded packed installers, security and upgrade
gates. Share setup/scripts where useful, but do not mistake shorter YAML for faster execution.
Removing VM boot/emulation removes that cost, not the real browser/cron/security test workload;
measure the new runtime rather than promise a duration. Keep Docker-specific coverage until its
approved retirement or retain it explicitly if the operator chooses optional-backend support.

Current toolchain is Node **26.12.1** only, range **`^26.12.1`**, pnpm **12.15.0**.
Node 24 compatibility and qualification are retired. Prior Node 24, Node 26.4.0 and Docker
observations stay historical. No Node substitution, skipped native
case or older hosted OS can replace actual latest-stable Mac qualification.

## 6. Approved decisions and remaining gates

1. **Native candidates approved:** Linux Bubblewrap + mandatory seccomp; Mac Seatbelt subject to
   its documented support risk and the blocking lifecycle/network proof.
2. **Validation-first scope approved, not weaker safety:** begin with the bounded Mac feasibility
   milestone; no production enablement, Docker removal or qualification-gate replacement until
   the required boundary is established. Resolve ordinary diagnostic failures within scope; ask
   when protection cannot be established or a real permission/contract decision is needed.
3. **Conditional Docker retirement approved.** Retention as an optional independently tested
   backend would require another explicit decision. Unknown resources cannot be erased.

The dedicated physical-Mac SSH grant was subsequently renewed and verified at
**2026-10-26 21:53:07 UTC**, valid until **2026-10-27 21:40:35 UTC**. Native trials began only after
verification of the pinned host and private qualification root. The subsequent credential-policy
investigation below needed no new privileges or system changes. After that grant expired, the
operator authorized a 15-day renewal of the same restricted key. Pinned SSH and the original
owner/inode/mode of the private root were verified at **2026-10-27 22:12:08 UTC**; the renewed
`restrict` grant expires **2026-11-11 22:11:33 UTC**. No expired-grant connection, alternative
credential or privilege fallback is authorized.

This review does not request permission for privileged services, Apple entitlements, personal
configuration changes, paid infrastructure or renewed remote access. Those would need separate
specific authorization if the selected design later requires them.

## 7. Bounded Mac feasibility — credential-policy defect corrected

Private, unprivileged probes ran on physical **macOS 27.0.1 (26A434), arm64, Node 24.22.0**,
using `/usr/bin/sandbox-exec` and a controlled C subject compiled with Apple clang 21. No product
backend, dependency installation, Docker/VM provisioning or CI transition was performed. This is
not Node 26.12.1 qualification or an older-OS execution claim.

Observed, narrowly scoped behavior:

- A refined startup profile permitted a synthetic workspace write while denying canonical outside
  marker access, Team-memory-style writes and TCP/UDP access to owned host-loopback listeners.
  An initial pre-handshake startup abort remained a failed experiment, not a denial-test pass.
- A trusted entry closed an inherited synthetic-marker descriptor and connected private host-broker
  descriptor, then confirmed descriptor closure before readiness. Subsequent accesses returned
  `EBADF`; a direct connection to the private host AF_UNIX broker was denied, with only control
  bytes reaching it. This proves the tested closure path, not automatic revocation of open rights.
- The registered DNS Mach service `com.apple.dnssd.service` was visible to the outside control but
  denied to the sandboxed subject. This was lookup only, not DNS-query/complete resolver-egress
  qualification. The earlier assumption that `com.apple.mDNSResponder` was a registered Mach name
  failed its positive control and is not counted as a broker-denial pass.
- Initial profiles did not restrict outside libproc identity/task/path queries. With the explicit
  family denial and scoped allow below, outside BSD/birth/task/path queries were denied while
  self/known same-sandbox checks worked. Signal-zero checks (no signal delivery) also separated
  controlled live instances, including identical profile text, and recognized a known writer after
  double-fork/session/group escape. These are candidate live-domain primitives, not an exhaustive
  process census or persisted authority.
- A controlled writer closed its inherited pipes and survived normal leader exit, supervisor death
  and original-group absence. Known-birth cleanup and final writer absence were observed. The
  fixture had a twelve-second safety expiry; it is not a general cleanup mechanism. Production
  workspace settlement, unobserved descendants and restart authority remain unqualified.

**Initial defect, subsequently corrected:** `sysctl(KERN_PROCARGS2)` returned controlled outside
argv/environment canary entries despite global default denial and explicit sysctl-read denial.
Removing a broad process-info allow was insufficient. Those assertions failed; the result was a
policy defect to investigate, not evidence that every native Mac design was infeasible.

The operator requested continued investigation on **2026-10-27**. A controlled matrix reproduced
value fingerprints through both `KERN_PROCARGS` and `KERN_PROCARGS2`, while unrelated numeric and
named sysctl reads were denied and host MAC enforcement was enabled. Explicitly denying the
`process-info*` family blocked both argument APIs. Denial alone also blocked required helper
metadata; the effective candidate preserves only same-sandbox access:

```scheme
(deny process-info*)
(allow process-info* (target same-sandbox))
```

On the tested OS, do not assume `(deny default)`, sysctl denial or an unpaired scoped allow supplies
this family denial. The corrected profile denied both outside argv/environment APIs with `EPERM`,
while preserving self descriptor/BSD/birth queries. The combined private probe also passed the
workspace/memory/outside-marker/data-volume-alias, inherited-FD, AF_UNIX/DNS-Mach-broker,
TCP/UDP-denial and known-birth detached-writer cases. All launched subjects were confirmed closed;
private fixtures and earlier failed results were retained. No personal process environments or
credentials were queried, and no additional privilege or system configuration change was needed.

The specific credential failure no longer requires an operator decision. Carry these positive and
negative controls into mandatory backend regressions; do not treat the private prototype as product
support. Further research and the actual remaining contract decisions are below. Docker behavior
and qualification gates remain unchanged; no native implementation/qualification task is complete.

### Live-domain observer research

A public `EVFILT_PROC` exit/exec-watch approach refused a census when a foreign UID-0 zombie could
not be watched. It stayed **unknown**, never silently excluding the unwatchable PID or treating it
as an empty job. No foreign process was signalled or altered to make this experiment pass.

A subsequent **research-only** candidate uses Apple's published `proc_uniqidentifierinfo` ABI
(`proc_pidinfo` flavor 17, 56-byte layout), which is **absent from the installed public SDK**.
Its opaque lifetime and exec-version identifiers were readable across UIDs and for zombies without
privilege. This is a new compatibility dependency, not a public-SDK guarantee or permission grant.
The existing public BSD/Mach birth and actual ChildProcess authority used for signalling remain
unchanged; an opaque identifier or persisted receipt alone never authorizes a signal.

The candidate fences further trusted spawning, takes a bounded complete global identity inventory
in the trusted outside controller, obtains a same-sandbox filtered view through the original live
helper, and requires a second complete matching identity/version inventory. Partial reads, drift,
budget exhaustion, a missing helper or a changed helper identity remain unknown. The experimental
bound was 16,384 PIDs / 500 ms. This is not a claim that a single process-list syscall is atomic.

Actual private probes observed:

- Stable empty-at-capture views, plus busy views of a detached writer after normal leader exit.
- An additional descendant, not registered in the known-child cleanup set, kept writing after
  known-child cleanup; the observer still reported **busy**, then empty only after its natural
  fixture exit. Its oracle PID was not used as signalling authority.
- An exec between the inventories changed the version vector and produced **unknown**.
- A permissive sandbox reinitialization succeeded in the outside positive control but was denied
  inside the candidate policy; outside-file and argv/environment restrictions remained effective.

The descendant's three-second and original writer's twelve-second expiries are fixture safety
bounds, not production termination mechanisms. Production settlement, restore behavior, all-entry
integration, fork-churn coverage and both-platform/toolchain qualification remain required.

### Networking observations

A compiled `(target same-sandbox)` condition on loopback `network-outbound` denied the owned host
listener **and the subject's own listener**. It did not establish job-private TCP. Broad localhost
permission was not substituted. These observations do not prove impossibility of every alternative
architecture; no acceptable transparent private-TCP mechanism has been established here.

A pathname-scoped AF_UNIX candidate did exchange a byte with its private endpoint while denying
the owned host broker, a symlink redirection of the admitted path to that broker, and TCP. The host
broker saw only its positive-control bytes. This is a viable IPC-only candidate, **not a transparent
replacement for arbitrary TCP/UDP test servers** or completed network-egress qualification.

### Implementation foundation, not an enabled backend

`lib/process/darwin-census.ts` supplies the closed libproc reader, bounded complete inventories,
scoped views and observation composition. `runtime/shell/native/{seatbelt,seccomp}.ts` compile the
closed policies. `lib/native-execution/{layout,mounts,files,elf}.ts` add bounded metadata admission,
retained file/directory inputs and an ELF dependency reader that never runs `ldd`, executes repository
helpers or discovers additional input roots from RPATH/environment variables. These remain daemon
foundations, not an enabled execution backend or admission across all coding-tool paths.

Physical **macOS 27.0.1 arm64 / Node 24.22.0** probes now run the source scoped reader inside the
confined Node observer. Raw TypeScript failed under `--jitless` because its parser needs WASM;
staging JavaScript outside confinement resolved that without kernel-policy relaxation. Explicit
readonly Koffi package/binding inputs and package-link metadata suffice. The source policy compiler
also passes workspace/readonly-memory/input, hardlink/rename, private Unix IPC, outside-marker,
quoted-path and Node-observer cases. An unsafe counterfactual proved that relocating a writable root
into writable scratch relabels its memory carveout; final unlink-deny anchors now protect writable
roots and readonly-carveout ancestors. Source layout/file admission ran on the Mac, refusing drift
and service sockets. Public arm64 `fstatfs` metadata matched the SDK's 2168-byte structure; it is
not the x86-64 INODE64 symbol. None of this is Mac Node 26.12.1 or full-app qualification.

The bundled `native/darwin-{entry,job,protocol}.ts` helper and live
`lib/process/darwin-domain.ts` controller now execute one admitted stdin command, permanently fence
further spawning, bracket scoped census replies with complete outside inventories, and require
normal helper exit, natural pipe EOF and original-group absence. Actual **27.0.1 (26A434), kernel
27.0.0, arm64 / Node 24.22.0** trials cover normal completion, SIGTERM/SIGKILL cancellation,
closed-pipe double-fork/setsid writers, retained busy state, fresh observations after natural exit,
2 MiB output truncation, post-fence execute refusal and helper loss. Helper death leaves settlement
unknown even when its original group is absent; fixture expiry never grants release. Successful
`PT_DENY_ATTACH` self-protection did not hide the writer. Untrusted same-job `task_for_pid` and
`PT_ATTACHEXC` against the observer were denied. The latter uses the SDK's recommended API, not
suppressed deprecation warnings. A fixed-sleep expiry assertion failed while its writer was still
correctly busy; observed termination plus a fresh complete census replaced that assumption within
the existing fixture bound. There is no unknown-PID signalling or backend enablement here.

One earlier private run returned **busy after known-child cleanup** and failed its one-shot assertion.
Keep that failure unresolved: later instrumented passes do not establish its cause or authorize an
earlier release. Production settlement still needs a positively complete empty-domain observation,
live helper authority and terminal pipe/process evidence, never the cleanup acknowledgement alone.

Real Linux tests use root-owned non-setuid **Bubblewrap 0.13.1** on **Linux 7.2.8-9-omarchy**.
Both exact Node baselines ran the installed seccomp policy: IP socket creation (including localhost),
namespace/debug operations, namespace ioctls, terminal injection and unknown calls deny; private Unix
IPC, workspace writes, Node threads and fork/setsid work. Readonly memory stays readonly, all payload
capability sets are zero, and control/filter descriptors close before payload execution. A real
same-device nested mount is refused. The sparse-view probe runs Bash/Node/true using pinned directory
FDs and a closed ELF file set, not a whole `/usr/lib` grant. Bubblewrap's `--bind-fd`/`--ro-bind-fd`
interfaces are required; parent `/proc/<pid>/fd` paths proved inaccessible after user-namespace entry.

`lib/process/{linux,linux-domain}.ts` now bind the original live manager's birth/group to a pidfd,
and its private status channel to a separate namespace-init death handle. The init PID is never a
signal target. Real source tests cover a double-forked/setsid writer that closes pipes and ignores
SIGTERM: normal leader exit, live cancellation and manager SIGKILL all require positive kernel-domain
death, manager closure and natural output/control EOF. A locally destroyed status stream remains
unknown and retains its fixture/handles. Receipts contain no recoverable PID authority. An initial
cancellation refusal correctly caught init's `setsid()` transition after Bubblewrap's startup gate;
cancellation now targets only the original manager, without relaxing any birth/group check.

Early Bubblewrap creation JSON is not installed-policy readiness. A Node 24 lifecycle case and a
Node 26 full-source case failed their initial namespace binding under load, before command input;
both failures remain retained. Bubblewrap emits that JSON before child setup finishes, proceeds
past `--block-fd` on EOF and applies seccomp later, before exec. The fixed `native/linux-entry.ts`
now runs as staged JavaScript after sandboxed exec, emits a one-use private acknowledgement and
uses Node's `execve` to enter fixed no-startup-file Bash awaiting stdin. The owner requires that
acknowledgement before the complete native namespace/birth checks. A real paused-startup test
proves early JSON cannot authorize readiness. No identity check, deadline or unknown was relaxed.
CLI packaging emits the entry as `native-linux-entry.js`; model commands never belong in its argv.
Node's public `process.execve` is experimental: availability is checked, both pinned Node baselines
execute it in the real Linux tests, and absence refuses without a spawn/host fallback. The pidfd
binding likewise requires the loaded libc's public pidfd exports; unavailable symbols refuse.
These dependencies are prerequisites/maintenance risks, not universal older-Linux qualification.

Canonical `WorkspaceResources` now persists a tagged no-PID native intent in the existing worker
resource table before the spawn fence, binds only the actual nominal live owner, and records
creation only after the private acknowledgement. Exact writer/attachment/definition checks apply
at spawn, the fresh one-use command-input fence, every signal and cleanup confirmation. Attempted but unknown creation remains blocked;
only cancellation before the one-use spawn fence can attest no creation. Real tests cover normal
cleanup, cancellation, receipt-only registry replacement and restored-state signal revocation.
Native record substitution cannot fall through to legacy worker/container signalling. No schema
migration, recovery adapter or new run/event layer was added. Actual prepared views now bind to
the canonical writer's exact workspace/root identity and definition; their live FDs stay in the
same resource slot until positive confirmation. Copies and view reuse cannot acquire a new slot.
Both live owner types now bind to that canonical lifecycle. Physical Mac source trials verify persistence before spawn, creation
acknowledgement before input, one-command admission, inactive/restored writer refusal and normal
writer release. This private lifecycle integration is still not an enabled execution adapter or
enforcement across every coding tool.

`native-execution/{artifacts,inputs,linux-view,darwin-view,command}.ts` now compose private launch
views and one shared one-shot executor. A fixed installed/source manifest stages trusted JavaScript
outside confinement; it never selects a repository helper or feeds TS to a `--jitless` child.
Input admission retains registered readonly aliases and has a shared bounded window, disarmed
between validations rather than permanently expiring a valid capture. Writable overlap with the
running trusted code refuses; use a separate worktree, not the daemon's live source/install tree.
HFS readonly inputs are distinct from writable scopes: directory-hardlink-capable HFS writers
refuse, and no HFS execution qualification is claimed. Linux entry acknowledgement additionally
checks installed seccomp, no-new-privileges and zero capability sets.

The assembled Linux view mounts exact selected programs/ELF files, workspace, readonly memory and
private scratch through FD binds. A real test denies memory mutation, an outside marker, TCP and an
unadmitted program. The same common admission plus Seatbelt runs the packed-layout Mac helper;
actual Node 24.22.0 trials deny memory/outside/TCP access, allow private pathname IPC, omit a planted
control-only environment value and settle the canonical writer. The shared executor reports actual
nonzero exits and cancellation on both platforms. Linux cases also cover unattended deny, approved
execution, timeout, output-sink failure, explicit truncation and restored-row retention. An initial
approval fixture wrongly expected relative project deletion to be dangerous; the existing classifier
was unchanged and the corrected fixture uses its own absolute canary path. Neither fixture failure
is a platform escape or a reason to relax approval assertions.

`runtime.ts` now freezes the selected code/toolchain and policy facts before a turn. Revalidation
refuses drift rather than adopting replacement files; per-command workspace safety captures may
change after a positively settled command. Runtime loans keep the template/toolchain FDs alive
until every retained view closes, including after turn shutdown. Linux gives each command a fresh
filter descriptor, never a reused file offset. Caller role/config objects are snapshotted before
awaiting preparation.

`turn.ts` adds private turn admission: real synthetic readonly/outside/TCP/UDP denials, private Unix
IPC and scratch writes complete before admission. The TCP target is a daemon-owned loopback
listener, not an unrelated service. Commands then share a serial, one-use call-id capability and
correlated cancellation. Actual packed-layout source trials pass this admission, concurrent-path
serialization, nonzero exits, cancellation and canonical settlement on **macOS 27.0.1 arm64 with
both Node 24.22.0 and 26.12.1**. These remain backend/turn-component observations, not installed
CLI/API/web or live-model acceptance.

Hermetic native wire shapes, correlated bounded IPC, pre-base64 live credential redaction and
structured cleanup failures are implemented. Native bash exposes no host-backed file tools;
`coding_command` can use the same capability. Pi's structured capture-truncation flag is explicitly
combined with the executor flag: an initial test incorrectly expected a nonzero SDK result to
throw, and inspection also found a false structured `truncated` value. The correction preserves
`isError`, the actual exit code and explicit truncation rather than weakening the assertion.
Both ordinary and protected Pi session factories now accept a closed native proxy description,
reject mixed backends, disable every host-backed file/coding tool and route `bash` and
`coding_command` through the same host. Default native cwd is canonical and distinct from a
command's declared Team-relative cwd; session/loader/tool context agrees with it. Native prompt
labels disclose the IPC-only boundary, and native skills name their admitted host-native paths.
Actual Linux and physical **27.0.1 arm64 Mac** SDK command scopes pass on **both exact Node
baselines**, including readonly memory denial and canonical resource settlement. Those SDK trials
use synthetic provider transport and an unpersisted synthetic receipt fixture: they do not qualify
live providers, durable coding-receipt reporting or installed application surfaces. Initial
fixtures omitted the required pre-created conversation transcript, and inspection exposed a
missing ordinary-session native policy label; both were corrected without weakening assertions.
Worker input/entry now accepts closed native facts/default-cwd metadata only with a real, one-use
daemon turn capability. The parent binds Agent, turn, Team, canonical workspace and exact runtime
facts, then rechecks active owned writer/creation identity before releasing worker input. Copies,
restored/inactive/substituted rows, mixed execution, missing live redaction/ownership and restricted
worker kinds refuse. Native workers register as having no host commands. Shutdown drains native
commands before scratch removal; uncertain cleanup retains the resource, writer and scratch.
Legacy captured-verification hosts remain unadmitted for native requesters. The bound native
requester below uses its own frozen-environment contract, never a host/container fallback.

The same actual production-worker fixture now passes on Linux and physical **27.0.1 arm64 Mac**
under both exact Node baselines. It checks native bash/default cwd, Team-relative `coding_command`,
readonly memory denial, control-env omission, pre-worker-transcript output redaction, unattended
credential-access denial and positive worker/native resource retirement. Provider responses remain
synthetic. Native environment reports and command receipts now commit
through the canonical coding host with `posture: native`, an explicit runtime fingerprint and no
image identity. Reports derive their values from the live bound turn, not caller labels; current
secret suppliers reject credential-bearing commands and redact retention at its boundary. Retained
logs remain private until existing source-owned release. Pre-IPC capture metadata preserves the
producer's observed-byte lower bound and redaction fact even when sanitization changes byte length;
truncation stays an explicit flag, never inferred from counts. The shared real worker fixture checks
these durable facts on both platforms/baselines. Native UI labels never turn missing details into a
host fallback or a verification badge. These worker-report trials initially used internal
selection; explicit installation and operator capture selection are now wired below. Installed
application journeys remain unfinished.

Native dangerous-command approval now originates only at the daemon's shared executor. The real
worker binds one immutable Actor/Team/turn/mode event channel before input; a raw worker approval
RPC is refused, not treated as permission to select an Actor, mode or risk list. Native bash and
`coding_command` share the existing ephemeral registry/event delivery. Real configured-worker
allow/deny/cancel cases pass on Linux and both Mac baselines, including no effects while pending,
exactly-once effects after allow and refusal of duplicate/conflicting decisions. Protected and other
unattended worker modes auto-deny. Provider transport remains synthetic; these are not installed
foreground-client or background-scheduler qualification.

Daemon-native input preparation now reuses the fixed no-follow Agent document/session/upload
snapshot with Docker, but consumes only explicitly native Team defaults. It captures skills/uploads
as readonly inputs, never caller-selected roots or credentials. Actual configured and inbox-style
readiness fixtures pass on Linux and both Mac baselines. Inbox readiness fixes its Agent before
claiming messages; its canonical turn identity is assigned once afterward. Model commands refuse
until the actual provider worker consumes that handoff. Registration, current Agent/Team/model,
settings revision and the active owned workspace are rechecked, while cleanup remains possible
after registration ends. These private preparation primitives are exercised through both real
worker kinds. The subsequent explicit installation selector below now consumes those same brands.

Protected native preparation now uses the existing provider resolver, freezes its credential-minimal
projection and supports one-use pending inbox binding. Disabled providers, missing credentials and
unsafe endpoints refuse before native creation or network requests. The existing protected
preparation/turn brands and `prepareAgentTurn`/`runAgentTurn` now consume a genuine native preflight
without another authorization path. A real daemon-context fixture with Team Policy on checks peer
deny/allow, eight actual messages remaining unread until readiness, canonical claims, native tool
scope/redaction/receipts and positive writer release on Linux and both Mac baselines. Inbox attempt
correlation hashes the ordered message IDs into a fixed-size opaque ID; payloads are not included,
and this metadata grants no authority. This avoids exceeding native binding limits for valid
batches without truncating claims. Native verification requesters now require the bound capability
below, never a legacy host. Provider transport is synthetic; later selected-caller trials below
exercise real scheduled/inbox ticks. Installed client journeys remain unfinished. The first Mac daemon-context fixture staged only the
initial SQL file and failed bootstrap on the missing image-generation table. Staging now includes
the complete existing canonical migration chain, and fixture listeners close on bootstrap failure;
no schema validation, migration or deadline was weakened. That failed fixture remains failed evidence.

The verification wire/store now has a distinct closed native shape: null image, frozen native facts,
Team-relative cwd/allowlisted values and an explicit Team-memory-only readonly-input scope. Portable
retained-fact validation grants no availability or ownership; worker admission still checks the
current runtime and its live capability. Synthetic shape/routing regressions pass under both Node
baselines. The legacy executor explicitly refuses native records before creating receipts or effects,
so adding the shape cannot fall through to host execution. A separate internal daemon-owned native
check executor now uses real `prepareNativeTurn` admission and the existing command/output/receipt
stores. It requires the current Actor/controller, active owned writer and attempt claim, validates
frozen defaults/runtime facts, and checks the original source snapshot without replacing it. Its
checks accept only captured ordinal/command/cwd/timeout values; no private Agent inputs are granted.
Actual Linux and physical macOS trials on both exact Nodes observe native receipts with null images,
the original snapshot reference/time, late-secret output redaction, read-only memory, captured
timeout, unattended approval denial, command-override refusal, runtime/source drift refusal and
positive settlement. No provider is used in that executor-only fixture.

Explicit internal operator capture now freezes facts from actual native readiness and positive
retirement, never configuration or request JSON. Its observation is nominal, exact-request-bound and
one-use; copies, retagging, replay and mutable intent changes across preparation refuse. Canonical
Team Policy deny/allow, snapshot admission and native execution are observed on both Linux/Mac Node
baselines. The public selector below now consumes that same nominal observation after actual
readiness; JSON/configuration still cannot fabricate one.

Canonical verification dispatch now prepares the real restricted Pi worker with exactly
`verification_request`/`verification_check`. A parent-only nominal ownership token binds its live
Actor, attempt and owned workspace, reusing existing worker registration/signal/cleanup guards with
`hostCommands:false`. Raw `resourceLifecycle` remains forbidden for restricted workers, and neither
the token nor a native command host enters worker input. Actual Pi-worker trials on both Mac Nodes
and Linux reject undeclared/repeated ordinals and an unadmitted Bash call, preserve native receipts,
and ignore the model's claimed verdict. Only provider transport is synthetic loopback.

An ordinary native coding Agent can now request verification through its genuinely bound producing
turn. Before capture, the daemon freezes intent, checks the current Actor/Team/turn and defaults,
revalidates the retained runtime and refuses copied, wrong-scope or stopped requesters. A closed
true-only worker flag is accepted only with the matching parent capability; restricted workers
cannot acquire it. Capture stores native facts and Team-memory scope, never producer-private Agent
inputs. Actual daemon/Pi trials on Linux and both exact Mac Nodes modify a tracked file, capture
one request, run the two-tool specialist, retain its executor facts and deliver the result through
Team Policy. Only provider transport is synthetic.

Explicit installation selection now accepts `BAZILION_BASH_SANDBOX=native`. Canonical configured
preparation, protected scheduled turns and inbox readiness use genuine native inputs and the same
owned lifecycle. The selection is revalidated before executable input; stale preparation refuses
without a provider request. Ordinary host mode remains visibly unisolated. Linux retains legacy
Docker under its unchanged conditional disposition, never as native fallback; Mac protected work
uses native even with ordinary host mode off and rejects explicit Docker. Native risk gating is mandatory.

Actual Linux and both exact physical Mac Node baselines exercise configured Bash/coding commands,
a real due scheduled occurrence, eight-message inbox preparation and shutdown while native readiness
is acknowledged but the Agent is not registered. Wrong Docker defaults leave all messages unread;
shutdown aborts/drains the native preparation and confirms resources before release. Provider
transport is synthetic loopback, not installed-client or live-provider acceptance. Health, doctor
and Config report native selection as Not checked, with null image/Docker facts, no Docker probe
and no successful runtime badge. Raw SDK/worker native selection without its bound host refuses.
The initial selected-caller/status/legacy-regression batch passed 188 cases per baseline. An expanded
Node 24 SDK/worker batch then passed 222/223: configured coding completed, but its ordinary worker
cleanup stayed unconfirmed. Read-only retained facts show all three native resources confirmed and
a succeeded native receipt, while the worker resource and recovery writer remain blocked. Later PID
absence grants no release authority; the original cleanup refusal's cause is not yet established.
The expanded Node 26 batch passes all 223. A separate real Linux read-only control now demonstrates
that a newly started, independently owned non-dumpable sibling makes the legacy global output-FD
inspection refuse despite the original worker's normal exit, natural EOF and absent group. Its own
stdin EOF retires that controlled sibling; no census PID is signalled or adopted. This reproduces
an availability mechanism, not the uninstrumented original failure's specific cause or a production
fix. The subsequent native-only Linux worker owner now binds the actual ChildProcess, matching
birth/uid/parent/namespaces and original pidfd before input. Its no-host-command scope is distinct
from independently owned sandbox jobs. It signals only that original pidfd and requires actual
natural output EOF, exited pidfd and positive original-group absence; it does not scan unrelated
FDs or adopt descendants. Restored/substituted rows permanently revoke the binding, cannot fall
through to legacy PID recovery, and retain handles/resources. Legacy host/Docker cleanup is unchanged.

Seven real Linux controls cover independent inaccessible siblings, cold JSON receipts, concurrent
retirement, pidfd TERM/KILL without ChildProcess.kill fallback, inherited-output EOF, local transport
destruction, restored/substituted rows and fabricated/widened admission. The expanded 231-case Node
24 batch now passes while the full Node 26 native/source run executes concurrently; Node 26 also
passes all 231 focused cases. Current Mac configured/scheduled/inbox/readiness-shutdown, actual
restricted SDK dispatch and native-first disconnect/cancel regressions pass both exact Nodes after
the shared lifecycle change. The historical Node 24 failure remains failed with its original cause
unestablished; this does not retroactively settle or replay its retained writer. No ignored refusal
or deadline increase was used to turn it into a pass. Nine surrounding
unit failures were stale preparation-entrypoint mocks, including the shutdown fixture; mocks now
use the selected entrypoint/controller signal while preserving the same assertions and deadlines.
Operator capture now uses the authenticated existing HTTP endpoint shared by CLI/web. A bounded
process-local admission set fences new native captures, aborts outstanding readiness and drains it
with the existing shutdown cap before resource/DB teardown. It is not a persistent runs/workflow
layer. Native capture stores only actual one-use readiness facts after positive retirement; input
rejects environment/backend overrides and Agent impersonation, and known secret commands refuse
before storage. Canonical dispatch/check/input revalidation refuses backend drift; legacy executors
read the live daemon selection and cannot fall through to host execution under native selection.
Terminal histories remain unchanged. One initial admission-unit regression returned `already_owned`
instead of the existing `workspace_busy` for a running request; the guard is now terminal-only and
the original concurrency assertion is unchanged.

Authenticated Hono API trials on Linux and both exact physical Mac Nodes perform capture with no
provider request, run the real two-tool specialist against the original snapshot, exercise selection
off and mid-readiness change, and fence/drain acknowledged operator readiness. CLI/web labels say
captured native facts, not current readiness. Provider transport is synthetic loopback; this is not
installed-client, live-provider or actual main-process SIGTERM acceptance. The focused Node 24 API/
verification batch passes 105 cases plus four existing gated skips. Further protected/queue/recovery qualification remains open. A real mixed-capability source trial
now runs configured native coding with daemon-owned MCP stdio, actual managed headless Chromium,
guarded application-relative repository instructions and private-network SSRF denial. Live browser/
MCP resources survive the coding worker and are unavailable to scheduled/inbox workers even when
the model requests their names. Positive retirement preserves the browser profile; only the model
transport is synthetic. Current source trials pass on Linux and physical Mac/both exact Nodes;
blank-page observation is not website, desktop GUI or installed-client qualification.

The initial mixed Mac Node 24 trial remains failed: its canonical transcript records the first
scheduled native Bash call as `recovery_required`, then coding admission refusal. Later canonical
teardown positively released the resources. Its original cleanup cause is unestablished; a fresh
read-only diagnostic run did not reproduce it, and that temporary observer was removed. Native
failure IPC previously discarded the closed retirement observation. It now projects only backend,
a fixed phase, five boolean facts and at most two census verdicts, rejecting unknown fields or PID/
path-bearing payloads. Bash stores those facts in its canonical error details/text, never as successful
execution evidence or cleanup authority. Real two-drift controls on both Mac Nodes verify the Bash
facts and the existing interrupted coding receipt separately, without replay or changed deadlines.
The expanded Node 24 source/API/worker regression batch passes 148 cases/four existing gated skips.

Native operator and Agent capture require a live daemon secret supplier. Known credential-bearing
commands refuse before request/brief storage, and one-use observations recheck secrets at consumption.
The expanded operator capture privacy fixture passes Linux/both Nodes and Mac Node 26. Its Mac
Node 24 full flow passed the privacy assertions but later recorded an interrupted check with two
explicit `unknown: drift` census captures; the outer command timed out with a recovery writer and
unconfirmed resource retained. Read-only inspection confers no cleanup authority. That flow remains
failed, not retried into a pass; the drift's original source is unestablished. A broader Node 24
batch also exposed an import cycle before two suites could execute. Shared preparation errors now
live in dependency-free modules with the same error identities; both full focused batches pass.

Separate controlled-transport trials run real native commands through canonical dispatch, then
observe IPC disconnect and operator cancellation. Abort denies new RPCs immediately; pending native
checks/receipts drain before the worker is signalled. This avoids introducing known outside-process
churn during the native census. Native retirement and Worker TERM-to-KILL bounds, daemon shutdown
cap and ownership checks are unchanged. Both exact Mac/Linux Nodes observe positive settlement,
no automatic replay and no late command effect. These controls do not replace real Pi-worker trials.

Two Linux fixture failures remain recorded: expecting lowercase rather than the canonical uppercase
redaction marker, and wrongly treating bounded Team-relative `rm -rf` as a classified approval risk.
Only fixture assumptions changed; the established synthetic credential-access tripwire is now
asserted before execution. The first Mac negative-admission control retained an unconfirmed readiness
resource at its assertion; canonical live-owner teardown later settled it, with no captured command
executed. Its original cause remains unestablished. Closed preparation observations now survive error
boundaries, and mismatch controls require their specific refusal reason plus confirmed cleanup.
Current stricter trials pass both Mac baselines without changed deadlines, signals or policy grants.
The earlier verification/requester/worker/codec/restore batch passed 144 cases under each Node baseline, with
four existing gated skips. Five new counterfactual failures exposed incorrect no-execution settlement
for timeout/cancelled receipts, unsupported receipt-backed unknown outcomes, concurrent ordinal
execution and replay after an executor exception. The canonical initial schema now permits an
unknown outcome to retain only its own interrupted receipt (same Team/specialist/attempt), with no
exit code or cleanup claim. The runner fences each ordinal before awaiting, persists exceptions as
unknown without inventing receipts, and settles unknown attempts as uncertain, never automatically
replayed. Timeout/cancelled evidence counts as execution, not a pass; pruning does not erase its
executor state. A separate restore counterfactual showed a retained unknown receipt pointer; restore
now clears it while preserving the original uncertain attempt. No ALTER/import/fallback migration
was added: the alpha contract still requires clean rebootstrap after canonical schema changes.

The new lifecycle trials also retain their failed histories. A Mac Node 24 cancellation became
uncertain before closed diagnostic facts existed; its precise cause is unestablished. Two reporting
counterfactuals then exposed positively settled cancellation losing a buffered transport tail or
returning a signal-terminal result. Reporting now preserves known exit facts and recognizes
cancellation only with genuine positive cleanup; unconfirmed/forged facts remain unknown. A Mac
Node 26 disconnect recorded two `unknown:drift` captures and correctly stayed uncertain. A failing
Linux ordering control confirmed concurrent worker retirement before native receipt settlement.
Native-first draining fixes that avoidable churn without a third capture, sleep, replay or weaker
proof. Current stricter lifecycle trials pass both Mac Nodes; prior uncertain attempts remain
uncertain, not retrospectively repaired. Closed failure facts are retained without PIDs or authority.

**Unresolved lifecycle failures:** one Node 26.12.1 adversarial TERM-resistant cancellation returned
unconfirmed retirement. Normal and detached-writer cases in that run passed; the failed fixture
remains retained. Closed phase/signal/census diagnostics were then added without changing checks
or deadlines. Subsequent diagnostic runs passed, including a bounded fixture whose expiry never
grants settlement, but they do not establish the original cause or turn that failure green. The
original failure and the older post-cleanup busy observation remain unresolved. No PID oracle,
helper loss or diagnostic response authorizes signalling or release.

A later Node 24.22.0 protected-worker trial also retained an acknowledged native coding job with
unconfirmed cleanup. Its cause remains unestablished; a subsequent current-source normal run
passes on both baselines without relabelling the failed run. The failure exposed a separate evidence
bug: native refusal also prevented finalizing an already-issued receipt. Finalization now retains
live Actor/current-Team/issued-receipt checks without requiring a still-executable admission;
unknown execution settles as interrupted, never success. Closed job phase/census diagnostics carry
no PIDs or capabilities. A new actual-Mac worker counterfactual changes two real outside lifetimes,
leaves both census captures unknown and verifies an interrupted durable receipt. Only a later full
proof through the same live owner releases the resource. Template cleanup may then be requested
again only after every retained view loan is positively released; it repeats no signals/commands
and never reopens admission. Both exact Mac baselines pass this fixture with unchanged census and
3.5-second retirement checks. An initial diagnostic fixture incorrectly assumed an enum-shaped
reason rather than the existing free-text wire reason; that failed assertion remains failed evidence.
This control characterizes drift, not the cause of either original uninstrumented refusal.

A controlled real lifetime change between the outside inventories reproduced explicit `drift`
while TERM/KILL and natural command EOF were already confirmed. The same live observer later
recovered from a fresh complete proof without repeating commands or signals. Retirement now permits
at most one additional **read-only** capture for explicit drift, within the unchanged 3.5-second
deadline. Each capture must independently satisfy every original check. Busy domains, other
unknowns and two drifted captures remain blocked. Actual single-/double-drift controls pass on
both exact Mac Node baselines, and the current Node 26 adversarial retirement regression passes.
This characterizes and handles that transient mechanism; it does not retrospectively establish the
original refusal's cause or erase its failed evidence.

Layout admission inspects every selected entry without Git/ignore exclusions or content reads.
Writable outside hardlinks, mixed readonly/writable inode aliases, special nodes, unsafe symlinks,
nested mounts, drift and exceeded bounds refuse. Bounds are 1,048,576 entries, 32,768 directories,
depth 64 and a shared five-second two-pass window, plus the cursor's 16,384-entry directory bound.
Literal POSIX metadata names support systemd backslashes without relaxing repository-context target
parsing. Immutable readonly input symlink names whose targets are not admitted remain recorded but
add no roots; real Linux/Mac probes deny outside access and alias relocation. Captured roles/roots
are immutable and must match the launch view. Uninspectable visible entries still refuse.

A whole `/usr/lib` capture exceeds the unchanged bound on this host. Required runtime libraries are
instead selected as a bounded ELF file closure; this does not make every installed host application
available. Team defaults now require an explicit `native` or `docker` discriminator across API,
CLI and web. Native defaults have no image; each resolver refuses the opposite backend instead of
reinterpreting it. The allowlisted cwd/environment values remain optional passive settings, not
readiness or permission to activate protection. Image-only legacy settings are refused under the
clean-install contract. Both exact Node baselines pass the 33-case defaults/management batch
(one existing Docker-only skip); installed UI/active native product selection are not thereby
qualified.

Actual user-queue/communication approval trials now pass both exact Nodes on Linux and physical
Mac: policy/paused holds have no kernel/provider effect, approval delivers once with readonly
attachments, duplicate/deny cannot replay, incompatible defaults fail without fallback, and the
independent queue pump drains configured native work. Telegram capture rechecks the actual retained
owner/topic/credential binding; direct/approved Telegram queue turns are protected native, and a
rebound topic refuses before execution or a status notice. The notice transport is synthetic—no live
bot acceptance is implied. A first cancellation trial correctly settled a cancelled native receipt
but misreported the turn as failed because Pi returned `This operation was aborted`. Worker event
translation now normalizes only known abort strings after its real signal handler ran. Other errors,
late known outcomes and unconfirmed cleanup are never converted into cancellation or success. The
raw canonical Pi message remains unchanged. Two queue counterfactuals preserve unknown cleanup as
`uncertain` with no replay; the current Node 24 ownership/queue/refresh/restore batch passes 165 cases.

Current standalone daemon MCP clients also pass both exact Mac/Linux Nodes for explicit environment,
actual call and descendant retirement, busy cancellation/reaping, opening retirement and failed
initialization. All retirement is through original live owners; native oracle identity checks are
read-only, never signalling authority. No installed or main-process restart/restore qualification is
claimed by these source trials.

The current Linux native/source run passes **3,152 cases / 75 skips** plus four separate
headless probes. Node 24.22.0 and 26.12.1 native/regression batches each pass **286 cases**
plus one Mac-only skip; that new worker double-drift fixture passes separately on the actual Mac;
the unchanged security acceptance gate passes **477 required cases**, and pinned root/web typechecks,
repository lint and the CLI/daemon/native-entry bundle build pass. These are foundation-state gates,
not complete feature qualification. Further caller/recovery qualification, historical Mac refusal
analysis, affected ordinary-worker authority/
recovery revalidation and integrated Mac qualification remain pending. Cancellation sender review
found swallowed `beforeSignal` errors; TERM/KILL now stop on guard refusal, unregistered ownership
cannot signal and cancellation is rechecked before executable input. Three live trusted-worker
regressions failed before the fix and pass on Linux and both Mac baselines. For withheld input,
actual bootstrap stdout EOF/exit is observed before final cleanup is cached; local destruction and
elapsed fixture time grant no settlement. This does not replace native descendant/census checks,
relax the existing kill grace or qualify unrelated installed/background journeys.

The scoped Mac toolchain now includes exact Node 26.12.1 and pnpm 12.15.0, with verified official
archive/package digests and an isolated native-only wrapper/HOME. The first pnpm invocation failed
because the package's current native-binary layout was mistaken for an older `.cjs` entry; the
explicit verified platform package fixed that installation without a downloader fallback or
personal configuration. Node's Mach-O minimum is 13.5; pnpm's is 11.0. These technical minima do
not qualify older OS releases or establish the native SPI's older-OS behavior.
Real worker trials exposed a Node-dependent packaging prerequisite: the shared `better-sqlite3`
build for Node 26 ABI 147 correctly refused Node 24 ABI 137 on both hosts. Fresh isolated Node 24
installs from the unchanged frozen lockfile pass the same worker assertions without mutating the
Node 26 trees. The mismatched runs remain failed evidence; no ABI shim, runtime substitution or
weakened memory guard was added. Switching Node majors requires an ABI-matched installation.
These assembler observations predate product integration. Since then macOS Docker/VM/tooling has
been removed, applicable Docker coverage retained on Linux and native CI transition started.
Those changes do not relabel these earlier observations as installed or hosted-CI acceptance.

## 8. Approved refinements — 2026-10-27

The operator explicitly accepted both additions below before product implementation. This
approval resolves the API/network decision gate, not the remaining implementation or qualification.

1. **Mac process-census dependency:** accept the published but non-SDK libproc identity ABI above,
   with strict layout/behavior checks, bounded ephemeral inventories and fail-closed refusal on
   incompatibility. Keep actual live ownership and public native birth checks for signalling;
   never recover authority from stored IDs. The compatibility risk is accepted; unavailable or
   unexpected behavior must refuse rather than fall back to group-only cleanup.
2. **Common strict native network contract:** permit pipes and explicitly admitted per-job pathname
   Unix IPC, but deny command TCP/UDP, **including localhost**, on both native platforms. This
   preserves host-service isolation but narrows functionality: tests requiring TCP servers cannot
   run unchanged in that protected mode. Ordinary explicitly unprotected host mode remains visibly
   unisolated, never an automatic fallback. No Agent-controlled relaxation switch is proposed.

Implement this accepted contract without another approval request for ordinary within-scope fixes.
Production enablement and CI replacement still require the native boundary to be established;
conditional Docker retirement still requires qualification on both platforms and safe resource
cutover. No additional entitlement, privilege, system configuration change, spend or access renewal
is authorized by accepting these refinements.

## Sources

- [Bubblewrap README](https://github.com/containers/bubblewrap/blob/main/README.md) and
  [manual](https://github.com/containers/bubblewrap/blob/main/bwrap.xml): namespaces, policy
  responsibility, status channel, parent-death behavior and limitations.
- [Linux PID namespaces](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html): namespace
  init termination and remaining-process behavior.
- [Kernel Landlock](https://docs.kernel.org/userspace-api/landlock.html) and
  [seccomp](https://docs.kernel.org/userspace-api/seccomp_filter.html): ABI/scope and limitations.
- [Apple App Sandbox](https://developer.apple.com/documentation/security/app-sandbox),
  [file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
  and [embedded helper guidance](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app):
  supported app/helper and permission model, not proof of a drop-in CLI implementation.
- [Apple SDK header mirror](https://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX11.3.sdk/usr/include/sandbox.h):
  copied Apple deprecation notice; not an observation of the latest installed SDK or OS.
- [XNU process events](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event.h),
  [sessions](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_prot.c) and
  [reparenting](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_proc.c):
  limits of group/lineage inference, not an execution test.
- [XNU process inspection](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c)
  and [private identity declarations](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h):
  published identity layout/implementation, not public-SDK support. No private header was installed.
- [Apple Endpoint Security entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client):
  permission/entitlement burden of an alternative event-tracking architecture.
- [Codex Linux sandbox](https://github.com/openai/codex/blob/main/codex-rs/linux-sandbox/README.md)
  and [Seatbelt policy](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt_base_policy.sbpl):
  native implementation references, not drop-in Bazilion guarantees or defaults.
- [Anthropic sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime): a candidate
  library/reference, not selected here. Its documented unrestricted-read defaults, implicit write
  locations, warning-only weakening paths and proxy behavior must not be adopted as Bazilion's
  stricter policy. No package or dependency was installed for this review.
