# Current beta evidence and open decisions

**Assessment rewritten 2026-09-20 for `0.22.0`. Decision: HOLD.**
This replaces the pre-implementation audit. It describes the current candidate, not a historical
beta.5 test inventory. Recorded executions below are from the 2026-09-19 freeze-validation pass;
rewriting this document is not another test execution.

## Candidate and evidence identity

- Published baseline and current package labels: `0.21.0-beta.5`.
- Candidate: base `f453930c54df46a22cefdcc9f8cf859af7cb047d` plus uncommitted BAZ-059 changes.
- Scoped source/configuration fingerprint:
  `08035c475d3ca7b2ccce8eb92ac8fe568ca357be0fecbef0c23de423a6d23f98` — updated 2026-09-21 for the
deliberate worker-exit defect fix (found by the BAZ-064 harness), BAZ-067's bounded protected
discovery, and the Pi 0.87.1 engine refresh; see
[the acceptance record](../../backlog/BAZ-064-acceptance.md).
  The [freeze record](../0.22.0-freeze.md) defines its 526-file scope; it is not a full build
  dependency closure, artifact hash or proof that code works.
- Execution host: Linux, Node 26.7.0, pnpm 11.14.0; real Docker 29.7.2 using an existing local image.
  Node 24 and other-OS PR results must be recorded separately for the reviewed candidate.
- Logs, JSON reports and screenshots are local temporary artifacts. Archive reviewed, redacted
  evidence before release; absence of a temporary artifact later requires a rerun or a durable copy.

[Plan](README.md) · [Scenario catalogue](scenario-catalog.md) ·
[UX protocol](usability-protocol.md) · [Implementation acceptance](../../backlog/BAZ-059-acceptance.md)

## 1. Recorded executions

| Evidence | Outcome | What this establishes | What it does not establish |
| --- | --- | --- | --- |
| `pnpm typecheck` | Passed | Root and web TypeScript checks. | Runtime/provider correctness. |
| `pnpm test` | 1,927 passed, 11 skipped; 238 passed / 3 skipped files | Latest full local regression result. | Every supported platform, scenario family or live integration. |
| `pnpm security:acceptance` | 173 required cases passed; 20 owned by BAZ-059 | Named deterministic cases collected/executed successfully. | Comprehensive security certification or protection against an unreviewed manifest deletion. |
| Changed-file Biome | No errors; warnings/infos remain | Touched-file formatting/lint result. | Whole-tree lint success. |
| Whole-repository Biome | 14 errors in 12 untouched files | Existing formatting/import debt remains observable. | An approved waiver; release review still has to decide. |
| `pnpm build` | Passed | Web, packages and CLI/daemon/worker bundles build. | Installation or live use on all supported machines. |
| Packed CLI installer | Passed on Linux | Local tarball install, bootstrap, chat/coding smoke and uninstall. | Public `install.sh`/`install.ps1`, Node provisioning, shell discovery or final 0.22 package. |
| Source-worktree upgrade matrix | All five 0.21 betas and v0.20.0 upgraded; v0.19.0 refused | Sentinel preservation, ledger behavior, second boot and refusal boundary. | Populated homes built with installed artifacts, complete data/secret/result recovery or downgrades. |
| Chromium image projection | Passed at 1280×1000 and 390×844 | Configuration/save/reload, Automatic routing states, route labels, Result preview/download and private refusal with synthetic data. | A live browser generation, visual quality, accessibility, other browsers or human comprehension. |
| Docker image/recovery lane | Six tests across three files passed | Actual configured-operator Docker commands alongside six synthetic image turns, container key absence and released downloads after restart. | Protected scheduler/Telegram image execution or a live-provider request. |
| Image SIGKILL lane | Both barriers passed; three consecutive targeted repeat runs also passed | Real daemon death/restart with independent fake upstream counter; uncertain intent and committed private capture semantics. | Every crash window, backend charge reversal, live-provider ACK behavior or recoverable private delivery. |
| Changesets rehearsal | Exact 0.22.0 generated for all three public packages in scratch | A tested transition recipe with actual local version execution. | Applied repository versioning, GitHub changelog generation, npm tags or publish authorization. |

