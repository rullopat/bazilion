# Beta readiness — current candidate and qualification plan

**Rewritten 2026-09-20 for the frozen, unpublished `0.22.0` candidate.**
**Current recommendation: HOLD.** The published baseline is `0.21.0-beta.5`; repository package
versions still have that value. Local validation is substantial, but it is not release approval.
This plan does not authorize live spending, publication, deployment or a `1.0.0-beta.1` promotion.

## Read this set in order

1. [Current evidence and open decisions](evidence-audit.md): what was actually observed and its limits.
2. This plan: release scope, remaining work, execution rules and decision gates.
3. [Scenario catalogue](scenario-catalog.md): 110 scenario families, including image generation.
4. [Usability and accessibility protocol](usability-protocol.md): 16 task cards and observation rules.
5. [Scheduled content-Team acceptance](content-team-acceptance.md): required composed B journey,
   18 core subcases and six conditional publication subcases; not yet executed.
6. [Release procedure](../../releases.md): reviewed version transition, publishing and documentation.

The [freeze record](../0.22.0-freeze.md) identifies the tested source inputs and command logs.
[BAZ-059 acceptance](../../backlog/BAZ-059-acceptance.md) provides implementation-level traceability.
These are evidence inputs, not a second product transcript or a general run/event system.

## 1. Scope and two distinct decisions

### R — Release the image-generation feature beta

Scope is frozen to BAZ-059: one daemon-owned `image_generate` tool, four concrete selections,
independent default-off enablement, Automatic routing and existing Results/Team Policy surfaces.
Only validation, documentation and fixes for demonstrated defects should enter the candidate.

| Selection | Credential route |
| --- | --- |
| `google/gemini-3.1-flash-image` | OpenRouter through Pi |
| `openai/gpt-image-2` | OpenRouter through Pi |
| `openai:gpt-image-2` | Direct OpenAI API key; separate API billing |
| `openai-codex:gpt-image-2` | Stored ChatGPT/Codex OAuth; account-dependent subscription usage |

Automatic is a selection rule, not a fifth model or an error fallback:

- Keys/login alone do not select a route. Image generation still needs its own opt-in.
- An OpenAI/Codex text Agent uses its own provider only when enabled; otherwise refuse.
- Another text Agent uses the sole enabled OpenAI option; dual enablement requires an explicit choice.
- Explicit image choices override Automatic and work independently of text enablement.
- OpenRouter is never automatic. Errors, quota exhaustion and uncertainty never switch billing routes.
- Admission records the concrete route. Drift during OAuth refresh refuses before dispatch;
  already-sent work retains its captured route.

Generation is not disclosure authorization. Results remain private until source-owned egress allows
or approves them. Rework is another potentially billable generation, not reference-image editing.
Selected model labels are not an attestation of the backend model actually used.

**Known release decision:** after capture but before delivery authorization, a daemon crash can
leave an image that startup cleanup reclaims. A tombstone prevents regeneration, but a paid output
can be lost. Already-authorized Results survive restart. The operator must review this limitation;
a passing no-replay test is not acceptance of recoverable delivery.

### B — Establish broader beta maturity before considering 1.0

The product-wide campaign covers existing installation, identity, chat, management, coding,
review/verification, publication, integrations, accessibility, performance and recovery contracts.
It requires evidence beyond a feature-beta release: independent users, supported browser/device
coverage, larger/active installed-home recovery and sustained operation.

R and B are separate decisions. The proposed R checklist must be agreed by the reviewer/operator;
it is not a waiver of an existing critical defect or a claim that B has passed. Neither decision
requires implementing future social connectors, editorial packets, a workflow engine, additional
image models or direct Google image access. The [BAZ-063 composed journey](content-team-acceptance.md)
is required for B: first-request brief, actual cron-driven research/text/images, human rework and
approval, then manual handoff over two cycles. Topic and purpose are supplied in the brief; two
independently selected topics check reuse, with no prescribed industry. BAZ-064 owns the recipe and
deterministic handoff, BAZ-065 scheduling/recovery, and BAZ-066 live/human qualification; BAZ-063
consolidates their evidence using the protocol's case/lane ownership. The first test uses
[Mastodon manual handoff only](../../backlog/design/content-platform-first-test.md), not three
platforms; other formats and a future Mastodon publisher are separate scope. Automatic social publication
is a separately reported conditional extension, not a core prerequisite or a claimed current capability.
Missing safe scheduled research or timezone capability stays Blocked and needs separate refinement;
do not weaken the runtime or expand the frozen R scope to manufacture a passing journey.

