# BAZ-059 — 0.23.0 live-image qualification continuation (2026-10-03)

See the [current 2026-10-04 qualification matrix](BAZ-059-qualification-status-20261004.md):
independent bounded review accepted the successful subscription journey; operator visual acceptance
is recorded. Exact geometry is out of scope, mismatch retained, no resize/re-generation required.
The sections below retain earlier checkpoints; no further generation is authorized.

## Current operator decision — required ChatGPT-only live scope

[Explicit scope reduction](BAZ-059-chatgpt-only-live-scope-20261004.md): “I'm fine reducing the scope.”
Required subscription generation/rework/protected HTTP samples and operator inspections are
satisfied. Direct OpenAI/both OpenRouter live trials are now optional/deferred, not passed or
required. This supersedes this plan's former all-route live requirement. Existing adapters/offline
coverage and original broader 0.23.0 slate are unchanged. No further calls or release authorized.

## Earlier checkpoint — live rework/protected HTTP, 2026-10-04, 16:10 UTC

[Two explicitly authorized ChatGPT-only attempts succeeded](BAZ-059-rework-and-protected-trials-20261004.md):
one same-conversation regeneration and one product-owned protected HTTP turn, single dispatch each,
new separate Results/canonical completed-stream facts/restart hashes, original unchanged. Both
new images now have operator visual acceptance (“both images looks great”). Protected HTTP is not unattended scheduling evidence.
Images off/account preserved; authorizations exhausted; paid routes remain untouched/unqualified.

## Earlier checkpoint — offline/package closeout, 2026-10-04

[Current artifact and deterministic container gates completed](BAZ-059-packed-closeout-20261004.md):
nine installed image checks, Linux installer E2E, Docker source fixture; independent bounded review,
2,538 full passes/336 security cases/types. No new live call. Implementation/offline ready; live
qualification still needs explicit named credentials/budgets and authorization for three paid routes,
remaining rework/protected posture and human inspection. No automatic subscription regeneration.

## Earlier checkpoint — live recovery, 2026-10-04, 14:59 UTC

[Authorized trial saved one image](BAZ-059-recovery-trial-20261004.md), completed-stream evidence,
clean completion/no retry, exact bytes available after restart. Actual **1374×1145** differs from
requested **1024×1024**. Operator visual acceptance recorded: **“the image looks great.”**
Images off/account preserved, Agent archived, authorization exhausted. Next: address dimension
compliance and remaining qualification, not automatic rework. Broader route/release gates remain.

## Earlier checkpoint — integrated recovery, 2026-10-04

[Integrated strict image recovery](BAZ-059-image-recovery-integration-20261004.md) passed independent
review, 244 focused / 2,532 full tests / 47 skips, 336 security cases and types. Host/real-worker
fixtures cover synthetic recovery, canonical source facts, private PNG capture/reopen and no replay.
No live attempt; images off/account preserved. A new bounded one-dispatch subscription trial needs
explicit authorization. No claim the old unretained image response was recoverable.

## Earlier checkpoint — staged validator, 2026-10-04

[Standalone validator](BAZ-059-image-evidence-validator-20261004.md) now has exact predicates and
65 new synthetic fixtures; 236 focused tests/root+web types pass, static review accepted with
integration limits after annotation-gap repair. Not wired into production. Next: parser/host/
canonical source-fact integration and offline capture/reload/privacy proof, full/security and
integrated review. No live call or new authorization; no past image recovery inferred.

## Earlier checkpoint — offline evaluation, 2026-10-04

[Image-specific recovery evaluation](BAZ-059-completed-image-evaluation-20261004.md) completed:
24 synthetic comparisons; upstream collector helper dependencies explicitly doubled. Broad upstream
fallback and existing omitted-output reconciliation gaps identified. Strict completed-snapshot
direction independently accepted for further design, not implementation approval; exact predicates
and nonimage/sequence/reconciliation fixtures remain gates. No production change or live call.
Next: settle contract and implement/review offline, not another generation. No live authorization.

## Earlier checkpoint — 2026-10-04, 07:33 UTC

