# BAZ-069 — T18(b) attempt 3: Bing exposes bounded-capture gap R12

> Historical failed-attempt record. [R12 remediation and independent re-review](BAZ-069-r12-remediation.md)
> now pass regression gates. No new live retry has occurred; this attempt remains incomplete.

**2026-09-28 — incomplete, not accepted.** The separately authorized Bing trial reached the
homepage but could not obtain current refs after hydration. A screenshot showed a clear Reject
cookie control; the Agent correctly declined to guess a ref, accept cookies or bypass its safety
checks. No search submission executed and no NASA source was read.

The **1,863,849-byte terminal `done` arrived intact**, followed by clean EOF and no fatal error.
This supplies useful live large-frame evidence for R10, but not a successful research journey.
A post-turn read-only diagnosis and offline reproduction identify **R12**, a remaining bounded
capture/semantic-scope gap. No production fix or further model turn was made in this attempt.

Prior records: [attempt 1](BAZ-069-t18b-evidence.md), [R10/R11 remediation](BAZ-069-t18b-remediation.md),
[attempt 2 / Google blocker](BAZ-069-t18b-retry-evidence.md). These attempts are not combined into a
single successful journey.

## Authorization, environment and limits

- Operator explicitly authorized **“go on with Bing”** after the Google blocker was reported.
  This was one separate attempt, not an automatic search-engine fallback chain.
- Fresh isolated daemon/home, normal ChatGPT OAuth connection, only `openai-codex` enabled,
  **`openai-codex:gpt-6-astra`, medium reasoning**. No paid API key or provider fallback.
  The existing personal Bazilion home was not started/modified; personal login-browser contents
  were not inspected/adopted, and that browser was not closed during cleanup.
- Ordinary Agent `fa599471-6ad0-41e5-bf87-ec33942326c4`, profile `t18b-bing`, Team `default`, no skills;
  user input/output allowed, outside-Team denied, peer default `deny_all`. Normal chat HTTP admission
  used `{conversationId: null, revision: 0}` and `bashApprovalMode: auto_deny`.
- Goal: find official NASA Artemis II material **through Bing**, read it, summarize purpose/crew/dates,
  distinguish reported events from future plans, observe source dates and verify effective citation
  URLs. No source URL, ref, selector or sequence was supplied. No Google revisit or other engine was
  allowed. Clear optional-cookie rejection was permitted, not Accept all; human-verification,
  account/payment/permission barriers and ambiguous consent required stopping.
- Browser-only prompt restrictions prohibited shell/local files, web_fetch, web_search, memory,
  messaging, MCP, downloads and publication. These are ordinary-Agent prompt restrictions, not a
  new structural sandbox. All observed calls were browser tools.
- Budget: **24 calls/eight minutes** in the goal, with external eight-minute and 32-call safety
  cancellation thresholds. Neither threshold was reached; no new research turn was issued.
- Installed **Chromium 152.0.7977.82**, headed, direct spawn/CDP production pool, normal validating
  SSRF proxy, `allowPrivate: false`, one session, fresh `profilePresent: false`. The owned process
  observation at 18:51:09.263 UTC identified PID **3188439**, private profile under
  `/tmp/baz069-t18b-bing-xwLLFd/home/browsers/<agent>/user-data`, loopback CDP/proxy and the mandatory
  `<-loopback>` proxy-bypass restriction. No headless/`--no-sandbox` flag or credential-named browser
  environment field appeared.
- Reviewed non-document source hashes matched before admission and remained unchanged through the
  trial. Only documentation was updated afterward. No proxy weakening, stealth or cookie import.

## Actual Agent sequence

**18:51:02.178–18:51:30.075 UTC**, **27.897 seconds**, HTTP 200, six calls. No parent browser actions
or reported human research assistance occurred during the turn.

| UTC | Choice / result |
| --- | --- |
| 18:51:05.728 | `browser_status`: configured, headed, stopped, no profile. |
| 18:51:08.916 | `browser_navigate` to `https://www.bing.com`. Observation `59f188a2-6cb4-4fe1-a258-2094c2a3b69b`, captured 18:51:09.801, complete with no further text. Initial UI exposed `combobox "Enter your search here - Search suggestions will show as you type" [ref=e49]`. |
| 18:51:13.308 | Agent attempted its own query `site:nasa.gov Artemis II mission crew`, `submit: true`. **Refused before dispatch because the observation was stale**: nothing was typed/submitted by this call. Fresh observation `91ac7927-ef19-4c86-868b-371c6d7b9492`, captured 18:51:14.334, explicitly said no bounded snapshot was available. |
| 18:51:16.414 | `browser_snapshot`: observation `b6987bf2-e3f5-4b3d-bd92-2c0de71fc865`, captured 18:51:17.427, again partial/unavailable, with no further chunk. |
| 18:51:20.758 | `browser_take_screenshot`: one image, result labelled `Screenshot of https://www.bing.com/`. It showed the homepage and cookie banner with **Accept**, **Reject**, **More options**. The Agent read the image; the implementation assistant later inspected the same retained image, not a new capture. |
| 18:51:23.759 | One further `browser_snapshot`: observation `ea58ea5f-9b50-47df-b12f-5a35c9f28f94`, captured 18:51:24.773, still partial/unavailable. The Agent stopped, rather than repeatedly polling or attempting an ungrounded click. |

The repeated runtime text was:

> Complete capture: NO — partial or unavailable capture; scope with a ref or read a narrower source
>
> No bounded snapshot is available for this scope. Read a narrower source or retry when the page
> has settled.

