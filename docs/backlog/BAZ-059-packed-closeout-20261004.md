# BAZ-059 — autonomous offline/package closeout (2026-10-04)

## Disposition

The operator asked to finish the story autonomously. Completed the outstanding **current Linux
installed-package/UI gate**, deterministic Docker image journey, final source gates and independent
bounded package-evidence review. No product repair was needed, no paid/provider calls or new image
generation occurred against the operator account. Story stays **in_progress / live qualification
blocked**, not falsely done: required other advertised live routes still need named credentials,
account-side budgets and bounded authorization. Existing accepted live image remains unchanged.

The scope clarification stands: exact dimensions/quality controls are excluded; retain actual
1374×1145 versus requested 1024×1024 as a limitation, without automatic resize/regeneration.
Broader Content Team/independent-user/release gates are separate stories, not invented BAZ-059
implementation tasks. No version/commit/tag/npm publish/deploy action was performed.

## Current artifact and installer

Built current source with `pnpm --filter bazilion build` and packed the CLI locally. The artifact
retains the existing **0.22.0** package label; **not** a published 0.23.0 release or version transition.
Installed outside the workspace via `npm install --offline --ignore-scripts --no-audit --no-fund`
into a disposable prefix; no registry access for that installation. System Chromium was selected
explicitly for the browser harness, not downloaded/installed through a package script.

- Artifact: `/tmp/baz059-packed-F9m3G0/bazilion-0.22.0.tgz`.
- SHA-256: `ad5104e0f577ded41dcc899a4435d46e4605b67c4ab96177eaf264200007b6e9`.
- Fresh current **Linux installer E2E passed**, including installed SSR login outside workspace,
  bootstrap/config, ordinary-search readiness, browser executable diagnostics without launch,
  Pi MCP fixture round-trip, deterministic chat/coding command and test-home uninstall.
- No macOS/Windows/platform CI claim; Agent execution remains Linux-only. Installer credentials and
  homes are synthetic/disposable, not operator credentials/home. Dependency installation is distinct
  from provider inference and is not a claim that the entire install process made no network calls.

## Nine installed image journey checks

`/tmp/baz059-packed-F9m3G0/check-images.mjs` runs the **installed** CLI, daemon, worker, Pi and web
with test-only interceptors, synthetic credentials and loopback parent-model HTTP fixture:

1. Installed SSR login renders and device bearer exchanges for normal browser session.
2. Web image enable/selection saves agree with installed CLI status. Zero **image-generation** calls
   during configuration/readiness; six local fixture model-discovery GETs separately counted.
3. Five real Agent turns through the browser: Codex explicit-empty terminal; Codex omitted terminal
   rework; direct API; OpenRouter Gemini; OpenRouter GPT Image. Both Codex fixtures omit MIME and
   supply complete lifecycle-bound image snapshots. Exact selected route/model handling exercised.
4. Persisted canonical Pi tool results have five opaque Results; only the two fresh Codex responses
   carry `completed_stream` facts. No inline PNG bytes in those tool results.
5. Chat cards/history survive reload, desktop **1280×960** and narrow **390×844**, no horizontal overflow.
6. Team Results preview loads; desktop/mobile downloaded bytes match stored SHA-256.
7. Disable through web agrees with installed CLI.
8. Five separate saved Result IDs/filenames survive daemon restart with byte-exact downloads and
   no regeneration. The second version does not overwrite the first.
9. Exactly five image fixture calls and ten parent rounds; zero page errors/external browser
   requests. Fixture process/daemon/web/browser cleaned up and test Agent archived.

**Important limits:** all five upstream fixture images are the same tiny synthetic PNG. Separate
versions prove routing/durability, not effective visual rework. Model GETs are local fixtures, not
zero all-provider traffic. Chromium request interception prevents external browser requests; this
is not a live provider or independent usability/assistive-tech/multi-browser study. The transient
harness is retained with screenshots/results, not claimed as a new permanent CI gate.

## Retained first failures

These were harness mistakes, not hidden product failures:

