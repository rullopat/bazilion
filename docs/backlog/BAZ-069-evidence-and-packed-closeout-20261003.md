# BAZ-069 — independent evidence acceptance and current Linux package/UI checks

## Disposition (2026-10-03)

**The revised T18(b) source journey is independently accepted. Current Linux packed-install,
CLI/web and offline composed-research checks pass after a packaging repair.** The operator
accepted the changes and story close-out on **2026-10-03**; T18 and
[BAZ-069](done/BAZ-069-browser-backed-default-web-search.md) are complete. Release and publication
are separate decisions. No further live research was performed or authorized.

The official API-key route remains explicitly **experimental/unqualified**. The subscription
observation does not qualify that transport/billing route or every account/model. A separate
bounded live authorization is required only if qualifying/advertising that route is desired.
Configuration readiness still does not prove execution or silently promote a route to qualified.

## Independent acceptance of the real source attempt

The reviewer received an isolated read-only bundle from the
[12:20 UTC successful attempt](BAZ-069-native-t18b-post-accumulator-trial-20261003.md): retained
prompt, calls/receipts, public fetched source text, final answer, selected canonical session
messages, preparation/settlement records and the previous accumulator code review. Reasoning and
private metadata were omitted; no credential or account identifier was exported. Research/network
tools and application imports were disabled. Reviewer inference itself was remote, not zero-network.

**Verdict: accept the revised SOURCE-CANDIDATE T18(b) journey; no blocking finding.** Independent
offline comparisons confirmed:

- Prompt and all six call IDs/arguments/order, complete search receipt, five source receipts/texts
  and final answer agree with the selected canonical messages.
- One actual hosted-search ID and `outputSource: completed_stream`, with the selected backend/model
  and usage. Admitted accumulator semantics remain grounded in the earlier independent code review.
- Five discovery URLs were fetched directly from NASA, with matching effective URLs, HTTP 200,
  cache miss and no truncation. All four final cited URLs were actually read. Source text supports
  crew, purpose, launch and confirmed splashdown; planned events are distinguished from outcomes.
- 81.830 seconds, one search, six tools, seven parent responses and 67,589 parent tokens. Retained
  counters show one `done`, clean EOF and no error/fatal/cancellation; no visible retry/fallback.
- Preparation/settlement records support the admitted subscription/medium posture, archived Agent,
  disabled browser/no profile and no MCP. Cleanup is retained observation, not a new remote audit.

Limits remain explicit: observed cache/network mode is unknown; raw upstream bodies/headers,
exact successful terminal label/MIME, complete raw frames and original transcript bytes were not
supplied. The reviewer cannot reconstruct transport validation or authenticate the original
transcript digest. The generic mission-page extract is not detailed timeline evidence. This is
neither a second live attempt nor independent proof of general entitlement.

Review: `/tmp/baz069-live-evidence-review-DM6lPc/review.md`, SHA-256
`3cbb1caf7e2c9c2643e1ab77072fde90456f5a82e084713c39dce0af025cc310`.

## Fresh package and the failure it exposed

Built the dirty source candidate, packed CLI version **0.22.0**, and installed into disposable npm
prefixes outside the workspace. This is a local qualification artifact, not a version bump or
release. Operator `/home/patri/.bazilion` and its connected account were not used by these fixtures.

The first tarball (`0756538882fc9894758ee164bc561554a4b119237467d48cd63b7d516a68b310`)
passed the old CLI installer smoke but **failed installed `/login` with HTTP 500**: the web SSR
bundle imported `clsx`, absent from the published package dependencies. Inspection of emitted
static/dynamic imports found six missing direct runtime dependencies, not a native-search defect.

The bounded repair:

- `apps/cli/package.json`: declare the already-used web SSR dependencies `@xyflow/react`,
  `class-variance-authority`, `clsx`, `marked`, `radix-ui` and `tailwind-merge`; align the explicit
  TanStack router version with the web app's **1.170.18**. Update `pnpm-lock.yaml` accordingly.
- `apps/cli/test/published-dependencies.test.ts`: assert the known external web SSR runtime
  dependencies match the web manifest, alongside the existing Pi-family pin check.
- `scripts/installer-e2e.mjs`: start the installed web server against the disposable daemon and
  require actual login SSR HTTP 200/branding, then retire it. A listening socket alone is not a pass.

The **new permanent installer check fails the original tarball at HTTP 500** and passes the rebuilt
one. The initial failure is retained, not masked by installing undeclared modules into the old
package. Only these four source/manifest/test files changed during this close-out; native
production/wire/worker/browser files remain identical to the accepted source candidate. The
lockfile change adds existing web dependencies and removes the unused older router resolution.
An offline lockfile update could not resolve cached optional peer metadata; normal registry
resolution completed. That was package maintenance, not provider observation.