Unlike attempt 2, **no unusual-traffic/CAPTCHA page was observed**. This is not established as a
Bing anti-bot rejection or a Playwright accessibility defect. The production capture preflight
withheld a new snapshot; a visible control alone did not authorize bypassing ref freshness.

## Answer and completion

The delivered answer was:

> I reached Bing, but its accessibility snapshots failed to expose usable controls. A screenshot
> showed a clearly labelled **Reject** cookie button, but I couldn’t safely target it with a current
> browser reference. I did not accept cookies or bypass the banner.
>
> No NASA source was opened or verified, so I can’t provide the requested evidence-based summary
> or source URLs from this attempt.

For precision, the *initial* snapshot did expose a search control; subsequent captures after the
stale refusal did not supply usable refs. The diagnosis below concerns Bazilion's bounded-capture
path, rather than taking the answer's wording as proof that Bing lacked accessible controls.

Stream: **74 assistant deltas**, one `assistant_message`, six calls/six results, one valid `done`
of **1,863,849 bytes including newline**, then EOF. No fatal/error/tool_error or cancellation.
Canonical session final text matched the delivered answer; final provider stop reason `stop`;
Agent status returned to `idle`. The large history includes the screenshot. This demonstrates live
large-frame transport success; it does not establish research completion or all possible drain cases.

Seven provider responses; **61,906 reported tokens**: 12,118 input, 49,536 cache-read, 252 output,
zero cache-write; **26 reasoning tokens separately reported**, not added again to that total.
Pi catalogue estimate **$0.183316**, not an invoice or evidence of API billing. Actual transport was
subscription OAuth; account billing/quota was not inspected.

## R12 — post-turn diagnosis and offline reproduction (open at time of attempt)

At **18:55:01.515 UTC**, after the Agent had finished, a separate **read-only diagnostic** queried the
existing immutable Bazilion instrumentation in the same managed tab. The controller matched the
owned process argv/private profile, used its loopback CDP target, and required the target URL to be
exactly `https://www.bing.com/`. It read only numeric instrumentation stats for fixed roots and then
disconnected. No navigation, cookie click, screenshot, raw HTML collection or provider call occurred.
This diagnostic is **not an Agent capability or part of its research journey**, and did not supply
new instructions to the Agent. It was not a personal-browser attachment.

Instrumentation was present; all returned roots shared generation **527**:

| Measured root | Nodes | Estimated `textChars` |
| --- | ---: | ---: |
| Whole document | 9,762 | 674,703 |
| `body` | 9,679 | 508,058 |
| Native `main` | absent | absent |
| `[role="main"]` | 308 | 17,649 |
| `[role="dialog"]` | 23 | 992 |

`SessionObservations.capture` currently uses **whole-document stats as the preflight for body
serialization**, then falls back to CSS **`main` only**. In this measured state, the whole document
exceeds the character estimate threshold while the actual body fits the current preflight thresholds
(10,000 nodes / 524,288 estimated characters). Native `main` is absent despite a small ARIA main
region and a tiny dialog being present. The default capture neither measures the actual body for
its budget nor discovers those semantic regions. Ref-only scoping is unusable when no current ref
for the visible control can be obtained.

An **offline** invocation of the production capture class, with an injected Page returning these
recorded stats, reproduced the same unavailable result with **zero accessibility serializations**.
The measured call sequence was `document stats` → `main stats`; body, ARIA main and dialog were not
queried. This demonstrates the code-path gap against the post-turn measurements. It does **not**
claim the exact same numeric state at every earlier refusal, nor measure actual serialization size:
DOM character estimates are not UTF-8 byte counts, and the hard retained-byte clamp must remain.

Credential-free reproduction recipe: inject document stats `{nodes:9762,textChars:674703}`, body
stats `{nodes:9679,textChars:508058}`, null for `main`, and the small role-root stats above, all with
a common valid `docId`/generation, into `SessionObservations.capture`'s Page interface. Stub body
attachment as ready and count `ariaSnapshot` calls. The current code returns the unavailable message
without calling `ariaSnapshot`, requesting only document and native-main stats. No Bing request or
model call is needed to reproduce this branch.

**Engineering work identified at the time (subsequently implemented and reviewed in the linked
remediation):** budget the actual requested subtree while retaining
whole-document freshness/coverage checks; recognize ARIA landmarks; provide a bounded, ref-independent
way to observe actionable semantic regions such as a consent dialog when a broad capture is unavailable;
and distinguish scope absence, over-budget estimates and missing stats in refusal diagnostics. Add
synthetic oversized-head/hydrated-page/dialog tests and independent review. Do **not** raise bounds,
serialize known oversized scopes, reuse stale refs or add unvalidated screenshot-coordinate actions
merely to force this trial through. R12 is not covered by the earlier R1–R11 closure reviews.

## Cleanup and disposition

**18:57:54.845–18:57:55.016 UTC:** browser stop **204**, no live owned browser-group processes;
confirmed reset **204**, `stopped`, `profilePresent: false`; temporary OAuth cleared locally and
confirmed disconnected. The daemon's argv/home identity was checked, it was signalled through a
pinned pidfd, and exit was confirmed before removing its temporary home. The remaining raw frames,
screenshot, diagnostics and control directory were subsequently deleted after this redacted record
was written. Personal login-browser state was not removed. No live Bing trial remains to resume.

**T18(b) remains incomplete.** R10 has clean live large-output evidence; safe stale-ref refusal and
honest stopping are observed. R12 prevented this attempt from completing the source-reading
lane. Its later fix/re-review does not retroactively complete this journey; a new authorized live
attempt must still demonstrate full research success.
Independent successful-live-lane/operator acceptance, installer/UI/macOS and release remain separate.
