# BAZ-059 — authorized live rework and protected HTTP trials (2026-10-04)

## Disposition

**Both newly authorized ChatGPT-only attempts succeeded**, one image dispatch each, no retries or
fallback. Each produced one captured/released Result with canonical **`completed_stream`** evidence,
clean completion and byte-matching download after restart. The accepted original is unchanged.
Both deliverables were subsequently viewed and visually accepted by the operator:
**“both images looks great.”** This accepts these two images, not exact geometry, other routes,
independent-user/scheduling qualification or release readiness.

The operator accepted the proposal for **one rework and one protected-origin attempt**, then said
“run it”. Eight-minute ceiling per attempt, 180-second image deadline, existing account, parent
`openai-codex:gpt-6.1-sol` / medium, requested `openai-codex:gpt-image-2` through pinned `gpt-6-astra`.
No paid API/OpenRouter, account/model/endpoint fallback, reference-image edit, other model tools,
publication or extra generation. Both authorizations are now exhausted.

Protected qualification here is **product-owned protected HTTP execution**, not a scheduled/inbox
sample. This distinction was stated before dispatch; no unattended scheduling lane is passed by it.

## Guard and source scope

No production code changed. Same source candidate as the final package/offline pass:
`/tmp/baz059-packed-F9m3G0/candidate.sha256`, SHA-256
`af83bc548e3688a4fa98a4ccd41c6741a9aa8f2eeb5a9320bfb591374374d45c`.
Source baseline remains 2,538 full passes / 47 skips, 336 security cases and root/web types.
Manifest checked before/after attempts; not a new full-suite run or version/publication.

Each fresh trial directory has separate exclusive orchestrator/attempt/dispatch markers, tested
exact endpoint/body and durable pre-dispatch guard. A consumed slot cannot be reused after failure,
concurrency or wrapper recreation. No upstream response read/rewrite/synthesis in the guard. Other
tools are prompt-restricted with post-event cancellation, not hard-removed by this guard.

Added a **test-only worker observer** on the actual serialized spawner stdin write. It checks the
expected worker kind and enabled image host before forwarding the unmodified input. It logs only
closed posture/image-enabled/credential-environment/preload booleans, not the input, credentials,
provider body or environment values. Synthetic observer tests cover posture mismatch, disabled host,
protected environment checks, no secret echo and unchanged input. This is observer evidence, not a
new production enforcement feature or independent audit of every environment variable.

## Rework — original conversation, original preserved

- **2026-10-04 16:07:32.482–16:08:21.674 UTC**, **49.192 seconds**.
- Temporarily unarchived original trial Agent **`f7c51944-8867-44ac-8ed0-002abef6ab27`** in Team
  `baz059-recovery-trial-20261004`, reused original session
  **`dfe8e1d6-0f7d-41f0-846f-5eeb3322f830`**. Re-archived after completion.
- User prompt refers to accepted original Result **`b6e6771e-6ad9-4cd2-a550-3674bc48c26f`**, requests
  a **new separate generation**, preserving it. Exact image brief appends to the original:
  “Make the scene brighter and the plant leaves a lighter green, while keeping three foreground
  potted plants.” Optional filename `robot-balcony-brighter`.
- This is **text-guided regeneration**, not a pixel/reference-image edit; the model's image request
  receives text only. No original image uploaded or guaranteed robot/plant/layout consistency.
- Observer confirmed **`configured_operator_http`**, one host enabled. Its four checked credential
  environment names were present in the configured worker (`selectedCredentialEnv: true`), and
  the trial preload inherited there. No values were read out or retained. This normal configured
  path is not represented as minimal/protected isolation. Protected case below is separate.
- One image dispatch **16:07:41.080 UTC**; headers **16:07:43.355 UTC**, **HTTP 200 / missing MIME**.
  One `image_generate`, successful canonical tool result/reference plus `completed_stream`, one
  file, one `done`/EOF, no tool/parent/fatal error/cancellation/other tool/retry/fallback.
- Result **`d42c7f34-879c-44ed-a153-15d951384d42`**, `robot-balcony-brighter.png`, **1,840,520 bytes**.
  SHA-256 **`4209bc5ef2b5064194036cc8a0c9e6445c82be6b95af18c926d0044b73868d58`**.
  **1374×1145 PNG**, requested 1024×1024. Existing exact-geometry limitation persists; no resize.
- Parent: **two responses / 13,533 tokens** (1,122 input, 123 output, 12,288 cache read, no cache
  write); catalog estimate **$0.0047028**, not bill/combined image cost.
  Image operation completed, reported **2,414 input / 182 output / 2,596 total tokens**, cost and
  cache counts unknown/null. No inferred zero subscription usage.
- Transcript/usage extraction includes **only the last user turn**, and operation/Result reads filter
  the new canonical call. Earlier original turn is not double-counted as another dispatch.