**Rebuilt, installed, tested tarball:** `/tmp/baz069-closeout-packed-qMqZrU/bazilion-0.22.0.tgz`

- SHA-256: `0d62b50423d46aee883a9bba3d7d919bd0c0bbcc520f3a46c8cfe3ceaa4a106f`.
- `repaired-source.sha256` in the same directory records source/dependency/test inputs; manifest
  SHA-256: `4284dfbd8dd09d33dedcf75b1527e88f144726b13d6b9997fb4ec03057ce3639`.
- The original tarball/failure records remain under `initial-failure/`. This new artifact does not
  recreate the missing historical reviewed package/freeze.

## Installed CLI/web and composed fixture evidence

Standard installer E2E passed on Linux: isolated global-prefix installation, bootstrap, CLI
provider/model configuration and Agent creation; ordinary search readiness/disablement; actual
web login SSR; browser configuration diagnostics (no browser launch); Pi MCP discovery/worker
round-trip; deterministic chat and Linux coding-command execution; shutdown and uninstall.

A second disposable installed home used **synthetic OAuth credentials** and test-only transport
fixtures. No operator credential was copied/imported. Native/parent provider requests, source
text and NASA DNS were fixtures; non-loopback socket/TLS attempts were refused. A headless test
browser exercised only the local installed UI, with non-local application requests blocked.
This is UI automation, not Bazilion managed-browser qualification or a new public-site visit.

**Ten automated checks passed** (`ui-result.json`, 12:58:26–12:58:37 UTC):

1. Installed CLI/API subscription-readiness reports agree.
2. Web Agent readiness matches CLI and labels configuration, limits, account/model and uncertainty.
3. Mobile Agent settings have no horizontal overflow.
4. Web cached/live mode edits are reflected in CLI/API and Agent readiness.
5. Web search disablement matches CLI and Agent readiness.
6. An explicitly mismatched API route reports unavailable, not account fallback.
7. All status/config interactions caused **zero** fixture provider/source calls.
8. Actual installed daemon/worker/Pi IPC completed one fixture `web_search` → one guarded fixture
   `web_fetch` → cited final answer. Native SSE omitted MIME and ended with explicit empty output;
   canonical receipt records `completed_stream`. Three parent responses, no retry/fallback.
9. Reloaded web transcript retained discovery provenance, source text/effective URL and cited
   answer. Desktop/mobile screenshots and overflow checks were collected.
10. No browser page errors; no external browser application requests were observed.

The fixture Agent was archived; installed daemon/web/browser processes stopped. Retained receipt
origins and source bytes were checked, but fixture receipts are **not real NASA/provider evidence**.
Only the independently accepted source attempt above supplies that evidence. Screenshot inspection
by the implementing assistant is not final human/operator acceptance. No macOS/Windows, additional
browser-engine or live API-key qualification is claimed.

## Final regression and operator-state checks

- Full suite: **2,365 passed / 47 skipped**, 272 files passed / seven skipped; bounded concurrency.
- Security acceptance: **324 required adversarial cases passed**.
- Root and web typechecks: exit 0.
- Published-dependency tests: **2 passed**.
- Scoped Biome for the three changed code/manifest files: clean; `git diff --check` passed.
  No new whole-tree lint claim.
- The owned idle source daemon was gracefully stopped only for full/security tests to avoid the
  known port-4321 fixture conflict, then restarted with the same home and scrubbed environment.
  No reset, credential import/logout, OAuth refresh trial or new research turn. No worker children
  remained. Current control PID is recorded beside the validation artifacts and in the earlier
  accumulator control directory; operator connection remains preserved.

Build/install/UI/regression logs, fixtures, screenshots and manifests are in
`/tmp/baz069-closeout-packed-qMqZrU/`. These temporary artifacts are not a published release archive.

## Operator acceptance — 2026-10-03

The operator stated: “I accept the changes, if nothing else needs to be done, we can considered
BAZ-069 moved to done”. With the documented evidence, regression and current package/UI gates
complete, this closes the remaining acceptance gate. T18 is checked and the story moved to `done/`.
This records acceptance of the supplied evidence and changes, not a newly observed hands-on UI run.

The official API-key route remains experimental/unqualified; no extra live smoke is required to
close this explicitly limited scope. Historical failures and optional-browser limitations remain
unchanged. No repeat subscription trial or new browser-search qualification is needed. Release,
publication and any additional live call still require separate approval.