## 2. Current position

The frozen-candidate suite was recorded on **2026-09-19**, Linux, Node 26.7.0, pnpm 11.14.0.
The documentation rewrite did not rerun the product suite. On **2026-09-20**, BAZ-064 added an
experimental recipe and four management/policy checks; 50 related checks and root/web typechecks
passed. [That narrow evidence](../../backlog/BAZ-064-acceptance.md) is not a new full-suite run or
composed CT pass. Protected discovery is blocked on BAZ-067; no runtime change or live call was made.

| Evidence | Recorded outcome and boundary |
| --- | --- |
| Regression | 1,927 passed, 11 skipped; 238 passed / 3 skipped files. Not 1,927 acceptance journeys. |
| Security | 173 required cases passed, including 20 image cases. Deterministic, not live-provider qualification. |
| Type/build | Root + web typecheck and production build passed. |
| Lint | Changed-file check had no errors. Whole-repository check has 14 errors in 12 untouched files; no waiver is approved. |
| Packaging/upgrades | Linux packed installer passed; all five 0.21 betas and v0.20.0 passed source-worktree sentinel upgrades; v0.19.0 refused. Not populated installed-home or public-installer coverage. |
| Images | Six synthetic-provider Agent turns, released downloads after restart, real configured-operator Docker execution and two actual SIGKILL barriers passed. Protected-origin end-to-end image execution remains unobserved. |
| Browser | Chromium configuration/Results projection passed at 1280×1000 and 390×844. Not a live generation journey or independent usability study. |
| Versioning | A disposable Changesets rehearsal produced exactly 0.22.0. The unchanged repository still plans 0.21.0-beta.6. |

See the [evidence inventory](evidence-audit.md) for exact sources, initial failures and missing lanes.
No current Node 24/cross-platform PR result, live image sample, human study or soak completion is
inferred from this local record.

## 3. Remaining R work, in order

| Gate | Required next evidence | Current state |
| --- | --- | --- |
| R1 — Review | Review implementation/migration/credential boundaries; decide the abandoned-private-output limitation and baseline lint disposition. | Open decisions; no assumed acceptance. |
| R2 — Candidate and CI | Pin reviewed SHA, lockfile and artifact hashes; run Node 24/platform PR checks, representative populated upgrade/restore cases and review exclusions. Verify required checks/rulesets. | Source/component checks exist; reviewed CI and populated installed-home cases pending. |
| R3 — Image behavior | Complete the image families in the catalogue at their named layers; add a real protected-origin image turn, distinct from configured-operator Docker. | Deterministic coverage exists; protected-origin execution pending. |
| R4 — Live compatibility | An authorized bounded sample of every advertised selection; an actual browser generate → preview/download → rework → restart journey. | Blocked on account and spending/usage authorization. |
| R5 — Operator recovery | Observe route/billing comprehension, missing credentials, quota/uncertainty, held delivery and the private-output-loss warning. Verify keyboard/narrow-screen image tasks and affected core recovery. | Projection smoke exists; composed task evidence pending. |
| R6 — Versioned artifact | Apply the rehearsed transition in a reviewed version PR; assert all three public packages are exactly 0.22.0. Repack and smoke the final artifact. | Scratch execution passed; real transition not applied. |
| R7 — Release decision | Assemble durable evidence, support/limitation notes and matching website draft; independent review and explicit operator authorization before the publish-triggering merge. | Not authorized. |

Use the catalogue's R rows as the proposed release-specific set. B-only rows still matter for
broader maturity, and any critical finding from them blocks release. A family is not complete
because one associated unit test passed: expand it into named configurations and track each result.
If live qualification fails, fix the demonstrated defect or explicitly narrow supported scope and
all related surfaces before review; do not relabel a simulator as a live pass.

## 4. Execution and evidence rules

### Results and oracles

Each concrete case/configuration is **Passed**, **Failed**, **Blocked**, **Not run**, or **Not
applicable** with a reviewed reason. Partial coverage is recorded as separate cases, never as a
partial pass. Unsupported platform behavior needs a successful refusal test.

Capture three perspectives where relevant:

1. User-visible state, final URL/resource identity, input preservation and available next action.
2. Authoritative receipt, policy decision, selected conversation and Pi JSONL evidence.
3. Independent external effect: provider request count, actual process/container, remote object or
   exact downloaded/restored bytes.

Retain first failures and retries. A passing retry does not erase a failure or prove a flake fixed.
Use explicit barriers for claim/dispatch/commit/ACK tests, not a sleep guessed to hit the window.
No image transport retries or uncertain-request reruns are permitted merely to obtain a green sample.

