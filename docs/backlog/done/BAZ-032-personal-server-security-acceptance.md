---
id: BAZ-032
title: Personal-server adversarial security acceptance gate
status: done
size: M
created: 2026-08-26
refined: 2026-08-26
shipped: 2026-08-26
priority: high
note: Prove the composed BAZ-027 through BAZ-030 security boundary before releasing 0.13; do not add a second runtime or production security policy.
---

# BAZ-032 — Personal-server adversarial security acceptance gate

## User stories

- **As Bazilion's sole operator**, I want one repeatable adversarial acceptance command for the
  personal-server topology, so a release cannot pass by testing each security feature only in
  isolation.
- **As the person recovering a lost or compromised device**, I want revocation and restore tests to
  cross browser, native, Telegram, and worker boundaries, so stale authority cannot survive through
  a neighboring subsystem.
- **As the release maintainer**, I want deterministic offline evidence separated from machine- and
  tailnet-specific checks, so CI failures are actionable and a green CI job does not falsely claim
  that a particular server is safely deployed.

## Goal

Add a release-gating adversarial suite that composes the shipped BAZ-027 through BAZ-030 controls:

```text
hostile request/update/archive/runtime input
                    │
                    v
private web gateway -> daemon auth/policy -> protected worker / Telegram / restore
                    │
                    v
     exact allow or fail-closed outcome + secret-free evidence
```

The suite must run from a clean temporary Bazilion home without external credentials, network
services, Docker, Tailscale, or mutation of the operator's installation. A separate explicitly
named live smoke step invokes the existing read-only `bazilion gateway preflight`; it is documented
release evidence, not part of deterministic CI.

## Why

BAZ-027 through BAZ-030 have strong focused coverage, but their most consequential assumptions meet
at process and protocol seams. The current BAZ-028 tests prove session primitives and daemon HTTP
login, while production Host/Origin/header/CSP behavior is mostly exercised as isolated helpers and
build output. Telegram authorization, protected-worker redaction, SSRF, and encrypted restore are
also well tested individually. A regression can therefore preserve each local test while breaking
the composed boundary—for example, a proxy rewriting a bearer into cookie authority, a restored
session surviving device recovery, or an ingress path selecting the configured worker surface.

This story creates the 0.13 security acceptance gate. It is not a penetration-test claim, proof of
absence of vulnerabilities, or a new security framework.

## Product and test-architecture decisions

- **One offline gate:** add `pnpm security:acceptance`, implemented through checked-in Vitest
  projects/files and ordinary repository tooling. It runs only the bounded adversarial matrix and
  returns non-zero on any skipped required case.
- **Real boundaries where they matter:** production-gateway cases boot the built TanStack server in
  front of a real test daemon on loopback and use raw HTTP requests. Tests may inject loopback ports
  and a canonical test origin, but may not bypass the route, auth middleware, cookie parser, or
  response path being asserted.
- **Pure seams for external state:** DNS answers, time, Telegram updates, provider frames, Tailscale
  status, and archive bytes use deterministic injected fixtures. Tests never contact public DNS,
  Telegram, OpenAI, Tailscale control services, or a package registry.
- **Existing controls stay canonical:** production fixes found by the suite are made in their
  existing BAZ-027–030 owners. Do not add an alternate auth middleware, proxy, redactor, SSRF guard,
  restore validator, Telegram ACL, protected-turn selector, or test-only production bypass.
- **Negative evidence is bounded:** sentinel values assert absence from HTTP bodies/headers, worker
  input/output, logs captured by the harness, transcript fixtures, restored state, and CLI output.
  The gate does not scan the whole workstation or claim to inspect third-party service logs.
- **Live deployment remains explicit:** `bazilion gateway preflight` is the only supported live
  posture check. The acceptance command prints the exact follow-up but never runs it implicitly or
  reports a tailnet deployment as safe.
- **No flaky timing:** expiry, concurrency, replay, and DNS rebinding cases use controlled clocks,
  barriers, or deterministic attempts rather than sleeps or dependence on scheduler timing.

## Required adversarial matrix

### 1. Production web gateway and browser session

- Start built web + daemon listeners on loopback with an exact HTTPS public origin. Prove unexpected
  Host, Origin, `Forwarded`, mismatched `X-Forwarded-Host`, and mismatched
  `X-Forwarded-Proto` fail before daemon side effects.
