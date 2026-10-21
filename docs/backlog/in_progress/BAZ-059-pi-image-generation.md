---
id: BAZ-059
title: Image generation with explicit OpenAI, ChatGPT and OpenRouter routes
status: in_progress
size: L
created: 2026-09-19
refined: 2026-09-19
target_release: 0.22.0 (shipped 2026-09-23); live qualification carried into 0.23.0 as its top story
---

# BAZ-059 — Image generation with explicit credential routes

**0.23.0 release-closeout update,2026-10-19:** [Fresh bounded historical evidence review and
corrections](../../testing/0.23.0-baz059-evidence-closeout-20261019.md) accept the revised ChatGPT live
gate with stated limits. The separate post-commit private-image retention/recovery/discard repair
is independently accepted. No new generation, full current artifact or release acceptance is claimed;
this story remains in progress until the remaining release gates and actual publication closeout.

[Current qualification matrix](../BAZ-059-qualification-status-20261004.md): the successful
subscription deliverable now has operator visual acceptance and independent bounded live-evidence
acceptance. Exact dimensions are excluded below, so the observed mismatch is retained as a limitation,
not a new resize task. Other live routes/postures/journeys and package/release gates remain open.

## Current scope decision — required ChatGPT-only live qualification

The operator approved reducing the required live scope: **“I'm fine reducing the scope.”**
[Decision/evidence/boundaries](../BAZ-059-chatgpt-only-live-scope-20261004.md).
Required ChatGPT generation/rework/protected HTTP samples and operator inspections are satisfied.
Direct OpenAI and both OpenRouter selections remain implemented/offline-tested but live-unqualified;
optional live qualification deferred, not a blocker. No implementation change or further calls.
Story remains in progress for release closeout; the rest of the original 0.23.0 slate is unchanged.

## Earlier checkpoint — live rework/protected HTTP, 2026-10-04, 16:10 UTC

[Two subscription slices succeeded](../BAZ-059-rework-and-protected-trials-20261004.md): live
same-conversation regeneration preserves original; actual protected HTTP worker saves/reloads image.
One dispatch each, clean done/no retry, canonical completed-stream facts. Operator visual acceptance of both outputs
recorded (“both images looks great”); authorizations exhausted. Images off/account preserved. Three paid selections remain
unqualified; scheduled/inbox acceptance is separate, not passed by the protected HTTP sample.

## Earlier checkpoint — offline/package closeout, 2026-10-04

[Autonomous closeout](../BAZ-059-packed-closeout-20261004.md): fresh local Linux artifact passed
installer E2E, nine installed all-route synthetic image UI/CLI checks, canonical source/rework/
preview/download/mobile/restart; source Docker image journey passed. Independent bounded review
accepted; final 2,538 full passes/47 skips, 336 security cases/types. No product fix or live call.
**Implementation/offline ready; required live qualification blocked** on three paid-route
credentials/account-side budgets/authorization and remaining rework/protected live scope. Story
remains in progress; no silent scope waiver. Current package label stays 0.22.0, no publication.

## Earlier checkpoint — live recovery, 2026-10-04, 14:59 UTC

[One authorized subscription trial succeeded](../BAZ-059-recovery-trial-20261004.md): one PNG
Result/released delivery, canonical completed-stream evidence, matching bytes after restart, no
retry. **1374×1145 returned for 1024×1024 request**, textured style. Operator visual acceptance
recorded: **“the image looks great.”** Exact-size compliance remains unproven.
Result `b6e6771e-6ad9-4cd2-a550-3674bc48c26f`. Agent archived/images off/account preserved;
authorization exhausted. Source-path success is not exact-size/style, all-route or story acceptance.
Next: address dimension mismatch/remaining qualification; no extra generation without authorization.

## Earlier checkpoint — integrated recovery, 2026-10-04

