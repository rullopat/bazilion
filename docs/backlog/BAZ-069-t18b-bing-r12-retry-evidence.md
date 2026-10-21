# BAZ-069 — T18(b) post-R12 Bing retry (2026-09-29)

**Incomplete, not accepted.** User explicitly requested “try again the bing verification.” A fresh
isolated ChatGPT-subscription-only trial eventually reached Bing, but the Agent did not submit a
search or read NASA. Its final limitation report and terminal `done` completed cleanly; they are
not a successful source-reading/effective-URL journey. No automatic engine switching, challenge
bypass, guessed control or proxy relaxation occurred.

## Admission and setup chronology

- Isolated home #1 was bootstrapped; an initial normal OAuth request timed out (HTTP 400,
  disconnected). The operator's first “done” did not make that expired request valid. A second
  normal OAuth request succeeded (HTTP 200, connected) after the operator's second “done”. No
  existing personal browser/profile was attached or imported.
- Only curated `openai-codex:gpt-6-astra`, medium reasoning; selected skills empty, Team default,
  user input/output enabled and peer default `deny_all`; no paid API key or provider fallback.
  Current Agent selection was verified by the daemon API. Chromium was configured **headed**,
  fresh managed profile, installed browser path `/usr/bin/chromium`; default private-network
  policy and validating proxy were not relaxed. Source hashes were frozen/checked before the turn.
- First home/controller **mistakenly treated the daemon's leading blank NDJSON keepalive as JSON**
  and cancelled before any event or browser tool. A follow-up request was refused
  `workspace_recovery_required`; no bypass of that lease was attempted. The daemon was stopped
  after clearing local OAuth and confirming the managed browser never started. After shutdown,
  read-only SQLite inspection found one unconfirmed worker resource whose recorded PID was absent.
  This was a harness/controller failure, **not** a successful or witnessed Agent research turn.
- A new isolated home was then created; a fresh normal OAuth login completed (HTTP 200,
  connected) without credential copying. An initial Agent, accidentally spawned with the default
  BOOTSTRAP.md, answered only “Hi! What should I call myself?” with a valid `done`, no tools. It
  was not counted as a Bing journey. A different new profile with `skipBootstrap: true` and new
  ordinary Agent was created on the same clean Team. The research turn used current conversation
  selection, auto-denied shell approval, and an eight-minute/32-call external ceiling plus a
  24-browser-call/eight-minute goal budget. Browser-only wording was a **prompt restriction**, not
  a new structural capability sandbox.

## Actual research turn

Agent `c322b9a0-dc2c-4edf-b6f4-28a56a9e9298`, started
**2026-09-29 16:04:28 UTC**, elapsed **35.107 s**; HTTP 200. Seven browser calls:

1. `browser_status`: configured, headed, stopped, fresh profile.
2. Navigated to `https://www.bing.com`; complete snapshot at 16:04:35.419 UTC,
   observation `61bb324d-ed72-4770-ae6f-2823e06aac42`, showed a search combobox `e49`.
3. Attempted to type/submit `site:nasa.gov Artemis II mission crew launch splashdown` using that
   observation. **Refused stale before dispatch**; fresh broad snapshot unavailable:
   `body: scope_over_budget; main: scope_ambiguous`.
4. Requested `browser_snapshot {scope:"search"}`. **R12 recovery worked:** a bounded partial
   search-region snapshot at 16:04:42.296 UTC, observation
   `df80d788-1ef6-4ced-a525-64145c1ad1ab`, exposed the active search combobox `e49`.
5. Retried type/submit on that fresh observation. Again **refused stale before dispatch**, with
   broad capture unavailable for the same budget/cardinality reasons. No search submission is
   established by either call.
6. Requested `scope:"dialog"`; refused `scope_ambiguous` (more than one accessible dialog).
   The runtime chose no arbitrary dialog and exposed no current dialog ref; no cookie decision
   was made. No human verification or cookie text was read in this lane.
7. Requested `browser_take_screenshot {}`. Tool error: full image **2472×1973** would decode to
   roughly **19 MiB**, over the **8 MiB** image bound. The tool suggested a viewport screenshot;
   the Agent stopped rather than issuing another call. No image was delivered.

The final answer accurately reported these limitations, no NASA source or verified URL and no
mission-purpose/crew/date claims. Stream: **201 events**, seven tool calls, six tool results, one
tool error, 185 deltas, one assistant message, **one valid 9,909-byte terminal `done`**, no fatal or
cancellation; canonical last-message content matched the final answer. Agent was idle afterward.
The failure is not established as Bing anti-bot/CAPTCHA. R12's semantic recovery functioned, but
Bing changed between two search observations and action checks, and `main`/`dialog` role queries
were ambiguous. Stale refusals are safety outcomes; do not weaken whole-document freshness or
silently pick one region merely to complete the trial. The screenshot-size refusal is a separate
bounded-output outcome, not evidence of an image capture.

## Cleanup and disposition

Source hashes matched at end. Research Agent's managed browser was stopped (HTTP 204), profile
reset confirmed (HTTP 204, `profilePresent:false`), isolated OAuth cleared locally, and isolated
daemon argv/home identity checked before pinned pidfd termination and observed exit. The first
home's daemon had likewise exited after OAuth clearing; its cancelled-turn worker PID was absent.
No owned browser/group remained in the recorded temporary roots. Both temporary homes, OAuth credentials, tokens, raw frames and control scripts were deleted
after this redacted report; associated daemon processes had exited and no root-associated browser
process remained. `git diff --check` passed.
The personal OAuth login-browser state was not inspected, closed or adopted.

**T18(b) remains incomplete.** R12 engineering tests/review remain valid within their scope, but
they did not guarantee a live Bing source journey. A new remediation/review or explicit acceptance
of this legitimate dynamic-site limitation should precede any further authorized live retry.
Independent live-lane/operator acceptance, installer/UI/macOS and release decisions are separate.