- Prove cookie-authenticated unsafe requests fail for absent/mismatched Origin, absent/mismatched
  CSRF header, a CSRF value from another session, and a revoked/idle-expired/absolute-expired
  session. Exact-origin requests succeed.
- Prove a valid native device bearer works without browser CSRF and remains bearer-authenticated;
  the gateway must not mint, translate, or persist a browser session for it.
- Prove bootstrap browser login, expired/revoked devices, session fixation input, duplicate cookies,
  and stale concurrent session revocation fail explicitly without reflecting secrets.
- Assert production cookie flags, security headers on HTML and API responses, local-only font/CSP
  assets, JSON and multipart size limits, streaming NDJSON, downloads, and supported upload flow.

### 2. Credential lifecycle and recovery

- Assert device expiry/revocation invalidates every derived browser session while leaving unrelated
  device credentials and sessions active; logout revokes only the current session.
- Restore a valid encrypted fixture containing active devices and sessions. Prove devices are
  preserved, every restored browser session is revoked before installation, and no cookie/session
  secret or hash appears in operator output.
- Rotate the bootstrap credential in a staged fixture. Prove the old bootstrap, all device tokens,
  and every browser session are invalid while encrypted secrets remain readable only with the new
  local bootstrap.
- Tampered, truncated, schema-mismatched, traversal, symlink-escape, wrong-identity, and auth/DB
  mismatch archives must leave the target installation unchanged or in the documented recoverable
  state.

### 3. Ingress identity, replay, and protected execution

- Feed Telegram pairing and ingress with wrong chat/topic/user, anonymous, bot-authored, edited,
  forwarded/replayed callback, expired challenge, and reused update identities. None may enqueue,
  approve, invoke, or respond as the owner.
- For authenticated Telegram, scheduled, inbox, approval-delivery, restricted-review, and hosted
  HTTP work, prove the trusted invocation selects the protected/review surface and cannot be
  downgraded with cloned or contradictory metadata.
- Inject sentinels for bootstrap, Telegram bot token, OAuth refresh, unrelated provider/tool
  credentials, host paths, browser, MCP, and ambient environment. Protected worker inputs, frames,
  errors, transcripts, captured logs, and source-owned failure messages must omit them.
- Prove missing Docker/readiness, unsupported provider, invalid refresh result, worker crash,
  cancellation, and approval replay fail closed with exactly one bounded source-owned outcome and
  no fallback to configured host execution.

### 4. Network and content boundaries

- Exercise direct and redirected web requests to loopback, RFC1918, link-local, metadata,
  IPv4-mapped IPv6, mixed/encoded address forms, and a deterministic DNS-rebinding sequence. The
  canonical SSRF guard must reject them before content reaches the worker.
- Prove allowed public HTTP content remains bounded, redirect-limited, cache-key separated by
  extraction mode, and incapable of injecting response headers or credentials into subsequent
  requests.
- Prove shell approval display escapes terminal-control characters and that protected Docker
  fixtures cannot see host sentinels, Agent private homes, writable Team memory, host networking,
  image-declared volumes, or non-allowlisted environment values.

## Deliverables

- A documented `pnpm security:acceptance` script and deterministic Vitest acceptance project/files.
- Shared test harnesses only where they reduce duplicated setup; every helper must preserve the real
  production boundary under test and have a narrow name describing what is simulated.
- A machine-readable case manifest or table mapping every required scenario to its test name and
  owning BAZ/control. The command fails if a required manifest entry has no collected test.
- Focused production-gateway integration coverage, including a narrow/mobile viewport browser pass
  if the existing repository browser tooling can run deterministically; otherwise DOM-independent
  security behavior remains mandatory and the visual limitation is documented.
- Release documentation that records the offline command, expected result, live preflight step,
  threat-model limitations, and how to preserve a failure artifact without retaining secrets.
- Production fixes for vulnerabilities the suite demonstrates, with regression tests at the
  canonical owner as well as the cross-boundary acceptance case.

## Out of scope

- Automated scanning of the public internet, a real tailnet, firewall, cloud account, Telegram, or
  OpenAI account; destructive testing against the operator's installation.
- Claiming certification, formal verification, complete penetration testing, dependency/SBOM
  auditing, or absence of undiscovered vulnerabilities.