[Completed-image recovery integrated and independently accepted](../BAZ-059-image-recovery-integration-20261004.md):
empty/omitted output share strict identity/completeness checks; source fact in canonical tool details,
not fabricated on receipt replay. Real worker fixture/host tests prove synthetic PNG capture,
privacy, reopen and no retry. 244 focused / 2,532 full passes / 47 skips, 336 security cases/types.
No live call; images off/account preserved. Next: separately authorized bounded trial, not an
automatic replay. Historical bytes remain unknown; live/human qualification and release still open.

## Earlier checkpoint — staged validator, 2026-10-04

[Standalone completed-image validator](../BAZ-059-image-evidence-validator-20261004.md) and 65
adversarial fixtures implemented; 236 focused passes/root+web types. Static review accepted after
annotation-gap repair. **Not imported into production**: integration, canonical source-fact design,
shared-host byte capture/reload/privacy, full/security and integrated review remain gates. No live
call or authorization; historical image recoverability still unknown.

## Earlier checkpoint — offline evaluation, 2026-10-04

[Completed-image recovery evaluation](../BAZ-059-completed-image-evaluation-20261004.md): 24
synthetic comparisons, no provider calls or production changes. Broad upstream fallback is unsafe
to copy; existing omitted-output recovery also needs reconciliation. Independent review accepts
strict image-specific design direction with remaining exact-predicate/fixture gates. Empty/omitted
output must share complete identity-bound snapshot validation; no deltas/progress or partial union.
Next: settle those design gates, implement/review offline. Prior recoverability remains unknown;
no live authorization or image qualification inferred.

## Earlier checkpoint — 2026-10-04, 07:33 UTC

[Reviewed diagnostic-only predicate split and authorized attempt](../BAZ-059-evidence-refusal-and-trial-20261004.md):
171 focused / 2,459 full passes / 47 skips, 329 security cases/types. One subscription dispatch,
HTTP 200/missing MIME; exact refusal **`terminal_output_empty`**, explicitly empty completed final
output. Earlier completed-image bytes were not inventoried; no recoverable image inferred. No
image/Result, uncertain operation, clean blocker/no retry. Previous unretained body remains unknown.
Agent archived, images off/account preserved, authorization exhausted. Next: offline image-specific
completed-evidence contract assessment; no acceptance relaxation made and live routes unqualified.

## Earlier checkpoint — 2026-10-03, 15:06 UTC

[Reviewed image missing-MIME repair and authorized attempt](../BAZ-059-image-codec-and-trial-20261003.md):
strict explicit-stream codec, UTF-8/framing/full-stream guards, safe closed diagnostics; no alias,
empty-output reconstruction or API-key widening. Final independent review accepted after CR-line
fix; 2,433 full passes / 47 skips, 327 security cases and types. One live subscription image
request reached 200/missing MIME and recognized `response.completed`, but **evidence refused**;
exact output/predicate unknown, operation uncertain, no image saved. No retry; Agent archived,
images off/account preserved. Authorization exhausted. Next: offline evidence-contract/closed
structural diagnostic assessment; BAZ-059 remains in progress and all image routes unqualified.

## Earlier checkpoint — 2026-10-03, 14:21 UTC

[Canonical identity repair and new authorized retry](../BAZ-059-identity-repair-and-retry-20261003.md):
shared bounded whole tool-ID grammar independently accepted; 112 focused / 2,396 full passes,
324 security cases and root/web types. One actual subscription image dispatch, upstream 200 with
missing Content-Type; image adapter refused, operation uncertain, no image saved. Exact body and
failure phase unknown. No retry/fallback; Agent archived, images off/account preserved. Authorization
exhausted. Next: offline image codec-contract assessment, not another live call or assumed search
parser compatibility. BAZ-059 remains unqualified/in progress.

## Earlier continuation — 2026-10-03

BAZ-069 is accepted; the operator chose to continue the original 0.23.0 slate. BAZ-059 is next.
[Fresh preflight and live-qualification plan](../BAZ-059-live-qualification-plan-20261003.md):
71 focused tests and four offline transport probes pass; ChatGPT is connected but images remain
environment-disabled. All four live selections remain unqualified. No live call, configuration
change, credential import or spend occurred during preflight. The subsequently
[authorized subscription Agent turn](../BAZ-059-subscription-attempt-20261003.md) refused local
canonical composite tool-ID validation before image dispatch: zero image requests/Results,
clean blocker completion, no retry; Agent archived and images off/account preserved. Offline
source/Results reproduction confirms the defect; no production repair. Authorization exhausted.
Next: reviewed offline tool-identity repair, then fresh bounded subscription authorization.
Paid routes require separate credential/budget authorization.