[Reviewed evidence diagnostics and authorized attempt](BAZ-059-evidence-refusal-and-trial-20261004.md):
2,459 full passes/329 security cases and final review passed. One image dispatch, HTTP 200/missing
MIME; **`terminal_output_empty`** pinpoints explicitly empty final completed output in this attempt.
Earlier image-event bytes remain unknown; no saved image, uncertain operation, no retry. Historical
failure not retroactively diagnosed. Agent archived, images off/account preserved, authorization
exhausted. Next: offline image-specific evidence-contract assessment, then reviewed/revalidated
repair if justified; further live call needs fresh bounded authorization.

## Earlier checkpoint — 2026-10-03, 15:06 UTC

[Reviewed missing-MIME image codec and authorized attempt](BAZ-059-image-codec-and-trial-20261003.md):
2,433 full tests/327 security cases and final review passed (CR-line finding repaired). One image
dispatch, HTTP 200/missing MIME; recognized completed terminal but evidence refused, uncertain
operation/no image. Exact failed predicate/output unknown. No retry, cleanup restored images
off/account preserved; authorization exhausted. Next: offline evidence-contract/closed diagnostic
work; further live attempt needs fresh explicit authorization.

## Earlier checkpoint — 14:21 UTC

[Reviewed identity repair and a newly authorized retry](BAZ-059-identity-repair-and-retry-20261003.md)
completed: whole composite IDs preserved; 2,396 full passes / 324 security cases. One subscription
image request dispatched, upstream HTTP 200/missing MIME; unchanged image adapter refused,
operation uncertain and no image saved. Exact response body/failure phase unknown. No retry,
Agent archived, images off/account preserved; authorization exhausted. Next: offline image
codec-contract assessment and fresh authorization only after any reviewed/revalidated repair.

## Earlier authorized attempt

The operator approved the first subscription attempt. [The 14:00 UTC Agent turn](BAZ-059-subscription-attempt-20261003.md)
ran once but stopped before image dispatch: Pi's canonical composite tool ID was rejected by local
source validation. Zero image requests/Results, clean blocker `done`, archived Agent and original
disabled daemon posture restored. Offline reproduction confirms source and downstream Results
identity grammars both need review. Authorization exhausted; no retry. The proposal/preflight
below records the preceding disposition, not a successful live-image sample.

## Pre-attempt disposition

The operator chose to continue the original 0.23.0 plan after accepting BAZ-069, rather than
release a narrower scope. **BAZ-059 is next; no live image call or spend has been authorized.**
This pass prepares qualification and rechecks existing code, not a new image implementation.

The 0.22.0 publication is historical fact. Its old prerelease/version-transition and additive
migration instructions are not current release instructions: the current alpha schema is
clean-install only. Do not replay those steps or modify/reset the connected operator home.

## Fresh offline and passive preflight

- **71 tests passed across five files:** daemon image host, direct transports, config routes,
  real CLI/worker/daemon image pipeline and actual fixture crash/restart. Scrubbed test environment,
  synthetic credentials and provider responses; no live entitlement/quality claim. Tests used
  disposable homes; the operator daemon did not need stopping.
- Four additional injected-fetch image-contract probes passed: the current Codex image transport
  accepts a populated `response.completed` with SSE MIME; it refuses absent MIME, a `response.done`
  terminal and completed streamed image items followed by explicit empty terminal output.
- These are **compatibility risks, not an observed live image failure**. BAZ-069 saw related shapes
  on a different auxiliary search request. Its search-specific accumulator and evidence contract
  do not automatically apply to image output. No parser, model or request change was made.
- Passive local checks: ChatGPT is connected; images remain off; scheduler off; browser disabled;
  no active Agents or worker children. No provider test, OAuth refresh or configuration write.
  API-key/OpenRouter readiness was deliberately not checked through the provider catalogue route,
  which can perform provider discovery for enabled providers.
- The owned daemon has **`BAZILION_IMAGE_GENERATION=off` in its environment**. Saving `on` in the UI
  cannot override it. Any authorized trial must explicitly arrange temporary daemon enablement
  and restore the existing disabled posture; do not claim a saved setting enabled the capability.
- Current source pins still match the BAZ-069 repaired-source manifest, SHA-256
  `4284dfbd8dd09d33dedcf75b1527e88f144726b13d6b9997fb4ec03057ce3639`.
  Current full/security baseline remains **2,365 passed / 47 skipped** and **324 required cases**;
  those were not rerun by this narrower preflight.

