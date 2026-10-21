# BAZ-069 — T18(b) live Agent evidence and completion defect

> Historical first-attempt record. [R10/R11 remediation and re-review](BAZ-069-t18b-remediation.md)
> now address the defects and delegate the operator-authorized Google cookie rejection. The failed
> terminal frame below remains a failure. [Attempt 2](BAZ-069-t18b-retry-evidence.md) later handled
> cookie rejection autonomously and completed its blocker report cleanly, but reached no source.
> A full successful current-candidate research journey remains missing.

Date: 2026-09-28. **Research/source-reading success observed with human consent assistance;
clean end-to-end qualification BLOCKED by a terminal worker protocol failure.** This is neither
independent live-lane acceptance nor release approval. No production code was changed during
this attempt, and no second research attempt or paid-provider fallback was run.

## Authorized lane and provenance

The operator authorized T18(b), selected **ChatGPT subscription**, and confirmed `done` after the
Agent stopped at Google consent. The actual selected provider/model was
**`openai-codex:gpt-6-astra`**, requested medium reasoning, using the normal OAuth connection flow.
Only that provider was enabled. The Agent was an ordinary HTTP-admitted Agent, not a canned model,
restricted worker or parent-scripted browser sequence.

A temporary daemon on loopback owned a fresh home, research profile, Team and persistent managed
browser profile. Agent `6d64c781-2028-4a34-8091-193c879e56be` used Chromium **152.0.7977.82** headed.
Process inspection confirmed the validating proxy, `--proxy-bypass-list=<-loopback>`, native sandbox
and no API-key/token/secret-named browser environment entries. Reviewed browser/runtime files
matched their closure-review hashes; this does not claim every unrelated worktree file was frozen.
The existing Bazilion home was not booted or migrated, nor were personal browser cookies imported.

The ordinary goal was to find an official NASA Artemis II source through Google, read it, and
summarize purpose, crew and dates with citations. No tool sequence, element refs or NASA source
URL was supplied. Only public browser research was permitted, with a stop at human-choice walls.
The first turn had a 24-call/eight-minute prompt budget and external cancellation bounds. The
operator-confirmed continuation allowed 22 remaining calls and 7.5 active minutes, excluding the
human pause. Neither cancellation threshold was reached.

## Observed sequence

### Turn 1 — 17:07:20.251–17:07:37.208 UTC

Two Agent-selected calls: `browser_status`, then `browser_navigate` to a Google search for
`site:nasa.gov Artemis II mission crew dates`.

The Agent observed Polish Google consent, stopped without choosing an option, and explicitly
said no NASA source had been read. The observation was a complete frozen capture delivered as
chunk one of two; the Agent did not claim it had read the second chunk. The turn ended with a
valid `done` frame. The operator subsequently confirmed handling consent. The actual choice was
not observed and is not inferred.

### Turn 2 — 17:12:28.489–17:13:17.099 UTC

Same Agent, conversation, browser process/profile and active `tab-1`; the continuation refused to
start had the original session stopped. No search replay or new Google query was made.

| Call | Agent choice and observed result |
| --- | --- |
| 1 | `browser_snapshot`: current Google results, new observation `552d799f-e11c-4e04-8f12-509220aefba9`; first of two chunks. |
| 2 | `browser_click` on observed `e629`, **Artemis II Lunar Flyby**, a NASA result. The click's subsequent capture errored: `locator.ariaSnapshot: Selector "body" does not match any element`. This was not a clean tool success. |
| 3 | `browser_snapshot`, rather than replaying the click. At 17:12:42.430, observation `537073e2-802d-4d60-93b6-ec1a717f4323` exposed NASA's **Artemis II Lunar Flyby** source text, complete with no further chunk. |
| 4 | Clicked the current NASA **Explore** control. |
| 5 | Clicked its observed **Missions** link, whose href was `https://www.nasa.gov/nasa-missions/`. |
| 6 | Clicked **Artemis**, with observed href `https://www.nasa.gov/humans-in-space/artemis/`; observed source paragraphs supported crew and mission/program context. Output had a further chunk which the Agent did not retrieve. |
| 7–8 | Two clicks on the current **Artemis II** link were refused as stale, each returning a new observation. They were not successful actions. |
| 9 | Navigated to the **already-observed** href `https://www.nasa.gov/mission/artemis-ii/`, rather than guessing a URL or switching engines. Observation `c2470e9c-9e63-4512-a2f5-fc2e96d864f6`, captured 17:13:08.592, was complete with no further text. |

The direct href navigation followed explicit stale-action refusals, not an uncertain submission.
The only uncertain click was followed by observation of the destination, not click replay. There
was no reported CAPTCHA during this attempt and no further human-choice wall was acted on.

### Source support retained without whole-page dumps

The Artemis overview included:

> In April 2026, Artemis II launched on a nearly 10-day voyage around the Moon, marking the first
> crewed flight of NASA’s Orion spacecraft. NASA astronauts Reid Wiseman, Victor Glover, and
> Christina Koch, along with CSA (Canadian Space Agency) astronaut Jeremy Hansen, traveled
> 252,756 miles from Earth [...].

The mission-page observation included these fields and text:

- Duration: **9 Days, 1 Hour, 32 Minutes**.
- Launch: **April 1, 2026**; splashdown: **April 10, 2026**.
- “The first crewed Artemis flight marks a key step toward long-term return to the Moon and future
  missions to Mars.”
