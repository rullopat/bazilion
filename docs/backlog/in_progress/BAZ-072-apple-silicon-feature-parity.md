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
installed revalidation remains pending. An initial root/PID-namespace invocation failed browser startup, permission-sensitive
backup and delayed-child settlement checks; the normal suite passed without relaxing checks. A concurrent security run timed
out; a standalone run passed. These do not establish macOS qualification.

Latest-stable macOS acceptance, broader coding workflow acceptance and private-worktree layout
parity remain open. MCP stdio, browser/protected lifecycle work, image/live acceptance and the
technical-minimum audit are not implemented/qualified by this increment. No version bump,
publication or expanded released-support claim has occurred.