## Historical implementation status (before 0.22.0 publication)

Implementation is present in the working tree; release remains pending. See
[operator documentation](../../image-generation.md) and
[local acceptance evidence/gaps](../BAZ-059-acceptance.md). Deterministic coverage includes the real Pi
adapter over a fake transport and a real one-shot Agent→worker IPC→daemon→Results→CLI/history path.
Browser configuration/result projection smoke uses synthetic images, not a live model. Upgrade
coverage includes all five 0.21 betas/v0.20 source-worktree upgrades and the v0.19 refusal boundary.
Scope is now frozen; [freeze validation](../../testing/0.22.0-freeze.md) records actual
SIGKILL/restart and configured-operator Docker checks with fake providers, plus the isolated 0.22
version-transition rehearsal. Captured-but-never-authorized images can be reclaimed after a crash;
this limitation remains a release-review decision.

The operator expanded the initial OpenRouter-only scope on 2026-09-19: both direct OpenAI API-key
and ChatGPT/Codex login routes must be available to end users, with OpenRouter optional. The direct
routes are implemented with deterministic transport and end-to-end CLI coverage; no live account
entitlement has been established. A further operator requirement adds **Automatic** (default): follow
explicitly enabled OpenAI text providers, never credential presence or provider errors. An OpenAI/
Codex Agent uses its own enabled text provider; other Agents use the sole enabled option, or must
choose an explicit image route if both are enabled. Image generation still needs its own opt-in.

The earlier release qualification required authorized live samples for all four selections
(a protected-origin image turn, composed browser/recovery tasks, private-output-loss and lint
decisions, reviewed-candidate CI and the Changesets transition closed with the 0.22.0 publication).
The live-sample lane became the **top story of 0.23.0** (operator decision 2026-09-23). The operator
has now explicitly reduced its required live scope to **ChatGPT-only**; generation, rework and
protected HTTP samples/operator inspections are satisfied. Paid-route live qualification is
optional/deferred, not passed; see the current decision above and revised test 9. The rewritten
[readiness plan](../../testing/beta-readiness/README.md) separates those release gates from broader
pre-1.0 usability/accessibility and endurance qualification. No paid calls, social publishing or
release has occurred.

## User stories

- As an operator, I want to enable image generation and choose from a small supported model list,
  so that my existing Agents can produce illustrations without scripts or another plugin system.
- As a content creator, I want to ask for text and an original image, inspect the saved image, then
  request a different version, so that I can prepare a useful post with my existing Team.
- As an operator, I want explicit provider/billing information, bounded generation and durable files,
  so that failures do not silently spend again or lose the output after chat reloads.

## Goal

Ship a small Hermes-style `image_generate` tool with **explicit OpenAI API-key and ChatGPT/Codex
login choices**, plus **Pi 0.85.1's existing OpenRouter image API**. Target **0.22.0**, before any 1.0 beta decision.
Reuse BAZ-034 Results and existing Profiles/Teams/skills. This is image-enabled content preparation,
not the entire social-publication sequence.

This refines the earlier broad BAZ-059 draft rather than creating an overlapping story. Protected
web search stays outside this scope. The later operator request brings the two direct OpenAI
authentication routes into scope, without a general image plugin framework.

## Why

The earlier capability assessment inspected only Bazilion/Pi's chat interface and missed Pi's
separate image API. The pinned dependency already has `ImagesModels.generateImages()` and a
built-in `openrouterImagesProvider()`. An image model is not an Agent chat model and does not call
tools; a normal Agent invokes our custom tool, whose daemon host calls Pi's image API.