- Missing explicit LMStudio text enablement prevented setup completion before any image request.
- Nested summary selector was ambiguous; selected the outer summary explicitly.
- After eight checks passed, six `/v1/models` GETs had reached the fixture handler that assumed JSON
  POST; final fixture-error assertion failed. Added a counted GET response, not a fake ignored error
  or product workaround. Corrected fixture run passed all nine checks.

Each failed attempt's result/log is retained under `initial-fixture-failure/`,
`selector-fixture-failure/` and `model-fixture-failure/`, with disposable homes left separate.
Only synthetic service calls occurred; no authorization/usage from operator trial was replayed.

## Container and final source evidence

Local Docker context is Unix socket `/var/run/docker.sock`; cached `debian:bookworm-slim`, image
`sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a`, no declared volumes.
No pull, machine configuration or remote Docker endpoint used. Initial inspect format referenced a
missing Volumes field and failed; corrected safe index inspection returned null, log retained.

`BAZILION_TEST_DOCKER=1` on the existing real CLI image journey **passed**: six turns, container
coding probe checks `/workspace` and absent OpenAI/OpenRouter shell credentials, synthetic image
routes, rework/config toggles, file capture and restart. **Source-tree configured-operator Docker
mode**, not a packed Docker test or a real protected-origin live image sample. It strengthens only
the stated deterministic container slice; do not substitute it for remaining live posture evidence.

Final whole-source validation after the six DST matcher tests added in the preceding step:

- **2,538 full passes / 47 skips**, 276 files passed / seven skipped.
- **336 required security cases passed**, root/web types passed.
- Source diff whitespace check passed. No new whole-tree lint clean or PR CI/platform run claimed.
- Scoped source/earlier package warnings remain separately recorded; this pass did not hide/fix
  unrelated lint debt or modify daemon production code.

The owned idle operator daemon was stopped gracefully only for full/security fixture port ownership,
then restored with same home/environment. Current owned daemon **PID 1135544**. No operator Agent
turn or provider call here; images/scheduler/browser remain off and original account is preserved.

## Independent bounded evidence review

Isolated read-only reviewer accepted the **reported installed-package gate as bounded offline
mechanics evidence**, with limits. It inspected harness/fixture/result/installer/Docker logs, not
actual tarball contents or an independent execution; it explicitly retained synthetic bytes,
local model-discovery, source-tree Docker and no-live/no-release qualifications. Reviewer inference
was remote; no home/env/auth/application execution or provider/browser/research access.

- Review: `/tmp/baz059-packed-F9m3G0/review/review.md`, SHA-256
  `b436ec29f46c5c82cb199f54332a59ceede32d7ccb05b70b7a5db3b4bf90db1a`.
- Current candidate manifest: `/tmp/baz059-packed-F9m3G0/candidate.sha256`, SHA-256
  `af83bc548e3688a4fa98a4ccd41c6741a9aa8f2eeb5a9320bfb591374374d45c`.
- Build/install/installer/UI/source/security/types/Docker logs, screenshots, safe result records
  and exact tarball retained in that private temporary directory; source manifest checked after.

## What remains to finish BAZ-059

1. **Test 9: three remaining paid live selections** — direct OpenAI GPT Image 2; OpenRouter Gemini
   3.1 Flash Image; OpenRouter GPT Image 2. Need explicitly named credentials/accounts, account-side
   spend controls and bounded authorization. Request count is not a hard dollar ceiling. No stored
   operator secrets were inspected to guess whether such credentials exist.
2. Remaining **live rework/protected-origin configuration evidence** under the qualification plan;
   needs separately bounded scope, not repeated regeneration of the accepted image without approval.
3. Preserve human inspection for new live outputs. Operator acceptance of the successful subscription
   deliverable already counts for that image; broader independent-user Content Team acceptance belongs
   to live qualification. Keep story versus release/other-story requirements separate.

No coding blocker or required resize task was invented to postpone closure. No live approval or
budget waiver was inferred from “finish on your own”. **Implementation/offline acceptance is ready;
required live qualification is not complete.** If the operator chooses to narrow advertised routes
or defer qualification, that is an explicit product/scope decision, not one made silently here.