- New Result downloaded/rechecked after daemon restoration; original hash checked before, after
  that restart and again after the protected trial's restart. Distinct IDs/hashes, original unchanged.
- Assistant visual comparison: new scene appears brighter, leaves lighter green; friendly robot,
  three foreground pots, no visible text/logos/people. Robot design/layout changed, as allowed for
  regeneration; background includes other foliage. The operator subsequently accepted this image's visual quality; no independent-user study is claimed.

Artifacts: `/tmp/baz059-rework-trial-sKOrkG/`, including exact prompt/guard, safe prepared/summary/
settled records, observer/guard checks, source pins, authorized PNG and `saved-image-check.json`.

## Protected — actual protected HTTP worker, not a Docker label on normal execution

- **2026-10-04 16:10:00.732–16:10:47.345 UTC**, **46.613 seconds**.
- Dedicated Team/Profile **`baz059-protected-trial-20261004`**, Agent
  **`355267a5-5679-4bbf-a362-d5ec188d7240`**, session
  **`617f1f64-930d-4449-a23d-0dc9540d0949`**; no skills/bootstrap, now archived.
- Same exact original robot/balcony image brief and optional filename `robot-balcony`.
- Temporarily set daemon `BAZILION_PUBLIC_ORIGIN=https://baz059-qualification.invalid`. The product's
  `executionSurfaceForInvocation()` consequently selects **protected HTTP**, and turn preparation
  runs its actual protected provider/Docker path. No URL access, DNS publication, HTTPS gateway
  deployment, public listener or change to HTTP request origin was fabricated. Listener remained
  loopback; local management used normal bootstrap bearer. Scheduler/browser/search remain off.
- Cached local Docker preflight image: `debian:bookworm-slim`,
  `sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a`, no declared volumes,
  Unix-socket context. No image pull. No model coding/shell command was requested or invoked; do
  not claim image synthesis executed inside a network-disabled container. The image host remains
  daemon-owned, with selected credential egress to its fixed upstream endpoint.
- Actual observed serialized worker input **`kind: protected`**, image host enabled; checked
  `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_CODEX_OAUTH` all absent from
  child environment; no `NODE_OPTIONS`/trial preload there. This is a bounded environment check,
  not inspecting the entire credential store. Selected parent credential travels through the normal
  protected runtime input; no raw input retained, no refresh/account identifier exported.
- One image dispatch **16:10:09.074 UTC**; headers **16:10:09.971 UTC**, **HTTP 200 / missing MIME**.
  One successful `image_generate` with canonical reference/source, one file, one clean `done`/EOF.
  No tool/parent/fatal error/cancellation/second tool/retry/fallback; `protectedWorkerConfirmed: true`.
- Result **`6ada1f91-48b3-4be7-bdc0-d93f8f219bff`**, `robot-balcony.png`, **2,395,695 bytes**.
  SHA-256 **`6e4d8b4c89e7220b30e8c9d044f56c7ee60d589fc3fcb1745a6e53d4f2c4f7b0`**.
  **1312×1199 PNG**, requested 1024×1024; exact geometry excluded, mismatch retained/no resize.
- Parent: **two responses / 8,758 tokens** (4,592 input, 70 output, 4,096 cache read, no cache write);
  catalog estimate **$0.0102936**, not bill/combined image cost.
  Image operation completed, reported **2,361 input / 137 output / 2,498 total**, cost/cache unknown.
- Assistant viewed the image: friendly robot watering three potted plants on sunny balcony,
  green/cream palette, no visible text/logos/people, textured shading. Operator subsequently
  accepted this image's visual quality.

Artifacts: `/tmp/baz059-protected-trial-hh1Hqm/`, corresponding safe records, tested guard/observer,
source pins and authorized PNG/dimension record. No independent new live-evidence review of these
two attempts has been performed; prior source/first-image independent reviews keep their scopes.

## Persistence, privacy and cleanup

Normal HTTP file authorizer released both images; canonical Pi tool details contain opaque Result
references and closed source facts, not inline image bytes. Both completed operations/saved-file/
download/hash records agree. Source fact does not identify whether these particular terminal outputs
were empty versus omitted, nor independently attest backend model identity. Raw upstream bodies
were not retained; no interpretation of earlier failed attempts changes.

Both guard arms removed, markers remain consumed and must not be replayed. Original Agent restored
to archived; protected Agent archived. Trial daemons retired only after workers settled. Final
owned daemon **PID 1509495**, original home/environment restored, images/scheduler/browser off,
no public origin/preload/workers, ChatGPT connected. Both new images and the original are available
through normal Results after final restart. No home reset, credential copy/import, logout or publish.

Operator visual acceptance of both new deliverables is now recorded. Subscription rework/version retention
and protected **HTTP** source-path execution now have live evidence; no unattended scheduling/inbox,
all-account, paid-route or complete story/release claim follows. Three paid selections still need
named credentials/account-side budgets/authorization. **No further generation is authorized.**