**Only OpenRouter is a built-in image provider in the inspected Pi version.** OpenAI/Google in the
image catalogue identify the model family, not the credential destination. Therefore direct OpenAI
and Codex access need distinct daemon adapters. Credentials and billing must never silently switch:
OpenAI Images uses `OPENAI_API_KEY`; the separate Codex Responses image tool uses stored OAuth;
Pi's two catalogue choices still require `OPENROUTER_API_KEY`.

## Scope

### 1. Small explicit model selection

- Four explicit selections; the route is part of the persisted selection:

  | Credential / transport | Selection value | Supported v1 use |
  | --- | --- | --- |
  | OpenRouter / Pi | `google/gemini-3.1-flash-image` | Text-to-image |
  | OpenRouter / Pi | `openai/gpt-image-2` | Text-to-image |
  | OpenAI API key / Images API | `openai:gpt-image-2` | Text-to-image |
  | ChatGPT login / Codex Responses | `openai-codex:gpt-image-2` | Text-to-image; account-dependent |

  Direct routes request one 1024×1024 PNG. Codex forces only the image-generation tool on a pinned
  `gpt-6-astra` orchestrator, requests `gpt-image-2` and waits for terminal completion. Saved selection
  is not proof of which model the backend actually used.

- Both OpenRouter IDs were resolved locally from the installed provider catalogue; live entitlement and output
  quality are not yet established. Release acceptance needs an authorized sample of each advertised model.
- Image generation is opt-in and initially disabled. `BAZILION_IMAGE_MODEL=auto` (or unset) follows
  enabled OpenAI text providers under the rules above; the four explicit selections override Auto.
  Stored keys/login alone do not select an automatic route. OpenRouter is never automatic. The Agent
  cannot supply a route/model/endpoint or choose its own billing preference.
- Resolve Auto from daemon-owned live provider enablement and the admitted text model; persist the
  actual route/model, not `auto`. Revalidate after credential refresh, refusing drift before dispatch.
  Already dispatched calls retain their original route; failures/uncertainty never retry on another.
- Reuse existing OpenAI/OpenRouter key fields and daemon-owned ChatGPT OAuth login/refresh; no second
  credential store or OAuth flow. Label authentication, processing destination and API billing versus
  subscription usage explicitly, independently of the Agent's chat provider. An Agent using another chat provider can still call this tool.
- Web configuration and CLI config/list/status parity. Image models must not appear as chat choices
  or satisfy the first-run requirement for a usable chat provider/model by themselves.
- Validate OpenRouter choices through exact `ImagesModel` lookups (output includes `image`); direct
  routes use a closed selection/endpoint allowlist. Refuse a removed/unknown/disabled entry. No fuzzy resolution, fallback model or automatic catalogue expansion.

### 2. One tool and one daemon-owned execution path

- `image_generate` takes a non-empty bounded text prompt and an optional safe display filename.
  No model selector, raw provider parameters, URL, output path, shell command or count argument.
- Use Pi's public `createImagesModels` + `openrouterImagesProvider`/`generateImages` interface on
  the daemon for OpenRouter. Use bounded, fixed-endpoint HTTP adapters for direct OpenAI/Codex,
  sharing capture/disclosure/receipts. Avoid compatibility globals and ambient extension discovery.
  Never send subscription tokens to the public Images API, fall back after 401/403/429, or forward
  refresh tokens to the image service/worker. Cancellation during refresh must prevent late dispatch.
- The worker requests the operation through a closed, turn/Agent/Team-bound IPC host. The daemon
  resolves the selected key/model itself; worker-supplied identity, headers or endpoint are not trusted.
- Support ordinary and protected normal turns through that explicit host; restricted review and
  verification workers remain unable to receive/call it. No generic browser/MCP/network capability
  is introduced. The feature does not claim to sandbox an already host-trusted ordinary Agent.
- Do not add image credentials to worker inputs/environment, tool results, frontend or logs.
  Existing selected chat-provider credential needs remain a separate runtime concern.
- Initially permit text-to-image only. Rework is another explicitly requested generation with a revised
  prompt; do not claim it edits/preserves pixels of the previous image. Reference-image editing is later.

### 3. Bounded execution and truthful outcomes