### Safety and authorization

- Use disposable homes, synthetic projects and test-owned resources. Never fill the host disk,
  kill unrelated processes, copy runtime ownership into permission to kill the original, or send
  to an unapproved recipient. Stop immediately on exposure, corruption or unintended side effects.
- Keep default tests offline with fixed synthetic credentials and blocked unexpected provider calls.
  Audit environment inheritance; do not infer a credential allowlist from existing fixtures that
  spread `process.env`. No production fault-control endpoint is needed.
- Live authorization names accounts, routes, destinations, maximum attempts and spend/usage limits.
  Enabling images is per-home and can affect normal background turns: isolate or pause unrelated
  work with operator agreement. Do not silently copy OAuth refresh credentials between homes.
- Account-side limits and billing records are authoritative. Request/count/byte limits and Pi cost
  estimates are not hard dollar-budget enforcement. Unknown cost is unknown, not zero.
- Live interruption tests require separate approval because a cancelled request can still consume
  usage. Configure stop conditions before dispatch; do not discover the budget by spending it.

### Candidate evidence packet

Record scenario/subcase ID, candidate/artifact hash, environment/runtime/provider, fixture seed,
expected and observed UI/state/side effects, result, attempts, duration, defect/limitation, owner
and reviewer. Include redacted traces/logs, receipt IDs and byte hashes as appropriate.

The freeze's `/tmp` artifacts are not a durable archive. Before release, copy reviewed, redacted
material to access-controlled CI/test storage and keep a small committed index. Never upload a
real home, bearer/cookie, refresh token or full environment. Suggested retention, subject to approval:
raw synthetic artifacts 14 days, redacted candidate evidence 90 days; human recordings require
separate consent and a short deletion deadline.

## 5. Environments and fixtures

| Axis | R baseline | B extension |
| --- | --- | --- |
| Daemon | Linux full-turn path; Node 24 CI plus the recorded Node 26 local result | Additional advertised architectures; macOS/Windows installation/management and truthful turn refusal |
| Browser | Production build; Chromium desktop/narrow plus keyboard image/recovery tasks | Firefox, WebKit, actual Safari/iOS, Chrome/Android; light/dark, zoom, reduced motion, assistive technology |
| Runtime | Host, configured-operator Docker, separately observed protected origin; restricted image denial | Other supported provider/posture combinations, cleanup races and resource stress |
| Provider | Deterministic faults; separately authorized four-selection live image lane | Broader chat/OAuth/local, Telegram, gateway, MCP/browser and code-host samples |
| State | Fresh, populated small, held/uncertain/tombstoned image results, restart and backup copies | Large histories, active restore, constrained disk, sustained concurrent operation |

All Agent turns remain Linux-only until BAZ-057. A phone/macOS browser connected to Linux is not
proof a macOS daemon can execute turns. Record the Windows memory exclusions separately.

Fixtures should be built through supported interfaces, with SQL corruption/scale seeding labelled:

- **F0:** genuinely fresh DB/auth pair and browser setup, no pre-seeded provider shortcut.
- **F1:** two Teams, distinguishable canaries, three Agents, profiles/skill, safe repository and fake services.
- **F2:** lived-in synthetic home: 10 Agents, 5 Teams, 200 conversations, about 20,000 messages and mixed evidence.
- **F3:** exploratory load up to 100 Agents/50 Teams/2,000 conversations/100,000 messages; not advertised capacity.
- **F4:** actual interrupted operations with independent counters and deterministic barriers.
- **F5:** prior released artifacts with populated homes; offline restore/upgrade copies.
- **F6:** explicitly approved provider accounts, private test destinations and gateway devices.

## 6. Broader B campaign

Execute in reviewable slices, not as a new product feature program:

1. **Harness and core journeys:** installed-artifact browser onboarding, lost-ACK queue reconciliation,
   real loader Retry and failed mutation refresh. Assert final URL, resource and side effect, not headings.
2. **Management and coding:** catalogue coverage across stateful panels and CLI/web parity, including
   snapshots, review, specialist attempts, publication and communication policy.
3. **Content Team:** execute [the shared protocol](content-team-acceptance.md) through BAZ-064's
   recipe/deterministic handoff, BAZ-065's real cron/recovery path and BAZ-066's live/human checks.
   Require two actual preparation-cron occurrences, retained generic brief, specialist handoffs, two
   rework rounds, exact final approval and manual instructions/downloads. Test a second selected topic,
   late approval, schedule changes, restart and the actual protected origin. BAZ-063 reviews the combined
   evidence; conditional publishing cases remain with the supported, authorized delivery/connector stories.
