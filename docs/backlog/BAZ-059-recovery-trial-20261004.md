# BAZ-059 — authorized live completed-image recovery trial (2026-10-04)

## Disposition

Subsequent [independent bounded review accepted this source journey](BAZ-059-qualification-status-20261004.md)
with limits. The operator also accepted its visual quality. Exact dimensions were already outside
story scope; the observed mismatch remains a limitation, not a required resize/re-generation task.

**One subscription image generated, captured, released and re-downloaded after daemon restart.**
Canonical Pi tool details report **`outputSource: completed_stream`**. Exactly one image request,
no retry/rework/fallback, clean completion. Account/home preserved, images restored off, Agent
archived. The operator's “go for the trial” authorization is now exhausted.

**Qualification caveat:** requested **1024×1024 PNG**, saved image is **1374×1145 PNG**. No resize,
crop or regeneration was performed. Assistant visual inspection finds the requested robot/three
foreground potted plants/green-and-cream sunny balcony, no visible text/logos/people, but textured
shading rather than strictly flat illustration. **The operator subsequently accepted this image's visual quality: “the image looks great.”**
That accepts the appearance of this deliverable, including its observed textured treatment; it
does not establish exact-size compliance, all-route qualification or story/release completion. Earlier failed attempts keep their own outcomes; none was replayed or reclassified.

## Scope and reviewed candidate

Same approved brief: “A friendly small robot watering three potted plants on a sunny balcony;
flat editorial illustration, soft green and cream palette, no text, logos or people.” Optional
name `robot-balcony`. Parent **`openai-codex:gpt-6.1-sol` / medium**. Requested image
**`openai-codex:gpt-image-2`**, pinned auxiliary **`gpt-6-astra`**, one 1024×1024 PNG request.
No paid API/OpenRouter, alternative credentials/account/model/endpoint, private input, research,
browser, MCP, shell, publication or extra generation. Eight-minute attempt / 180-second image cap.

Used the [independently reviewed integrated candidate](BAZ-059-image-recovery-integration-20261004.md):
2,532 full passes / 47 skips, 336 security cases/root+web types. Manifest SHA-256
`b5754cf9f5bc412df63398a21e901663f0d43fd1066bc864a4ca79a92cdc9ed4`, checked before and after trial.
No production code change for this attempt. Only fresh local trial harness paths, closed diagnostic
allowlist and canonical source-fact extraction changed from the previous harness.

The tested test-only fetch guard admits exactly the approved endpoint/body and consumes a durable
exclusive slot **before dispatch**, including on transport failure, concurrency or wrapper recreation.
It does not read/rewrite upstream response bodies. Other tools remain prompt-restricted with a
post-event watchdog, not hard tool removal. Agent had no skills/bootstrap; scheduler/browser/search
were off, Telegram unconfigured, no MCP servers. Local configuration readiness is not entitlement.

## Observed attempt

- **2026-10-04 14:58:40.450–14:59:24.212 UTC**, **43.762 seconds**.
- Team/Profile **`baz059-recovery-trial-20261004`**; Agent
  **`f7c51944-8867-44ac-8ed0-002abef6ab27`**, now archived.
- Exactly one canonical composite-ID `image_generate` with exact brief, no other tools.
- One image dispatch **14:58:46.750 UTC**; response headers **14:58:49.471 UTC**, **HTTP 200 /
  missing Content-Type**. No second dispatch, guard refusal or OAuth-refresh guard event.
- One successful canonical tool result references the saved Result and carries
  **`imageEvidence.outputSource: completed_stream`**. This means the reviewed collector admitted
  actual completed snapshots under its strict prerequisites; it does not attest backend model
  identity. Raw body/items were not retained. The source fact alone does not distinguish omitted
  versus explicit-empty final output in this particular response; do not infer which occurred.
- One operation **completed** and one released Result. One `done`/clean EOF, no tool/parent/fatal
  error, no cancellation, no retry/rework/fallback. Client NDJSON **2,992,297 bytes**, not upstream
  body size. Parent answer: “Saved Result: **robot-balcony.png** — ready for human inspection.”
- Parent **two responses / 11,821 tokens**: 6,117 input, 72 output, 5,632 cache read, no cache write.
  Parent catalog estimate **$0.0135172**, not a bill or combined image cost.
- Image operation reported **2,357 input / 145 output / 2,502 total tokens**; cache counts and
  estimated cost unknown/null. These are reported auxiliary usage, not a quantified image charge
  or guarantee of zero subscription consumption.

## Saved deliverable and checks

- **Result:** `b6e6771e-6ad9-4cd2-a550-3674bc48c26f`
- **Name:** `robot-balcony.png`; **2,240,614 bytes**; MIME `image/png`.
- **SHA-256:** `40dbca4d9a1a7d35f7d20866130b6514db3f9ebbd542e1de805b85e9dafc6096`.
- **Actual IHDR dimensions:** **1374×1145**, versus requested 1024×1024. PNG signature and IHDR
  checked; assistant loaded/viewed the saved image. This is not a claim of a separate full PNG
  decoder audit, human quality approval or exact geometry support.
- Live file receipt, persisted Result metadata and downloaded bytes agree. Normal file authorization
  released it; canonical Pi details retain the opaque reference/source fact, not inline image bytes.
- Restored-daemon download produced the same SHA-256. Result remains accessible from the Team's
  Results or `bazilion result` despite archiving the trial Agent.
- Convenience local inspection copy:
  `/tmp/baz059-recovery-trial-5n8RIa/b6e6771e-6ad9-4cd2-a550-3674bc48c26f.png`.
  Canonical persistence is the Result in the operator home, not this temporary copy.

The assistant's visual assessment alone is not human acceptance. The operator subsequently viewed
and praised this saved image (“the image looks great”), providing **operator visual acceptance of
this deliverable**, not the separately recruited independent-user acceptance required elsewhere.
Do not claim the selected route guarantees exact dimensions or that the dimension mismatch was repaired. No follow-up image
request is implied by this success or by inspecting the saved Result.

## Cleanup, artifacts and next gates

Guard disarmed; exclusive attempt/dispatch markers retained and must not be replayed. Trial Agent
archived after clean completion/no workers, trial daemon retired, original environment restored on
same home. **Current owned daemon PID 805549**; images/scheduler/browser off, no trial preload or
worker children; ChatGPT connected. No home reset, credential copy/import, logout or publication.

Artifacts: `/tmp/baz059-recovery-trial-5n8RIa/` — prepared/trial/settled safe records, guard checks,
closed header events, one-dispatch markers, source pins, downloaded authorized PNG and
`saved-image-check.json`. No raw upstream body or credential-bearing headers/errors retained.
At trial completion this was operator-harness/source evidence, not independent review or packed UI
qualification. The subsequent bounded review linked above accepted the selected canonical/receipt
records with limits; packed UI qualification remains separate.

Operator visual acceptance is recorded for this deliverable. Next: explicit handling of the
size mismatch in qualification; the accepted visual appearance does not erase it. Broader BAZ-059 still needs remaining advertised routes,
authorized rework/protected-origin evidence as applicable and human acceptance; BAZ-064/065/068
and original 0.23.0 release gates remain separate. **Any further generation needs fresh explicit
bounded authorization.** Offline analysis or reading this saved Result needs no regeneration.