Main logs: `/tmp/baz059-freeze-{typecheck,full,security,build,installer,upgrade,ui,docker,crash}.log`.
Additional evidence: `/tmp/baz059-freeze-lint.json`, `/tmp/baz059-freeze-changed-lint.log`,
`/tmp/baz059-freeze-crash-repeat-{1,2,3}.log`, `/tmp/baz059-ui-SofQXM/`.

The full regression initially timed out at the expanded image journey's old 30-second budget while
other validation lanes contended for the host. The journey now has a 60-second test budget; product
deadlines are unchanged. The subsequent full run passed. See
`/tmp/baz059-freeze-full-initial-timeout.log`. The Docker cleanup-row assumption and IPC barrier hook
also needed test-fixture corrections. These facts are not erased by the final passing results.

## 2. Image evidence mapped to its implementation

| Source | Observed boundary |
| --- | --- |
| `apps/daemon/test/lib/image-generation.test.ts` | Real Pi adapter with fake transport; admission/source binding; ownership, limits, cancellation, atomic capture/rollback, replay, private policy delivery, OAuth loading and Automatic drift. Backup/reopen coverage is component-level. |
| `apps/daemon/test/lib/image-transports.test.ts` | Fixed endpoints, route-specific auth/body, bounded bodies/events, Codex terminal parsing, no URL download, no retry/fallback, numeric usage and routing cases. |
| `apps/daemon/test/routes/image-config.test.ts` | Shared settings/readiness, separate opt-in, enablement-only switching, explicit overrides and no image-only setup completion. |
| `apps/daemon/test/runtime/worker-runtime.test.ts` | Protected tool projection and restricted-kind injection rejection. Not an observed protected-origin image turn. |
| `apps/daemon/test/core/db/migrations.test.ts` | Canonical beta.5-schema fixture containing released bytes/tombstones upgrades; pre-migration snapshot preservation. Not a lived-in installed-home migration. |
| `apps/cli/test/image-generation.test.ts` | Six real Agent/worker/daemon turns with synthetic HTTP; OpenRouter rework, explicit API/OAuth, Automatic API→Codex; exact downloads/no overwrite, disablement and released images after restart. Optional Docker branch actually executes containers. |
| `apps/cli/test/image-crash.test.ts` | Request received before provider reply, and capture committed before worker IPC reply; actual SIGKILL and same-home reboot without reseeding. |
| `scripts/check-image-generation-ui.mjs` | Production web/daemon Chromium configuration and Results projections. No live model image generation. |

The synthetic transports establish neither live account entitlement nor upstream compatibility.
The two OpenRouter selections need separate live samples even though they share an adapter. The
Codex route requests `gpt-image-2` through a pinned `gpt-6-astra` orchestrator; public-source protocol
research is not an official stability promise or an independent backend-model attestation.

## 3. Open release decisions and missing evidence

### G01 — Abandoned private output can be lost (confirmed behavior; decision pending)

At the post-capture/pre-worker-ACK barrier, completion and bytes survive the kill atomically and
remain private. On boot, existing Results cleanup reclaims the abandoned, never-authorized bytes.
The operation/tombstone survives; preview is denied and generation is not replayed. A real provider
could already have charged for an output the operator cannot recover.

This satisfies the tested no-replay/disclosure contract, **not a guarantee of recoverable delivery**.
The operator/reviewer must explicitly accept the visible limitation or require a targeted fix and
new qualification. The default must not be to release private content just to make recovery appear
successful. Already-authorized Results have separate byte-for-byte restart evidence.

### G02 — Advertised live selections (blocked on authorization)

None of the four selections has an authorized live image sample in this candidate record. Obtain
account/route access, attempt limits and spending/usage authorization before calls. Test actual
Codex entitlement first if it is the highest compatibility risk; never use API billing as fallback.
Record refusals and failures rather than retrying to make the matrix green. See IMG-13.

### G03 — Protected-origin and composed browser path (not run)

Configured-operator Docker is not a protected scheduler/Telegram invocation. Observe an actual
protected origin with image IPC, selected chat credentials and policy-controlled Results delivery.
Separately observe real browser generation/rework/restart. Projection smoke plus CLI turns is useful
coverage but does not establish their composition. See IMG-08/09/12/13 and the UX task cards.

### G04 — Lint, review and final artifact (open)

