# BAZ-069 — subscription-native trial, 2026-10-03

## Disposition

**Failed research qualification; clean blocker-report completion. T18(b) remains unchecked.**
One authorized ordinary Agent turn ran. Native discovery returned a sanitized provider/protocol
failure, with no hosted-search receipt. The Agent stopped, read no source and did not retry or
fall back. No second turn or separate provider smoke was issued.

## Authorization and candidate

The operator authorized one ChatGPT-subscription trial, then reported removing the incompatible
Bazilion home and completing normal ChatGPT login on the fresh home. The research scope was
NASA Artemis II, eight minutes, at most four search invocations and 32 total tools, no
Brave/SearXNG/browser/MCP/Firecrawl, account/model fallback, challenge/login handling during
research, file downloads, publication or automatic search replay.

- Linux, source daemon bound to `127.0.0.1:4321`; fresh `/home/patri/.bazilion`, no credential
  import/copy or legacy-schema migration. Scheduler off; browser/image generation disabled;
  MCP lists zero servers. No raw credential/account identifier is recorded here.
- Explicit **`openai-codex:gpt-6.1-sol` / medium**, existing ChatGPT subscription account via
  normal daemon-owned OAuth connection. Native requested mode **cached**, observed mode unknown.
  Provider-owned networking is not browser-proxy-contained.
- Dedicated empty-skill Profile/Team, no bootstrap conversation, one ordinary Agent:
  `b703391e-1f3b-4df6-a1ba-2ecff71155c4`. The research prompt supplied a goal and restrictions,
  not a source-page URL, query string or scripted tool-call sequence.
- Local dirty-worktree `HEAD ee2a896`. New source/dependency/test manifest:
  `/tmp/baz069-native-trial-prep-u3k9wy/candidate.sha256`, manifest SHA-256
  `b23fb60930ca56111cd5698beb4786672a92158a19c15c0709c7d4238a2bd351`.
  Pins checked unchanged before/after the trial. Fresh root/web types, full suite
  **2,301 passed / 47 skipped** and security **261 required cases** passed before dispatch.
- The previous reviewed freeze and packed artifact were absent. This newly pinned/revalidated
  source candidate is **not proof of identity with that historical freeze**, a new independent
  review, fresh packed qualification or release approval. That limitation is not waived.

## Observed same-attempt evidence

- Window: **07:29:32.415–07:29:57.572 UTC**, **25.157 seconds**.
- Normal authenticated `POST /api/agents/:id/chat`, HTTP 200, one request/turn. An exclusive
  local attempt-issued marker prevents accidental harness replay.
- Exactly **one tool call**, `web_search`, with Agent-chosen query
  `NASA Artemis II mission crew launch splashdown dates 2026`, count 6 and
  `allowedDomains: ["nasa.gov"]`.
- Result: **`web_search: native provider/protocol unavailable; no retry or fallback`**.
  No HTTP status, upstream terminal response, hosted-search execution item, usage receipt or
  citations were exposed. The exact underlying network/protocol/parse failure is **unknown**;
  this does not establish account entitlement denial or an unsupported model.
- Canonical Pi transcript agrees: one error tool result, no `details.webSearch` or
  `details.webFetch`, two parent assistant responses using `openai-codex:gpt-6.1-sol`.
  Parent-model completion works on this attempt; native search compatibility remains unqualified.
- **Zero source reads**, no source effective URL or facts verified, no browser/source fallback.
  The final answer explicitly reported the blocker and made no NASA factual summary.
- Exactly **one clean `done`**, clean NDJSON EOF, no fatal/error/cancellation or incomplete frame.
  Received stream: **9,230 bytes**. The error tool result still means research failed;
  clean transport/blocker reporting is not successful T18(b).
- Parent usage: **12,057 total tokens** (6,185 input, 112 output, 5,760 cache read, zero cache
  write). Pi catalog estimate **$0.014066**, not an invoice or proof of API billing. No native
  search usage is known; absence of a receipt is not evidence of zero provider-side usage.
- The prompt and external watchdog enforce stopping expectations; native requests retain their
  30-second/512-character/1–8-citation/2-MiB-upstream/32-KiB-output bounds. The streaming monitor
  is not a pre-dispatch per-tool capability gate or hard quota. This attempt stayed well within
  the envelope and never exercised that limitation.

## Cleanup and retention

At **07:30:56 UTC**, the Agent was idle, browser disabled/stopped with no profile, MCP zero.
The normal archive API succeeded and the Agent is archived. The daemon had **no direct worker
children** afterward. No browser or auxiliary search process was launched, and no live trial
harness remains.

The fresh operator daemon/home and newly connected OAuth account remain available to the
operator; no logout/reset/removal of the new home was performed. Canonical transcript is retained
privately for inspection. Bounded harness summaries/control files are under
`/tmp/baz069-native-trial-prep-u3k9wy`; no OAuth credential, browser profile or full upstream
diagnostic body is included in the evidence package.

## Next work

Diagnose the native adapter offline and add narrow sanitized phase/error evidence where needed;
do not guess the cause from a generic refusal. Any repaired candidate needs fresh pins,
relevant regression/review disposition and **new explicit one-attempt live authorization**.
Do not switch account/model/transport, enable another provider/browser, or repeat this trial
under the exhausted authorization. API-key qualification, operator UI acceptance, independent
evidence acceptance and release/publication remain separate.
