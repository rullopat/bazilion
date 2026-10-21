# BAZ-069 — T18(b) attempt 2: autonomous consent, Google blocker, clean completion

**2026-09-28 — T18(b) remains incomplete.** The real Agent autonomously selected Google's
operator-authorized **Reject all** choice, submitted its search, reported an unusual-traffic
human-verification barrier and stopped. The turn produced a valid terminal `done` and no fatal
error. **No NASA source was reached or read**, so this is not the required complete research journey.
No next qualification gate or release is accepted on this evidence. A later, separately authorized
[Bing attempt](BAZ-069-t18b-bing-evidence.md) also stopped before source access, exposing the
R12 bounded-capture gap, not another observed CAPTCHA. [R12 remediation/re-review](BAZ-069-r12-remediation.md)
now passes regression gates; a new full successful live journey remains required.

This follows [attempt 1](BAZ-069-t18b-evidence.md), which delivered research but failed terminal
completion, and the [reviewed R10/R11 fixes](BAZ-069-t18b-remediation.md). The two attempts must not
be spliced together and called one clean successful journey.

## Authorization and admission

- Operator: **“ok then, continue the T18(b) verification”**. Subscription-only transport remained
  mandatory; the previously delegated optional-cookie rejection remained in force.
- Fresh isolated daemon/home and managed browser profile; the existing personal Bazilion home was
  not started or modified. Prior trial credentials/profile had already been deleted.
- Normal ChatGPT OAuth connection completed. The only enabled provider was `openai-codex`, using
  `openai-codex:gpt-6-astra`, **medium** reasoning. No paid API key or provider fallback was supplied.
  Provider connection is setup, not autonomous research evidence; personal login-browser contents
  were not inspected/adopted and that browser was not closed by cleanup.
- Ordinary authenticated `/api/agents/:id/chat` admission with current conversation selection
  `{conversationId: null, revision: 0}` and `bashApprovalMode: auto_deny`. Agent
  `bc4b4cfc-a963-40bc-8f64-3065235dca60`, profile `t18b-research`, Team `default`; empty selected skills,
  user input/output allowed, outside-Team communication denied and peer default `deny_all`.
- Goal: use Google to find and read official NASA Artemis II material; summarize purpose, crew and
  dates with citations, distinguish reported events from future goals, and verify effective URLs.
  No NASA destination, refs, selectors or navigation/tool sequence was supplied. The goal explicitly
  delegated the clearly labelled localized **Reject all**, not Accept all or other permissions.
- Browser-only prompt restrictions prohibited local files/shell, web_fetch, web_search, memory,
  messaging, MCP, downloads and publication. These were prompt restrictions on an ordinary Agent,
  not a newly claimed structural capability sandbox. All observed tool calls were browser tools.
- Budget: at most **24 browser calls / eight minutes** in the goal; external eight-minute cancellation
  and a 32-call safety ceiling. Neither cancellation threshold was reached. No subsequent research
  turn, alternate-engine attempt or challenge interaction was issued.
- All reviewed non-document dirty-file hashes matched the R10 review manifest before the trial.
  Two setup-controller mistakes were recovered before any model turn: an invalid `peerDefault:
  none` was rejected with HTTP 400, then a display-only lookup of `model` on the spawn entity raised
  KeyError after successful creation. Admission was checked through the resolved-Agent API; no
  production patch or duplicate research request followed from either harness error.

## Browser provenance and privacy

Installed **Chromium 152.0.7977.82 (Arch Linux)**, explicit headed mode, direct installed-browser
startup followed by CDP attachment through the production pool. Browser status initially showed
`profilePresent: false`. Normal validating SSRF posture remained enabled, `allowPrivate: false`,
with one permitted session.

A process observation at **18:37:02.424 UTC** identified owned browser PID **3177970** with its
isolated `--user-data-dir` under `/tmp/baz069-t18b-retry-RGsmIJ/home/browsers/<agent>/user-data`,
loopback CDP, the validating proxy and `--proxy-bypass-list=<-loopback>`. No `--no-sandbox` or
headless flag appeared; no token/secret/API-key-named environment entry was present. There was
no personal-profile attachment, cookie import, proxy weakening, stealth change or engine fallback.

## Actual Agent sequence

Turn: **18:36:56.347–18:37:20.083 UTC**, **23.736 seconds**, HTTP 200, five browser calls.
No parent-script navigation or reported human research assistance occurred.