The 14 baseline lint errors are not new image failures, but the whole-tree gate is not green.
Choose separate cleanup or an explicit reviewed baseline-debt disposition. The implementation remains
uncommitted; attach current Node 24/platform CI, reviewed commit identity and final versioned tarball
checks before release. A locally built beta.5-labelled candidate is not the released 0.22 artifact.

### G05 — Prerelease automation plans the wrong target unless prepared (confirmed)

Unmodified Changesets currently plans `0.21.0-beta.6`. The scratch rehearsal seeds the fixed group
at unpublished `0.22.0-beta.0`, uses beta.5 as its initial-version baseline and keeps consumed
changesets, then produces beta.1. That preparation has not been applied. Coordinate the reviewed
version PR; do not publish beta.0 or allow automation to overwrite the intended transition.
[Release procedure](../../releases.md) describes the required checks.

### G06 — Core recovery UI needs direct observation (source-supported risks)

`RecoveryState.tsx` and `RouteStates.tsx` use the supplied boundary `reset` for Retry. That alone
does not prove a failed loader is fetched again. Reproduce failure → restored daemon → Retry and
assert a new request, final URL and correct content against the pinned Router version (UX-01).

Loader boundaries also do not establish async mutation handling. Inject pre-send failure,
commit-with-lost-ACK and failed follow-up refresh separately. Copy such as “nothing changed” must
agree with durable state; a committed mutation cannot be treated as a safely repeatable non-event
(UX-02). These are investigation targets, not newly reproduced product defects.

### G07 — Broader maturity evidence (not run as a composed campaign)

Populated installed-home upgrades/restore, actual public installers, isolated-volume ENOSPC,
independent usability, assistive technology, multiple real browsers/devices, measured performance
and 24/72-hour soaks remain open. Permission denial is not ENOSPC; seeded interrupted rows are not
a process kill; screenshot counts are not independent interaction scenarios. New image crash tests
do not retroactively qualify unrelated recovery domains.

The required B [content-Team journey](content-team-acceptance.md) is also Not run. BAZ-063 is the
parent checklist for BAZ-064 (recipe/deterministic handoff), BAZ-065 (actual cron/recovery) and BAZ-066
(live/human qualification). It requires a confirmed generic brief, specialist research/text/images,
human rework and approved manual handoff over two cycles, with two independently selected topics. Existing
image/scheduler tests are component evidence, not that journey. On 2026-09-20, the first importable
recipe and four management/policy checks passed ([BAZ-064 evidence](../../backlog/BAZ-064-acceptance.md));
50 related checks and root/web typechecks also passed. No composed CT pass follows from those checks.
Preflight confirms protected peer/scheduled source discovery is absent and blocked on
[BAZ-067](../../backlog/in_progress/BAZ-067-protected-web-discovery.md); cron still follows daemon-local time,
not a per-trigger timezone. Conditional social publication remains unsupported until its integration
and exact-approval boundary are implemented and qualified. No live execution occurred.

### G08 — Gate enforcement and documentation (review pending)

Source inspection shows PR jobs for Node 24 type/test/build/pack, packed installers, upgrades and
security. Manual image projection/Docker lanes are not automatically all required PR gates. The
main release workflow runs typecheck/test before build/publish, not the entire qualification set.
Repository rulesets/required checks have not been verified. A manifest protects the cases it names;
removing both a case and its entry still needs review.

The 0.22 website/release material is not yet synchronized or deployed. Review the final support and
limitations before writing public claims. No current full documentation parity audit is claimed.

## 4. Interpretation rules

A result belongs to its candidate, subcase, fixture and actual boundary. Do not promote a command
pass to a whole catalogue family, or transfer Node 26/Linux evidence to Node 24/other platforms.
All Agent turns remain Linux-only; desktop/phone clients connected to Linux are a different axis.

The correct next step is to close or explicitly decide the R gates in the [plan](README.md), not
add unrelated features or repeat broad summaries with stronger claims than their observations.
Broader B qualification remains a separate campaign and decision.

Method references: [Playwright practices](https://playwright.dev/docs/best-practices),
[accessibility testing](https://playwright.dev/docs/accessibility-testing),
[WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[TanStack data loading](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading),
[OWASP ASVS 5](https://github.com/OWASP/ASVS/tree/v5.0.0), and
[SQLite WAL](https://www.sqlite.org/wal.html). Use pinned installed versions when testing;
these references are methods, not certifications of Bazilion.