4. **Reliability:** populated installed-home upgrades/restore, real quota-volume ENOSPC distinct from
   permission denial, process/container cleanup and post-effect/pre-ACK barriers.
5. **Human/accessibility:** the separate protocol's two moderated rounds and supported assistive/device
   checks. An agent/expert walkthrough does not replace independent users.
6. **Performance/endurance:** a 2-hour smoke, then 24-hour and 72-hour mixed-workload soaks on a stable
   candidate. Measure processes, FDs, RSS/CPU, writer claims, DB/WAL/free pages, store bytes and latency;
   distinguish expected history growth from leaks. Test seven-day expiry with controlled clocks separately.
7. **Live integrations and decision:** approved samples of advertised integrations, final regressions,
   documentation-only recovery, independent review and a separate maturity decision.

Proposed confidence targets for B: three clean full qualification runs, ten repetitions of selected
P0 identity/retry sequences and thirty of selected crash windows. These are future test plans, not
achieved reliability estimates. The three completed image-crash repeat runs are narrower evidence.

Do not estimate remaining work by subtracting unit-test counts. Re-estimate after R review and the
first installed-artifact journey; participant recruitment, account access, soak wall time and defect
repair are separate scheduling dependencies.

### Proposed performance targets, not measurements

Ratify hardware/workload first (suggested reference: Linux 4 vCPU, 8 GiB RAM, SSD, F1/F2).
Measure visible feedback ≤200 ms, ordinary management API p95 ≤500 ms, warm navigation p95 ≤1 s
and fake-stream boundary-to-render p95 ≤250 ms as initial targets. Report provider latency separately.
LCP ≤2.5 s / INP ≤200 ms / CLS ≤0.1 are field-p75 reference thresholds, not an achieved Lighthouse
or accessibility claim. Require zero test-owned resources after confirmed cleanup; investigate
sustained growth or unexplained RSS >20% over the warmed baseline. A 1 GiB Results limit is not a
whole-home size limit, and deletion does not imply SQLite immediately shrinks on disk.

## 7. Commands and automation boundaries

Run existing commands from the repository root; preserve exit codes and run build-writing lanes
sequentially rather than against the same `dist/` tree concurrently:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm security:acceptance
pnpm build
node scripts/migration-upgrade-matrix.mjs
pnpm tsx scripts/check-image-generation-ui.mjs
pnpm vitest run apps/cli/test/image-crash.test.ts
BAZILION_TEST_DOCKER=1 BAZILION_TEST_DOCKER_IMAGE=debian:bookworm-slim \
  pnpm vitest run apps/cli/test/image-generation.test.ts \
  apps/daemon/test/runtime/coding-recovery.integration.test.ts \
  apps/daemon/test/runtime/shell-docker.integration.test.ts
```

Docker and Chromium prerequisites must be installed deliberately. The Docker command does not
exercise a protected scheduler/Telegram image origin. The installer smoke takes an actual packed
CLI path: `node scripts/installer-e2e.mjs <tarball>`. Public installer/Node provisioning is separate.
`pnpm changeset status` inspects the plan; it is not authorization to run versioning or publishing.

Existing PR workflows cover Node 24 type/test/build/pack, packed installers, source upgrades and
security. They do not automatically establish the manual browser/Docker/human/live lanes. The
main-branch release workflow has a narrower gate set. Required repository rules must be verified,
not assumed. A proposed dedicated Playwright/soak acceptance project is not implemented or CI-wired.

## 8. Go/no-go

**R Go** requires agreed release cases completed at their named layers, current reviewed-candidate
CI/artifact evidence, all advertised live selections qualified, operator-facing recovery checked,
and explicit decisions on private-output loss and lint debt. No unresolved critical/high-severity
safety or core-task defect may be hidden by a scope exception. Release notes and website must match
the observed platform, billing, retention and support limits. Obtain authorization before merging
the version PR that can cause automatic publishing.

**B Go** additionally requires the broader catalogue's agreed configurations, independent usability
and accessibility outcomes, BAZ-063 core acceptance, populated recovery, the planned endurance
evidence and reviewed live integration coverage. Report conditional publication separately; missing
connectors do not block the manual core. Neither a green R gate nor completion of these documents
grants a 1.0 release.

If evidence is missing, record Blocked/Not run. If behavior is unacceptable, record Failed and fix it.
If a supported contract is intentionally narrowed, get explicit approval and update all claims before
retesting. Do not silently convert any of these into Passed.
