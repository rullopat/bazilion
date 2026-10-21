# BAZ-069 — strict Codex terminal alias implemented (2026-10-03)

## Subsequent authorized T18(b) attempt

[The fresh post-alias attempt](BAZ-069-native-t18b-post-alias-trial-20261003.md) subsequently
passed decode and refused at the hosted-search execution-ID gate: missing, duplicate or
excessive evidence. One search, no receipt/source read, clean blocker `done`, archived/no worker.
Reviewed pins unchanged; no exact terminal name/count/body retained. T18(b) still failed/
unchecked and that new authorization exhausted. The implementation/review record below is
historical engineering evidence, not a live pass or permission for another request.

## Disposition

The operator authorized completing the `response.done` implementation recommended by the
[ordered review/assessment](BAZ-069-native-parser-review-and-terminal-assessment.md).
**Implemented, independently reviewed and offline validated.** No T18(b) research/provider
compatibility call ran; live effectiveness, entitlement, packed qualification and T18(b)
remain unproven. Prior live authorizations remain exhausted.

## Narrow production change

`apps/daemon/src/lib/native-search.ts` passes the admitted provider into `completedResponse()`.
Within SSE decoding, `response.done` and `response.completed` now enter the same terminal
branch **for Codex only**. `response.done` is explicitly refused on the API-key route, including
before or after a `response.completed` frame. There is no JSON-envelope alias or decoder retry.

Only the terminal **name** is aliased. The response object is never rewritten; projection still
requires explicit `status: completed`, matching model, valid response identity, completed hosted
search and valid domain-scoped citations. Missing/unknown/queued/in-progress/failed/cancelled/
incomplete status, response errors, absent search/citations or unadmitted capability still refuse.
`response.incomplete` is never normalized into success.

Parsing continues through the **entire bounded stream** after either terminal. Duplicate or
mixed terminal names in either order, later failures/data, response identity drift, bad event
labels/framing, premature/duplicate DONE and events after DONE refuse. A terminal arriving before
a stalled/oversized stream ends is not enough to return success. Existing raw/decoded secret
filtering, byte/deadline/cancellation checks, active-turn revalidation and one-request/no-replay
remain unchanged. No endpoint/header/UA/compression/transport/account/model/request changes.

This closes a demonstrated offline compatibility gap with Pi 1.0 without copying its permissive
status mapping or early terminal return. It does not prove that the earlier saved live response
contained `response.done`, because that body was deliberately not retained.

## Tests and independent review

- Updated actual pinned SDK comparison fixtures: both valid terminal names now produce native
  search evidence under absent/blank/explicit SSE MIME. Native directly refuses statuses that
  the SDK maps to `stop`, no-search responses and later errors.
- Five new required cases cover duplicate/mixed terminals, full-stream framing/identity/DONE,
  provider/media/JSON scope, evidence/privacy and limits/cancellation after an early terminal.
  Turn-bound subscription host tests now cover both names and drift refusal.
- Independent ephemeral read-only Codex review (`gpt-6.1-sol`, medium), isolated exact source/test
  bundle, user config/rules ignored, hosted search disabled, no research/network tools or home/
  credential inspection. Reviewer model inference was remote; no credential copied/imported.
- **Accepted narrowly; no actionable findings.** Reviewer reports **36 standalone synthetic
  JavaScript checks passed** using parser transcription/strict status gate; repository tests
  and pinned SDK were not independently run in the dependency-free bundle.
- Two nonblocking test suggestions were added afterward: standalone native status refusals
  for both MIME forms, and direct post-alias `error`, `response.incomplete`, `response.cancelled`
  cases for both MIME forms. Production remained byte-identical to the reviewed copy.
- Review artifacts: `/tmp/baz069-terminal-alias-review-FTDWzj/`. Report SHA-256:
  **`ac115b9853cdea012596e9dae9aab3f6b321438e42ec0fca461135c81ec6ccd5`**.
  Reviewed/current `native-search.ts` SHA-256:
  **`74671ae86b6a32685670846f9dc789c8ae8f3e674dc9de67b1d3ac724f451472`**.
  Review scope is the alias delta, not whole-tree/live/packed approval.

## Final validation and candidate

- Focused native/format/transport/terminal/real-worker suites: **126 passed / five files**.
- Root/web typechecks passed. Scoped Biome passed with three existing template-style infos;
  `git diff --check` passed. No whole-tree lint claim.
- Full `pnpm vitest run --maxWorkers=4`: **2,338 passed / 47 skipped**, **270 files passed /
  seven skipped**, exit 0.
- `pnpm security:acceptance`: **298 required cases passed**, exit 0.
- Logs and source/dependency/test manifest: `/tmp/baz069-terminal-alias-iQDvJ5/`.
  `candidate.sha256` SHA-256:
  **`42362e068e2d6f2a7937b5cb0805a40004012294905f6f43290a8a00b1cec67f`**.
  Old repair/assessment manifests are historical, not pins for this new production change.
- The existing real-worker composition still uses its API fixture; subscription terminal paths
  are tested through actual native/turn-bound daemon hosts and pinned SDK fake fetch, not
  claimed as a new real-worker Codex or live run.

## Operator state and next step

Owned idle daemon gracefully stopped for the known default-port test isolation requirement,
then restarted on 127.0.0.1:4321 with scheduler/browser/image disabled and native auto/cached.
Existing operator home and connection preserved; passive protected status reports ChatGPT
connected without provider refresh/compatibility probe. No new Agent/research turn was created.

No further known implementation change is required by these two reviewed findings. A fresh
**source engineering** T18(b) attempt can be considered after explicit bounded authorization
and pin/readiness checks; packed qualification/operator acceptance remain separate and must
not be inferred from that authorization. Actual native search → guarded official NASA source
read → verified source facts/effective URL → cited answer → clean same-attempt `done` is still
mandatory. Another protocol/evidence/provider blocker may emerge; never retry or fall back
without the approved boundary.
