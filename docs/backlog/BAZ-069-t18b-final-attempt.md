# BAZ-069 — T18(b) final authorized attempt (2026-09-29)

**Incomplete, not accepted.** The operator confirmed one final Bing-only NASA Artemis II research attempt on the ChatGPT subscription (`openai-codex:gpt-6-astra`, medium reasoning; eight minutes / 32 total calls, 24 browser calls). It completed with a valid terminal `done` but **never reached Bing or read a source**. Do not count it as the required browser search-to-source journey.

## Setup and observed turn

- Fresh isolated daemon/home and fresh operator-completed device-code OAuth. Only `openai-codex:gpt-6-astra` was enabled/curated; a skip-bootstrap selected-skills-empty profile and one ordinary Agent were spawned on the default Team. No personal Bazilion state or browser profile was copied. Scheduler off; browser configured explicitly headed with `/usr/bin/chromium`. The Agent was instructed to use Bing only, research official NASA Artemis II material, use only browser tools, reject optional cookies only if clearly labelled, and stop at blockers. Shell approval was `auto_deny`. Browser-only was a **prompt restriction**, not an additional structural sandbox.
- The isolated daemon was launched with a scrubbed environment that **mistakenly omitted the host's `DISPLAY`, `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR`** even though those values were set in the launching shell. Explicit headed mode therefore reported `browser_display_unavailable` on the first `browser_status` call. This was harness/setup error, **not evidence of a Bing site failure or browser-product defect**.
- Turn started at 17:39:34 UTC and finished at 17:39:44 UTC (10.189 s, HTTP 200). One browser call (`browser_status`), zero tool errors, no cancellation/fatal, one terminal `done`. The Agent reported the display limitation accurately and explicitly did not claim a search, NASA visit or citation. No research retry was made under this authorization.
- Before the turn, SHA-256 digests for 395 source files were pinned; no digest drift was observed afterward. No browser profile slot was created. The isolated OAuth credential was cleared, the isolated daemon stopped and its temporary home removed after recording this redacted outcome. No token, device code, personal profile, raw frame or identifying challenge URL is retained in this report.

## Disposition

T18(b) remains incomplete; earlier human-assisted source reading with a failed terminal frame and later clean blocker completions cannot be combined into a pass. The operator said this would be the last attempt. A repaired headed environment and **new explicit authorization** would be required for any additional live turn; do not assume one. Independent live-lane/operator acceptance and release decisions remain outstanding.
