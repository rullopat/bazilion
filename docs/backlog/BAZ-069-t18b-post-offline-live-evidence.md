# BAZ-069 — one authorized live attempt after offline review (2026-09-29)

**Incomplete, not accepted.** The operator explicitly authorized one bounded live T18(b) attempt after the [fifth-candidate offline review](BAZ-069-t18-offline-round5-review.md). The Agent reached Bing and recognized the delegated `Reject` choice, but all three attempted interactions were refused as stale **before dispatch**. It read no NASA source and honestly completed a blocker report. The authorization was used once; no second research turn followed.

## Admission and preflight

- Fresh isolated daemon/home on loopback, fresh operator-completed ChatGPT device-code OAuth; no personal Bazilion state, OAuth credential or browser profile copied. One selected-skills-empty, skip-bootstrap profile and one ordinary Agent on the seeded default Team, only `openai-codex:gpt-6-astra` curated/enabled, medium reasoning. Scheduler off, shell approval `dangerous` with this HTTP turn's `bashApprovalMode: auto_deny`.
- Explicitly headed installed `/usr/bin/chromium`, host display variables forwarded through the scrubbed daemon environment, normal validating SSRF proxy, `BROWSER_ALLOW_PRIVATE_NETWORK=false`. The headed direct-launch **local fixture passed 1/1** before live admission; read-only Agent browser status reported configured/headed/stopped, no profile present. A client preflight initially used the nonexistent `/browser/status` route; it was corrected to canonical `/browser` before chat admission. This was not a browser action or research turn.
- The nine fifth-review candidate hashes still matched before admission. An additional **343 daemon and wire-source files** were pinned before the turn; afterward there were **zero changed or added files in that scope**. This is source-drift evidence, not code or site verification.
- Prompt: Bing only, at most one submitted query, at most two official NASA Artemis II source pages reached from that search; maximum 24 browser / 32 total tool calls, eight minutes. No engine/provider/model/credential fallback, downloads, challenge bypass, login, payment or publication. Only browser tools permitted **by prompt restriction**, not by a new structural sandbox. The harness independently monitored time/call limits and would request cancellation; no limit was reached.
- Consent delegated by **effect**: decline clearly explained optional advertising/analytics uses; `Reject` need not literally say `Reject all`. No Accept or broader permission; unclear choice still stops. Current refs required, stale pre-dispatch refusal is not a search, and uncertain submissions must not be blindly replayed. No source URL/ref or scripted interaction sequence supplied to the Agent.

## Observed single turn

Started **20:31:01.851 UTC**, ended **20:31:52.541 UTC** (50.690 s, HTTP 200). **102 events, eight browser calls, one tool error, one terminal `done`, zero fatal/cancellation.** No non-browser tool call occurred.

| Call | Observation |
| --- | --- |
| `browser_status` | Configured/headed/stopped, no existing profile. |
| `browser_navigate` | Opened `https://www.bing.com/`; complete snapshot showed search input ref `e49`. |
| `browser_type`, `submit:true` | Agent chose `site:nasa.gov Artemis II mission`. Ref `e49` was refused as stale **before dispatch**; result explicitly said `No action was dispatched`. Fresh observation showed Microsoft cookie text: `Reject` declines the described optional advertising personalization/analytics uses. No search was submitted. |
| `browser_click` | Agent correctly selected current `Reject` ref `e71`, not Accept. Refused as stale **before dispatch**; fresh observation retained the banner. |
| `browser_snapshot`, `scope:dialog` | Read-only semantic recovery returned `dialog: scope_ambiguous`, not an actionable ref and not permission to choose a dialog arbitrarily. |
| `browser_snapshot` | Fresh full capture showed the explicit Reject control again. |
| `browser_click` | Another explicit Reject choice from that capture, again refused stale **before dispatch**. No consent selection executed. |
| `browser_snapshot`, scoped to a current ref | Ref-scoped read failed whole-document freshness; the turn emitted one tool error. No action dispatch or NASA navigation followed. |

The final response reported: no submitted search, no NASA pages read, no consent granted, and no source-grounded findings or verified NASA citations possible. It did **not** blame the exact label `Reject`, claim Bing CAPTCHA, merge earlier evidence into success, or fabricate a mission answer.

## Cleanup and disposition

Supported browser stop/reset returned 204; status confirmed stopped/no profile. Isolated OAuth was logged out, daemon exit confirmed, and the temporary home removed **only after browser retirement/reset**. Private raw frames, transcript/home, login output and daemon log were removed after composing a bounded redacted summary. No device code, credential, personal profile, raw screenshot or identifying challenge URL is retained in this report.

**T18(b) remains incomplete.** Consent teaching improved: the Agent understood the narrow delegated rejection. The live interaction still failed because document-wide freshness repeatedly rejected both search and consent controls. This is a managed-browser usability/qualification barrier, not evidence the consent choice was unclear and not justification to disable stale checks. Offline dispatch/security passes and a valid blocker-report `done` are insufficient without a same-attempt submitted search, source read and verified effective URL. Independent live-lane/operator acceptance and release approval remain outstanding. Stop live retries here; a further attempt needs fresh explicit authorization and a separately reviewed rationale/candidate, or defer the BAZ-069 live gate. BAZ-070 discovery is not a substitute.
