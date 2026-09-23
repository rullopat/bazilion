# BAZ-059 local implementation evidence

**2026-09-19 — working-tree candidate, not a published release.** Target: **0.22.0**.
[Story](in_progress/BAZ-059-pi-image-generation.md) · [Operator guide](../image-generation.md) ·
[Scope freeze and validation](../testing/0.22.0-freeze.md)

Feature scope is frozen. Local validation has advanced; live qualification and release review remain
open. No product implementation changes were made in the freeze-validation pass.

## Implemented

- One `image_generate` tool; two Pi/OpenRouter selections plus direct OpenAI API-key and ChatGPT/Codex
  login selections. Images stay off by default. Automatic mode (unset/`auto`) follows enabled OpenAI
  text providers, using the Agent's own route where applicable; otherwise the sole enabled option.
  Dual enablement without an OpenAI-family Agent requires an explicit choice. Stored credentials and
  failures never select another billing route. Web and CLI share automatic/manual choices/status.
- Daemon-owned generation through Pi's public image collection API (OpenRouter) or bounded direct
  OpenAI Images / Codex Responses adapters. Closed turn/source-bound IPC,
  canonical transcript argument matching, live ownership checks, restricted-worker refusal and no
  model/credential/endpoint arguments. Enabled image turns omit unselected OpenAI/OpenRouter keys from
  new configured worker/MCP environments; selected chat credentials and legacy host trust remain distinct.
- Durable intent before dispatch, no SDK retry, per-turn/home/deadline/response bounds, and uncertainty
  that blocks further image calls in that turn. Completion commits atomically with captured image bytes.
- Existing Results storage and authorizer, with multiple ordinals on the original tool-call identity.
  Persistent reference-only transcript details, image preview/download and original-version retention.
  CLI automatic delivery preserves pre-existing local files instead of overwriting them.
- Additive migration `0004_image_generation.sql`; released migration files remain unchanged.

## Executed checks

| Check | Result / scope |
| --- | --- |
| `pnpm typecheck` | Passed root and web checks. |
| `pnpm test` | **1,927 passed; 11 skipped.** 238 passed / 3 skipped files. The ordinary platform skips remain; the new real-turn CLI test is Linux-only. |
| `pnpm security:acceptance` | **173 required cases passed**, including twenty image boundary cases. |
| Changed-file Biome check | No errors; existing warnings in touched files remain. |
| `pnpm lint` | **Not clean:** 14 existing errors, all in untouched files; mostly formatting/import organization. Not represented as a passing gate. |
| `pnpm build` | Passed web, packages and CLI/daemon/worker bundles. |
| Packed CLI installer E2E | Passed on Linux, including fresh bootstrap, one-shot chat and coding-command smoke. Package versions deliberately remain beta.5 until the version PR; this local tarball was not published. |
| `node scripts/migration-upgrade-matrix.mjs` | Source-worktree sentinel upgrades from **all five 0.21 betas and v0.20.0** passed; **v0.19.0 refusal** passed. Second boot checked. First attempt was blocked by a missing local beta.5 tag; fetched that published tag and reran successfully. This is not a populated installed-home qualification. |
| `pnpm tsx scripts/check-image-generation-ui.mjs` | Chromium configuration/Results projection smoke passed at **1280×1000 and 390×844**; keyboard Save, selected-model persistence, web/CLI status agreement for all three credential routes, labelled API-key/login choices, Automatic switching through text enablement, dual-provider ambiguity, route-specific Result cards, preview, exact downloaded bytes, private-result refusal and no horizontal overflow/page errors. Synthetic images only. Latest artifacts: `/tmp/baz059-ui-SofQXM/`. |
| Real Docker lane | Six tests across three files passed with the existing local `debian:bookworm-slim`. Six configured-operator image turns include container execution, no image keys in the container and downloads surviving daemon restart. Fake providers; not a protected scheduler/Telegram turn. |
| Real image crash/restart | Two actual `SIGKILL` barriers passed, plus three consecutive targeted repeat runs. Independent fake upstream; no automatic resend or private disclosure. Captured-but-never-authorized bytes are reclaimed on restart, not recoverably delivered. |
| Prerelease rehearsal | Current state would produce beta.6 on the old minor. An isolated manifest/state transition and actual Changesets version execution produced exactly **0.22.0**; repository versions unchanged. |

Latest command logs are `/tmp/baz059-freeze-{typecheck,full,security,build,installer,upgrade,ui,docker,crash}.log`.
The unchanged whole-repository lint failures are recorded in `/tmp/baz059-freeze-lint.json`.
They are local development artifacts, not a durable release evidence archive. The freeze record
also records the initial image-journey timeout and corrected test-fixture assumptions; it does not
present every development run as green.

## What the deterministic tests actually prove

- `apps/daemon/test/lib/image-generation.test.ts` drives both curated entries through Pi's **real
  adapter with a fake HTTP transport**, checking the fixed endpoint, explicit key, actual modality
  payload and disabled retries. Separate cases exercise source/model/input refusals, raw-body growth,
  malformed/empty/multiple outputs, cancellation/deadline, concurrency/call caps, atomic storage
  rollback, provider-error/response-ID credential suppression, deletion and backup/reopen.