- “Meet the astronauts who ventured around the Moon on Artemis II, the first crewed flight aboard
  NASA’s human deep space capabilities, paving the way for future lunar surface missions.”
- Page last updated: **Jul 07, 2026**.

These are recorded live source observations, not facts supplied to the Agent in its prompt or
inferred from Google snippets. The cited URLs were exposed as NASA hrefs/requested navigation
URLs. The Agent did not separately call `browser_tabs` to check the effective post-redirect URL;
no independent address-bar verification is claimed.

### Final answer was delivered, despite terminal failure

The NDJSON stream contained **209 assistant deltas and one 872-character `assistant_message`**;
the same final text is in the canonical Pi session, with provider stop reason `stop`. It summarized
purpose, all four crew members, launch/splashdown/duration, distinguished completed Artemis II from
future program goals, and cited both the mission page and Artemis overview. Its opening was:

> NASA’s pages describe Artemis II as a **completed mission**, not merely a plan.

It was followed by **`fatal: worker emitted malformed frame`**, with **no `done` frame** for this
turn. The implementation assistant initially described the failure as occurring before final
summary delivery, then corrected that after inspecting the stream/session. The delivered answer
and the terminal protocol failure must both be retained; neither cancels the other.

## R10 — worker completion can truncate its queued stdout (open at time of attempt)

`apps/daemon/src/runtime/worker/entry.ts` emits the full-history `done` frame using
`process.stdout.write`, then explicitly calls `process.exit(...)` after disposal/disconnection,
without waiting for queued output to drain. `spawn.ts:parseFrame` reports malformed input as the
observed generic fatal. A successful process exit therefore does not establish successful frame
completion.

A **local offline reproduction**, with no model/network/browser actions, reconstructed the full
completion frame from this attempt's canonical session through production
`piMessagesToProviderView`. The complete JSON passed `sanitizeQuestionWorkerFrame`.

| Child exit behavior | Attempts | Expected bytes | Received bytes | Valid completion JSON |
| --- | --- | --- | --- | --- |
| Write then immediate `process.exit(0)` | 3 | 230,287 | 146,176 each | No, all three |
| Exit from the stdout write callback | 3 | 230,287 | 230,287 each | Yes, all three |

This confirms the unsafe exit pattern with the actual reconstructed payload and strongly explains
the live terminal failure. The offending raw worker byte sequence was not retained by the daemon,
so its exact truncated byte count cannot be claimed from this reproduction. This is a worker
completion defect, not evidence of a failed NASA navigation or an OAuth billing error.

Required remediation: drain queued protocol output before exit, while retaining bounded shutdown
and release of the Team lease even when native/provider handles remain live. Add large-terminal-
frame/slow-reader and failure/cancellation regressions; rerun the relevant whole-tree/security gates
and independent review before claiming closure. A callback-only synthetic comparison is **not** an
implemented or reviewed production fix. No implementation changes have been made here.

A credential-free equivalent probe can be repeated without retaining the real transcript:

```js
const { spawnSync } = require('node:child_process')
const frame = { kind: 'done', messages: [{ role: 'user', content: '' }] }
const overhead = Buffer.byteLength(JSON.stringify(frame) + '\n')
frame.messages[0].content = 'x'.repeat(230287 - overhead)
const input = JSON.stringify(frame) + '\n'
for (const drain of [false, true]) {
  const code = `const b=require('node:fs').readFileSync(0);
    process.stdout.write(b${drain ? ',()=>process.exit(0)' : ''});
    ${drain ? '' : 'process.exit(0)'}`
  const child = spawnSync(process.execPath, ['-e', code], {
    input, maxBuffer: 1024 * 1024, timeout: 5000, env: {},
  })
  let valid = false
  try { JSON.parse(child.stdout.toString()); valid = true } catch {}
  console.log({ drain, expected: Buffer.byteLength(input), received: child.stdout.length, valid })
}
```

Exact short-write sizes are OS/pipe-timing dependent; absence of truncation in one run does not
make immediate exit a safe flushing contract. This synthetic recipe is distinct from the six
actual-reconstructed-payload measurements above.

## Usage and limits

Across both turns: **13 provider responses**, **11 browser calls**, **478,479 reported tokens**:
72,717 input, 404,992 cache reads, 770 output, zero cache writes. Pi's model-catalog estimate totals
**$1.170662**; this is not an invoice or proof of API billing. The selected credential/transport was
ChatGPT subscription OAuth, with no paid-provider fallback. Account-level billing and remaining
subscription quota were not inspected.

No repeated research attempt, API-key provider test, alternate engine, challenge automation,
private-data read, file download or publication occurred. The offline stdout comparison made no
provider requests. This remains **human-assisted** qualification evidence, not unattended Google
availability or reliable future site access.

## Cleanup and disposition

Cleanup was confirmed at **17:20:43–17:20:44 UTC**: normal stop/reset APIs returned 204, no live
owned-group processes remained, and `profilePresent` became false. Temporary OAuth state was
cleared, the isolated daemon exited, and its home was removed. The remaining temporary control
files, raw frames/transcripts and Google redirect identifiers were subsequently deleted. The
operator's personal login browser was not touched. No live harness remains. Cookies, credentials
and full page dumps are not part of this retained record.

**Research result observed; clean completion blocked by R10.** Independent acceptance of the live
lane and operator/release disposition remain separate. Historical offline regression passes and
prior adapter review do not cover this newly observed large-completion failure.