- Fuzzing without a bounded corpus and deterministic seed, load/DoS benchmarking, or long-running
  chaos infrastructure.
- New user roles, scopes, auth providers, WAF/rate-limiting product features, generic SIEM/audit
  storage, a second gateway, or BAZ-031 provider/tool expansion.
- Weakening fail-closed behavior so a test environment can avoid Docker, OAuth, HTTPS, or protected
  runtime requirements. Simulated dependencies must sit outside the production decision boundary.

## Acceptance criteria

- `pnpm security:acceptance` passes from a clean checkout with no real secrets or external network,
  covers every required manifest entry, and cannot silently pass required cases through `.skip`,
  `.todo`, name filters, unavailable binaries, or missing build artifacts.
- The gateway matrix uses the production build and observes daemon side effects, proving rejection
  happens at the intended boundary rather than only matching a pure validation helper.
- Each hostile case asserts the exact allowed/denied effect and at least one relevant non-effect;
  status-code-only assertions are insufficient for mutation, ingress, restore, and worker cases.
- Cross-session/device isolation, restore revocation, bootstrap rotation, Telegram replay identity,
  every protected invocation kind, SSRF rebinding, worker redaction, and fail-closed source outcomes
  have named deterministic cases.
- Test diagnostics and preserved failure artifacts contain no plaintext bearer, cookie secret, CSRF
  value, OAuth refresh/access value, bot token, encrypted secret plaintext, or private host path.
- The full root suite, root/web/mobile typechecks, lint, production web build, and the new acceptance
  command pass. Existing intentional skips remain documented but none belong to the required
  security manifest.
- The release checklist distinguishes: offline acceptance passed; live private-gateway preflight
  passed; release committed; release published. Passing one state must not imply the next.

## Delivery slices

1. **Manifest and harness:** map existing controls, add the no-skip manifest contract, create clean
   temp-home/controlled-clock/raw-request fixtures, and wire `pnpm security:acceptance`.
2. **Gateway and recovery composition:** boot production web + daemon, cover Host/Origin/CSRF/bearer,
   headers/body/stream behavior, and compose device/session restore and rotation cases.
3. **Ingress and runtime composition:** add Telegram spoof/replay, trusted invocation, protected
   runtime sentinel, source-owned failure, SSRF rebinding, and Docker boundary cases.
4. **Release gate:** run the complete matrix and standard validation, fix demonstrated production
   defects at their canonical owners, document offline versus live evidence, and record the exact
   validated result in this story's As-built section.

Each slice must keep ordinary focused tests usable. The story is done only when the single offline
gate proves the complete required manifest and the live preflight remains a separate explicit step.

## As built

- `pnpm security:acceptance` builds the production web application, verifies 53 exact required
  cases from `security/acceptance-manifest.json` are collected, then runs them serially and rejects
  every missing, skipped, todo, or non-passing result. Its temporary JSON report is removed on both
  success and failure.
- The production gateway fixture boots the built TanStack server in front of a real temporary
  daemon. It covers authority/origin/CSRF/session binding, device revocation and controlled
  deadlines, secure headers and body limits, plus streaming, upload, download, and forwarding-header
  behavior without external services.
- The gate composes encrypted restore and bootstrap rotation with browser-session invalidation;
  Telegram bot/edit/anonymous/replay rejection; every protected invocation posture; minimal worker
  credentials, cancellation, refresh and crash failures; approval at-most-once delivery; SSRF DNS
  rebinding, metadata redirects and cross-origin credential stripping; terminal-safe shell approval;
  and hardened Docker specification checks.
- Acceptance found three canonical-boundary defects and added regression fixes: duplicate secure
  cookies with whitespace are rejected before proxy auth, edited Telegram messages cannot become a
  fresh ingress attempt, and cross-origin guarded-fetch redirects strip sensitive request headers.
- `docs/security-acceptance.md` records offline use, limitations, safe failure handling, and the
  separate live `bazilion gateway preflight`, commit, and publication evidence states.
- Validated on Node 26.7.0: the 53-case acceptance gate passed; the root suite passed 131 files and
  1102 tests with 1 file/3 tests intentionally skipped; root, web, and mobile typechecks passed;
  lint passed with 40 existing warnings; and the production web build passed.