- The same file checks allowed, denied and approval-held generated-file delivery using the shared
  authorizer. Tool results contain references, never inline image bytes that would bypass that gate.
  Existing Results delivery tests continue covering approval dispatch, background delivery and Telegram.
- `apps/daemon/test/lib/image-transports.test.ts` checks fixed endpoints, explicit bearer selection,
  exact request payloads, no 401 fallback/retry, no external image URL downloads, and Codex terminal
  completion, omitted item metadata, malformed/failed/incomplete/truncated/duplicate streams, final
  state precedence, event/byte bounds and numeric usage without inventing a monetary cost.
- Host tests additionally cover encrypted OAuth token loading, route-specific private provenance,
  response-ID secret suppression, replay after route changes, logout, refresh-supplier failure and
  cancellation while a shared refresh is pending (late completion cannot dispatch an image request).
- `apps/cli/test/image-generation.test.ts` runs real one-shot Agent turns against a deterministic
  local chat provider. A **test-only preload** intercepts all three fixed image endpoints; production
  has no endpoint override/test switch. Six turns cover OpenRouter generation/rework, direct API-key
  generation, stored OAuth generation and automatic API-key→Codex switching through text-provider
  enablement, via tool → IPC → daemon → adapter → Results → CLI/history.
  Tests check route labels, absent credential leakage, exact downloads, preserving an existing local
  file, disabling the tool and downloading all six released images after a real daemon restart.
  With `BAZILION_TEST_DOCKER=1`, every image turn also executes a container command and verifies its
  Docker receipt and lack of OpenAI/OpenRouter keys inside that container.
  The same pipeline uses actual daemon credential storage/loading,
  but synthetic credentials and HTTP replies: **no live model or OAuth refresh endpoint is called**.
- `apps/cli/test/image-crash.test.ts` kills the real daemon after the independent fake provider
  receives a request, and separately after atomic capture but before the worker's IPC acknowledgement.
  Restart preserves uncertain intent without replay. For completed private captures, existing cleanup
  retains the operation/tombstone but reclaims never-authorized bytes: **a paid output could be lost
  in that window**. This is not recoverable-delivery evidence. Released Results survive separately.
- `apps/daemon/test/routes/image-config.test.ts` covers closed settings, truthful readiness, no
  image-only first-run completion, independent API-key/OAuth readiness and refusal to curate image
  entries as chat models.
- Automatic-mode tests cover credentials without text enablement, both enabled providers with/without
  an OpenAI-family Agent, disabled Agent providers, missing selected credentials, manual overrides
  and the separate image opt-in. Host tests preserve the admitted route across an in-flight toggle,
  refuse enablement drift during OAuth refresh and block uncertain work even after another text
  provider becomes enabled. Receipts/Results store the resolved route, not `auto`.
- `apps/daemon/test/runtime/worker-runtime.test.ts` covers protected tool projection and rejection of
  input/host injection into all restricted worker kinds. This is **not** a real Docker image turn.
- `apps/daemon/test/core/db/migrations.test.ts` additionally upgrades a canonical beta.5-schema
  fixture containing released bytes and deletion tombstones, verifying their preservation and the
  pre-migration snapshot. Backup tests verify immutable bytes and uncertain receipts after reopening.

## Remaining qualification / release work

1. **Not run:** authorized, spending/usage-bounded live generation for each of the four advertised
   selections (both OpenRouter models, direct OpenAI API key and ChatGPT/Codex login).
   Catalogue presence and fake transport do not establish account entitlement, actual price, quality,
   latency or current upstream availability. Obtain credentials/budget before these calls.
2. **Not observed:** live-provider commit/ACK behavior, protected-origin image execution and a full
   live conversational/browser generation/rework journey. Actual SIGKILL/restart and configured-operator
   Docker image turns now have deterministic-provider evidence, not live-provider qualification.
   Review and explicitly retain or address the abandoned-private-output limitation above.
3. The browser smoke is not an independent usability study, assistive-technology audit, real-mobile or
   multi-browser qualification. The broader [beta campaign](../testing/beta-readiness/README.md) remains.
4. Review the implementation and explicitly disposition existing lint debt; obtain PR CI. Apply the
   rehearsed Changesets transition deliberately in the reviewed version PR. The unchanged working tree
   still plans `0.21.0-beta.6`; do not merge that automatic version as the intended 0.22 release.
5. No package version, npm tag, release, production configuration or website deployment was changed.
   Native social publication, editorial approval packets and direct Google image access remain out of scope.

## Direct-route protocol research

The operator expanded the initial Pi-only implementation to include both OpenAI authentication
choices. Public documentation/source were fetched without credentials or generation requests:

- [OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation): public Images
  API, API-key authorization, base64 output and explicit output format.
- OpenClaw commit `e1b8056605a912d45ef3329b3a70a3de81c973ed`,
  [`image-generation-provider.ts`](https://github.com/openclaw/openclaw/blob/e1b8056605a912d45ef3329b3a70a3de81c973ed/extensions/openai/image-generation-provider.ts)
  and its Codex response parser/tests: separate OAuth Responses transport, image tool selection,
  pinned orchestrator, SSE terminal event and optional item metadata. This source is protocol
  evidence, not live entitlement or an official stability guarantee for the subscription endpoint.
