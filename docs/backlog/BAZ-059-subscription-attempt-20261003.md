# BAZ-059 — authorized subscription attempt stopped before image dispatch (2026-10-03)

## Disposition

**Live Agent attempt ran once and did not qualify image generation.** The Agent requested the
approved image prompt, but daemon source validation refused its canonical composite tool ID before
image-operation admission or transport dispatch. It completed a blocker response without retry.
**Zero image requests, zero saved Results.** Parent subscription inference did occur. Authorization
is exhausted; no additional Agent/image attempt is authorized by the original approval.

This demonstrates a local identity-grammar defect, not failed subscription image entitlement,
upstream MIME/terminal behavior or provider billing. No actual image response was received.

## Authorization and pre-dispatch bound

The operator approved the [first subscription-only proposal](BAZ-059-live-qualification-plan-20261003.md):
existing ChatGPT account, `openai-codex:gpt-image-2` requested through pinned `gpt-6-astra` image
orchestrator; parent `openai-codex:gpt-6.1-sol` / medium; exact public robot/balcony brief; one
image generation, eight-minute attempt ceiling, no rework/retry/fallback/API/OpenRouter/publication.
Temporary enablement of the owned idle daemon and restoration were within the approved scope.

A test-only preload wrapped the daemon's image fetch boundary. It required the exact endpoint,
method and entire production-generated body; a durable exclusive file consumed the one dispatch
slot **before** calling the original transport. It refused unarmed/expired, changed prompt/model,
paid destinations and a second/concurrent dispatch. It did not decode/synthesize a response or
replace the production parser. Only standard OAuth refresh and the admitted image endpoint were
allowed in that daemon wrapper; worker parent chat retained its normal selected transport.

Offline checks used synthetic transports, including the actual image adapter through global fetch
interception, simultaneous calls, wrapper recreation and consumed-slot-on-transport-failure.
They passed without provider requests. This guard bounds image dispatch, not every model-visible
tool: other capabilities remained prompt-restricted plus post-event cancellation. No unexpected
tool was observed. Guard installation was confirmed before the authorized turn.

## Preflight stop, retained separately

The first orchestration preflight used `/api/telegram` instead of `/api/config/telegram` and failed
locally. No Agent or provider call, daemon restart, image enablement or attempt-dispatch marker
occurred. Existing disabled posture and connection were confirmed. The local URL was corrected,
original failure artifacts retained, and preparation continued under the still-unused authorization.
This is not a second live attempt or erased failure.

## Actual attempt

- **Window:** 2026-10-03 **14:00:13.102–14:00:22.100 UTC**, **8.998 seconds**.
- Dedicated Team/Profile `baz059-image-trial-20261003`; empty selected skills, no bootstrap,
  explicit one-attempt instructions. Agent **`33708b3c-7580-48e9-883b-1436d21f099d`**.
- Parent model **`openai-codex:gpt-6.1-sol` / medium**. Image selection explicitly subscription,
  images temporarily on, ordinary discovery off; browser/scheduler off, no MCP or Telegram setup.
- One `image_generate` call, exact approved prompt, optional name `robot-balcony`.
- Canonical tool error exactly **`Tool source does not match admitted conversation`**.
  Raw provider exceptions/headers/bodies and private reasoning were not exported.
- One clean `done`/EOF, no fatal/parent error/cancellation, no second tool, no fallback.
  Stream bytes **5,144**. This is blocker completion, not successful image qualification.
- **No `image_generations` row, no image-dispatch marker/event, no image Results or files.**
  The guard logged installation only; it was never reached by generation.
- Parent usage: **two responses**, **11,773 tokens** (6,059 input, 82 output, 5,632 cache read,
  zero cache write). Pi catalog estimate **$0.0135012**, not a bill or image charge. No image usage
  exists; parent subscription usage must not be presented as zero consumption.

## Offline diagnosis and reproduction

The actual canonical tool ID has **83 characters and a `|` separator**. The pinned Pi 1.0 Responses
consumer constructs tool IDs as **`${item.call_id}|${item.id}`** in
`openai-responses-shared.js`; this is the actual source identity, not an Agent-forged destination.

`apps/daemon/src/lib/turn-tool-source.ts:createTurnToolSource()` rejects anything outside
`^[A-Za-z0-9._:-]{1,256}$` before canonical transcript lookup. Its emitted error exactly matches
the observed tool result. This happens before image intent/credentials/provider dispatch.

A disposable offline reproduction with two actual appended canonical calls confirmed:

- Simple `call_fixture` passes the existing source lookup and Results publication.
- Composite `call_fixture|fc_fixture` fails source lookup with the same closed error.
- Direct Results publication independently refuses that composite ID as **`Invalid result provenance`**
  in `apps/daemon/src/core/repos/results.ts`. Fixing only the first validator could move the defect
  after a billable generation into failed capture, so both boundaries need review together.

No production code changed. The observation justifies an offline identity-contract repair; it
**does not** justify changing the image request/model/decoder or copying the search accumulator.

## Cleanup and candidate identity

The trial Agent returned idle and was archived. The owned trial daemon was gracefully stopped
only after no worker children remained; the original environment was restored on the same home.
Image generation is **off**, ChatGPT connection preserved, no active Agents/workers. No credential
copy/import/logout/home reset, private-network exception or external publication occurred.
Current owned daemon PID **3889468** is in the existing and new control PID files.

Source inputs stayed identical to `/tmp/baz069-closeout-packed-qMqZrU/repaired-source.sha256`,
manifest SHA-256 `4284dfbd8dd09d33dedcf75b1527e88f144726b13d6b9997fb4ec03057ce3639`.
Preparation/harness scripts are not production changes; no request/parser repair was enabled.

Artifacts: `/tmp/baz059-subscription-trial-92DyYb/` — checked guard/probe/orchestration scripts,
`guard-tests.log`, `prepared.json`, exclusive attempt marker, safe `guard-events.jsonl`,
`trial-summary.json`, `settled.json`, `closed-diagnostic.json`, `offline-reproduction.json` and
`initial-preflight-stop/`. Canonical Pi session remains private in the operator home. No image was
created for inspection. Do not replay the orchestration/attempt scripts.

## Next work

Repair the shared bounded tool-call identity contract offline, preserving the **whole canonical
ID** rather than splitting/normalizing it. Keep Agent/Team/conversation/turn membership, transcript
matching, argument equality, immutable provenance and replay protection. Do not broaden unrelated
session/Team/result/review identities. Cover simple/composite, malformed/oversized/forged/other-turn
IDs and downstream image/Results capture before any live retry, then independently review and
revalidate the candidate. A repaired source candidate needs **fresh explicit one-attempt
subscription authorization**; no additional live call follows automatically. All four image
selections and human image inspection remain unqualified.