- Defaults: prompt maximum 8 KiB UTF-8; one in-flight image operation per home; at most four admitted
  image-provider calls per Agent turn; deadline 180 seconds, combined with turn cancellation.
- One provider invocation per tool call; no image batching UI. Retain all actual image blocks within
  a maximum of four images, existing 25 MiB/file and 1 GiB/home Results budgets. Bound the raw response
  before buffering/parsing (initial ceiling 40 MiB); reject malformed/oversized output explicitly.
- Disable Pi/SDK request retries explicitly (`maxRetries: 0`). Persist a narrow operation receipt keyed
  to the bound turn/tool call before dispatch, so duplicate IPC or daemon restart cannot silently
  repeat a potentially billable operation. Interrupted dispatch is uncertain, not replayable success.
  Reuse an existing suitable durable primitive if available; no general jobs/runs/events engine.
- Handle `AssistantImages.stopReason` (`stop`, `error`, `aborted`) explicitly: Pi may return an error
  result rather than throw. Text-only/empty output is not successful image generation. Catch setup
  exceptions too. Surface missing key, access denial, quota, refusal, timeout and cancellation clearly.
- Capture provider response ID and reported usage where available; distinguish estimates from actual
  billing. Do not promise a precise currency cap from chat-token rates or missing usage. Explain
  request limits and recommend account-side spending controls before enabling paid generation.
- Progress uses existing tool/turn UI. No detached task manager or workflow scheduler in this milestone.

### 4. Reuse durable Results and user surfaces

- Validate returned image data/MIME/signature; capture immutable bytes/hashes in the existing Results
  store with Agent/Team/conversation/tool provenance and selected generation model metadata.
- Preserve existing private-until-authorized Agent-to-user disclosure. A tool preview, streamed image
  or Telegram mirror must not bypass a held/denied result. Generation permission is not permission
  to publish externally or disclose to another Team.
- Show an authorized persistent image/result card, preview and download after reload/restart. CLI
  one-shot chat and result commands can discover/download the same bytes; existing Telegram delivery
  uses captured bytes under its current policy. Do not add a second file-delivery path.
- A revision produces a new saved image and retains the old one. Original provenance, deletion
  tombstones, home quotas and verified backup/restore remain load-bearing.
- Supply a short skill/documented Team recipe: research using current supported tools, write a caption,
  generate an illustration, ask the user for feedback, regenerate if requested and deliver files.
  Use existing Team/Profile/trigger machinery; no new role engine or auto-created social accounts.

## Out of scope

- Native Facebook/Instagram/LinkedIn connectors, social credentials, media staging and auto-publication.
- New editorial packet tables/approval UI (BAZ-058/060). Chat feedback/manual export demonstrates
  content preparation only, not an enforceable final-social-post approval guarantee.
- Direct Google image adapters, FAL/Nous subscriptions and dynamic all-provider image plugins.
- Reference-image edits, masks, exact dimensions/quality controls, image upscaling, video/audio,
  parallel batches and guaranteed style/character consistency.
- Protected web search: keep the current restricted fetch behavior unchanged. The recipe must explain
  posture limits rather than silently granting search/MCP/browser access.
- Fixing off-Linux Agent execution (BAZ-057), public hosting, a general workflow/job engine or 1.0 release.

## Tests

1. **Catalogue:** both exact IDs resolve to `openrouter-images`; a chat/vision model, unknown ID,
   arbitrary endpoint or unapproved additional image model is rejected before any provider request.
2. **Configuration:** off by default; web/CLI selection/status agree; explicit image selections stay
   independent of chat, while Auto follows the documented text-provider rule; image-only setup does
   not falsely open the chat first-run gate.
3. **Pi adapter:** deterministic fake responses cover images+text, multiple bounded images, empty/text-only,
   `error`, `aborted`, thrown exception, invalid base64/MIME and oversized raw/decoded response.
4. **Identity/security:** IPC replay or forged Agent/Team/tool identity cannot bill or read another
   operation. Protected normal turns use only the bound image host; restricted workers refuse it.
   No new secret exposure through IPC, previews, diagnostics or result metadata.