| UTC | Agent choice / observed result |
| --- | --- |
| 18:36:59.779 | `browser_status`: configured, headed, stopped, no existing managed profile. |
| 18:37:02.020 | `browser_navigate` to `https://www.google.com/`. Observation `394fb99a-40e3-41f3-a77e-3b2ab58d131e`, captured 18:37:03.414, complete with no further text. The Polish consent UI exposed `button "Odrzuć wszystko" [ref=e134]` and separate `button "Zaakceptuj wszystko" [ref=e135]`. |
| 18:37:07.405 | Agent chose `e134` (Reject all). The runtime **refused the stale observation before dispatch** and returned fresh observation `e4625dad-7b53-40c2-b9a6-6ca8cb09e960`, captured 18:37:07.424. Its current `e134` still explicitly named **Odrzuć wszystko**. This was not an executed click or an uncertain-action replay. |
| 18:37:10.687 | Agent clicked current `e134` with the new observation id. Post-action observation `283e487e-393d-4d7b-a9b3-74fabcb387cb`, captured 18:37:10.734, showed the Google search UI without the consent dialog and `combobox "Szukaj" [ref=e151]`. No renewed operator approval was requested. |
| 18:37:15.251 | Agent typed its own query, `site:nasa.gov Artemis II mission crew dates`, into current `e151` with `submit: true`. Observation `59bb776e-e279-4c5b-9350-48c6ed06bb65`, captured 18:37:15.888, reported the unusual-traffic barrier. |

The blocker capture said:

> Our systems have detected unusual traffic from your computer network. This page checks to see
> if it's really you sending the requests, and not a robot.

The identifying challenge URL, IP address and query nonces are intentionally not retained here.
The Agent did not interact with a challenge, repeatedly reload, switch engines, guess a NASA URL
or invent source evidence. The cause of Google's decision was **not established**.

## Delivered result and protocol completion

The Agent's delivered answer was:

> Google blocked the search with an “unusual traffic” human-verification page. I stopped without
> attempting to solve or bypass it, as requested.
>
> I successfully selected Google’s Polish **“Odrzuć wszystko” (Reject all)** control, but reached
> no NASA source. I therefore cannot provide a substantiated mission summary, source dates, or
> verified NASA URLs from this attempt.

Stream evidence: **76 assistant deltas**, one `assistant_message`, five calls/five results, one
`done` of **24,993 bytes including newline**, no fatal/error/tool_error, then clean EOF. Canonical Pi
session final text matched the delivered answer, final provider stop reason was `stop`, and the
resolved Agent status afterward was `idle`.

This is clean **blocker-report completion**, not clean **research completion**. The live `done` is
smaller than attempt 1's failing terminal frame; the reviewed large-frame regression, not this
small live frame alone, supplies large-output drain evidence. No NASA post-click capture occurred,
so this attempt does not live-exercise R11 at NASA. No source URL verification or source-date reading
was possible or claimed. Cookie selection was observed; persistence across restart was not tested.

## Usage

Six provider responses; **64,582 reported tokens**: 14,770 input, 49,536 cache-read, 276 output,
zero cache-write/reasoning tokens reported. Pi's catalogue estimate was **$0.211036**, not a bill or
proof of API charges. The configured transport was ChatGPT subscription OAuth; actual account
billing/quota was not inspected.

## Cleanup and disposition

**18:39:28.067–18:39:28.243 UTC:** browser-stop API returned **204**, followed by a check finding no
live owned browser-group process. Confirmed profile-reset API returned **204** and status showed
`stopped`, `profilePresent: false`. Temporary OAuth was cleared locally and disconnected status
verified. The isolated daemon's argv/home identity was checked and termination used a pinned
pidfd; daemon exit was confirmed before the temporary home was removed. The remaining temporary
control/raw-evidence directory was subsequently deleted after recording this redacted account.
Personal login-browser state was not removed. No live research harness remains to resume.

**Observed:** autonomous delegated consent, stale-ref refusal/re-observation, genuine Agent query
selection, honest stopping at Google's barrier, valid terminal completion and cleanup.

**Still missing:** one full successful current-candidate live research journey and its independent
live-lane/operator acceptance. Google is a permitted result-or-blocker observation under T18, not
a guaranteed anti-bot success; completing the source-reading lane requires a separately authorized
attempt/scope, not a silent fallback chain. Installer/UI/macOS and release gates remain separate.
