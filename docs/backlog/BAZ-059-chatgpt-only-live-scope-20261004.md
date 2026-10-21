# BAZ-059 — operator-approved ChatGPT-only live qualification

## Decision

After the three ChatGPT images were visually accepted, the operator asked whether OpenAI-only
qualification could avoid OpenRouter, then clarified that the existing ChatGPT login should suffice.
The proposed decision was to make **ChatGPT-only live qualification** the required BAZ-059 scope,
leaving the direct API and OpenRouter routes explicitly live-unqualified. The operator approved:
**“I'm fine reducing the scope.”**

This supersedes the former requirement for a live sample of every advertised selection in BAZ-059
(test 9 and the carried 0.23.0 image-qualification lane). It does **not** narrow the rest of the
original 0.23.0 slate, grant further requests or authorize a release.

## Revised live gate and evidence

Required live route: **`openai-codex:gpt-image-2` with the existing ChatGPT login**; no OpenAI API key
or OpenRouter account required. The authorized evidence now covers:

- Original generation, canonical completed-stream Result, authorized release, matching restart/
  download hash, operator visual acceptance and independent bounded source-evidence review.
- Same-conversation text-guided rework saved separately, original preserved through both restarts,
  matching new-file hash and operator visual acceptance. No pixel/reference-image edit claim.
- Product-owned **protected HTTP** execution, actual protected worker observation and bounded
  scrubbed-environment check, completed-stream Result/restart hash and operator visual acceptance.
  This does not qualify scheduled/inbox execution or every protected origin.

See the [current matrix](BAZ-059-qualification-status-20261004.md),
[original successful trial](BAZ-059-recovery-trial-20261004.md) and
[rework/protected trials](BAZ-059-rework-and-protected-trials-20261004.md).

**The revised required subscription live samples and operator inspections are satisfied.** Earlier
failed/uncertain attempts remain failures and must not replay. New rework/protected evidence has not
received a separate independent live-evidence review; no broader review/usability claim is added.
Exact geometry remains outside scope; observed dimension mismatches are retained, not repaired.

## Optional routes — not passed, not removed

| Selection | Current qualification | Required for this live gate? |
| --- | --- | --- |
| Direct OpenAI `openai:gpt-image-2` | Implemented and deterministically tested; live-unqualified | No; deferred optional live qualification |
| OpenRouter `google/gemini-3.1-flash-image` | Implemented and deterministically tested; live-unqualified | No; deferred optional live qualification |
| OpenRouter `openai/gpt-image-2` | Implemented and deterministically tested; live-unqualified | No; deferred optional live qualification |

No adapter, automatic-selection rule, credential gate, tool admission, limit or disclosure policy
changes. No new schema or provider request. Optional paid trials require a future explicit decision,
named credential/account-side spending controls and bounded authorization. Never count synthetic
coverage as a live pass or silently fall back from ChatGPT to these routes.

## Release and operating boundaries

The implementation/offline/package/security evidence retains its existing bounds. BAZ-059 remains
in the in-progress ledger for release closeout; this decision does not publish its current changes,
rerun CI, prove every platform/account, or satisfy BAZ-064/065/068. The original broader 0.23.0
release slate remains intact; final candidate/platform/release gates and release authorization remain
separate. No version, commit, tag, publication, deployment, home reset, credential import or logout.

Images remain off, existing account/home/Results preserved. **No further generation is authorized
or queued by this scope decision.**