Artifacts: `/tmp/baz059-qualification-preflight-Tchghu/` (`focused.log`, `readiness.json`,
`image-contract-probe.mts`, `image-contract-probe.json`, `source-pins.log`). Only closed readiness
facts were retained; no credentials, account identifiers or real provider output were exported.

## Qualification matrix — all live cells not run

| Image selection | Account/billing route | Current live status |
| --- | --- | --- |
| `openai-codex:gpt-image-2` | Existing ChatGPT OAuth; subscription entitlement/usage | Not run; connected is not image entitlement |
| `openai:gpt-image-2` | Operator-selected OpenAI API credential; separate API charges | Not run; credential/budget confirmation required |
| `google/gemini-3.1-flash-image` | Operator-selected OpenRouter credential; API charges | Not run; credential/budget confirmation required |
| `openai/gpt-image-2` | Operator-selected OpenRouter credential; API charges | Not run; credential/budget confirmation required |

Automatic routing is not a fifth model or fallback lane. Every advertised selection needs its own
observed result and human image inspection; one subscription success cannot close the full story.
The independent Content Team/human work remains BAZ-064/065, not simulated by these samples.

## Proposed first authorization — subscription only

Start with the connected subscription, without requesting or importing another credential.
**This proposal is not dispatch permission.** Obtain explicit approval for:

- One image-generation attempt using **`openai-codex:gpt-image-2`**. The current auxiliary request
  uses pinned **`gpt-6-astra`** with the hosted image tool requesting **`gpt-image-2`**, 1024×1024 PNG.
  This auxiliary model is separate from the proposed parent Agent **`openai-codex:gpt-6.1-sol` /
  medium**. Do not silently replace either model or represent selected image metadata as backend
  attestation.
- A proposed benign brief: “A friendly small robot watering three potted plants on a sunny balcony;
  flat editorial illustration, soft green and cream palette, no text, logos or people.” No private
  input, references, source research or external publication.
- One requested generation, no automatic rework/retry; 180-second image-request deadline and
  eight-minute whole-attempt ceiling. Parent chat/OAuth refresh and image generation use only the
  selected subscription; quota use is possible and unknown monetary cost must not be called zero.
  No API-key/OpenRouter, model/account/endpoint fallback, browser, MCP, shell or social posting.
- Temporary enablement/restart of only the owned idle daemon, a dedicated trial Team/Agent in the
  existing home, and restoration afterward. Preserve the connected account and all operator data;
  no credential copying, home reset, public exposure or unrelated process shutdown.

Before issuing the attempt, prepare and check the harness, candidate pins, idle/ownership state,
background ingress and result-disclosure policy. **The product allows four image calls per turn;
that is not a one-attempt quota.** A one-generation trial needs a checked pre-dispatch harness
bound rather than pretending prompt instructions/post-event cancellation enforce that bound.
Do not dispatch until that bound and its limitations are established. Use an exclusive attempt
marker and never replay a dispatched/uncertain generation to make the check pass.

On first refusal, timeout, uncertainty, malformed output or unexpected tool use, stop and retain
only safe diagnostics. Diagnose offline; any additional live attempt needs fresh authorization.
No speculative relaxation of image evidence or transplantation of the search decoder.

## Evidence and completion sequence

1. Observe actual Agent → tool → daemon generation → durable Result → authorized delivery and
   clean completion. Retain bounded route/model/usage facts, immutable Result IDs/digests, source
   provenance and latency; no raw provider body/headers or credential-bearing exceptions.
2. Verify downloaded bytes/hash and persisted chat/Results after reload. Ask the operator to
   inspect the actual image; a PNG signature or synthetic preview is not quality acceptance.
3. Archive the trial Agent, verify no worker remains, and restore prior image/config/environment
   posture. Preserve released evidence/results; never regenerate a missing/uncertain output.
4. Separately authorize paid-route samples with named credentials, maximum attempts and explicit
   account-side spend limits. Request limits/cost estimates are not a hard dollar ceiling. Credentials
   are entered through normal configuration, not pasted into chat or copied between homes.
5. Complete separately bounded rework/persistence and relevant protected-origin evidence under
   the story's required layers; current fixture checks are not live-provider evidence. No live
   crash/interruption test is included in the first authorization.
6. Independently review route evidence, human inspection, remaining limitations and current-candidate
   regressions before closing BAZ-059. Release/version/publication remains a later gate.