5. **Disclosure:** allow/deny/approval-required result delivery, including live image previews and
   Telegram, respects the existing authorizer. Missing bytes, quota and tombstones fail honestly.
6. **Limits/recovery:** deadline/cancel, busy home, per-turn call cap, 429, network loss, duplicate IPC,
   restart after dispatch and late response settle without automatic regeneration or false success.
7. **Durability:** hashes match after reload/restart/download and backup/restore; regenerated output
   does not overwrite prior content. Uncertain operations restored into a clone cannot dispatch.
8. **UX:** configure each labelled credential route + image model, request text and image, see honest pending/error states,
   request a changed illustration, locate both versions; check narrow screen, keyboard and CLI parity.
9. **Live acceptance (operator-revised scope):** separately authorized, usage-bounded ChatGPT-login
   generation, same-conversation rework and protected HTTP sample; record requested route/model,
   observed source evidence, output/usage, saved bytes, restart hashes and operator inspection.
   These required subscription slices are satisfied. Direct OpenAI and both OpenRouter selections
   remain implemented/offline-tested but live-unqualified; optional live qualification is deferred,
   not required or passed. No backend-model attestation, independent-user/scheduled-origin or
   mock-only live-support claim; no social post. Other release gates remain separate.
10. **Direct transports:** exact credential/destination/body checks; complete/failed/incomplete/
    truncated/malformed Codex streams; authoritative final output; optional item metadata; raw byte
    and event caps; no external image URL download, credential fallback, 401 replay or late dispatch
    after cancellation during shared OAuth refresh. Test route-specific provenance and private Results.
11. **Automatic selection:** stored credentials without text enablement, sole enabled API-key or
    Codex route, both enabled with/without an OpenAI-family Agent, disabled Agent provider, missing
    selected credential, explicit override, image opt-out, config status and CLI parity. Toggle text
    enablement during refresh/in-flight; preserve captured route and never replay uncertain work.
12. **Release gate:** root/web typechecks, targeted and full tests, existing security gate, packed-build
    smoke and beta upgrade/backup regression pass. Add this scenario to beta qualification evidence.

## Implementation evidence and references

Inspected installed `@earendil-works/pi-ai` **0.85.1**:

- `README.md`, **Image Generation**: separate `ImagesModels` API, image output blocks, OpenRouter-only
  built-in support. Read in full, including image/auth/provider sections.
- `dist/providers/all.js`: `builtinImagesProviders()` returns only `openrouterImagesProvider()`.
- `dist/providers/openrouter-images.js`: registered provider, catalogue and OpenRouter credential handling.
- `dist/api/openrouter-images.js`: actual request, retries, image decoding and returned error contract.
- `dist/types.d.ts`: `ImagesContext`, `AssistantImages`, `ImagesModel`, distinct from `AssistantMessage`.
- Local no-network provider enumeration confirmed both selected IDs, input/output capabilities and
  `https://openrouter.ai/api/v1`. No generation or credential resolution was invoked.

Pi coding-agent `docs/sdk.md` and `examples/sdk/05-tools.ts` establish the custom-tool integration;
Bazilion already has its own explicit tool composition and must retain disabled ambient discovery.
See [the comparison](../design/openclaw-hermes-content-workflow.md) and
[the wider optional scenario](../design/social-content-team.md).

## Release and readiness notes

- Target spelling is **0.22.0** (the requested “0.22.0-beta1”, following current dotted prereleases).
- This is a frozen candidate, not a release execution. The unchanged Changesets state plans
  `0.21.0-beta.6`; a disposable rehearsal produced exactly `0.22.0`. Apply that deliberate
  transition only in the authorized, reviewed version PR. Do not publish the intermediate beta.0,
  add consumed state merely to document intent, or assume the bot resets the train correctly.
  See [the release procedure](../../releases.md).
- Credentials/live budget are execution prerequisites, not permission to spend during planning.
- Completion of the 0.21 hardening stories remains historical fact; 0.22 deliberately expands the
  feature scope. Image support alone does not certify the complete social-publishing workflow.
