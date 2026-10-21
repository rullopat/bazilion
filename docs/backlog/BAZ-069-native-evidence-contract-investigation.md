# BAZ-069 — offline search-evidence contract investigation and repairs (2026-10-03)

## Subsequent upstream-consumer correction

[Deeper OpenClaw comparison](BAZ-069-openclaw-stream-evidence-comparison.md) subsequently found
source/test support that the inspection below missed: completed streamed items survive empty
terminal lists in the managed Codex collector, and direct Responses preserves streamed text.
The earlier conclusion that no inspected reference supports terminal omission is superseded;
execution proof need not be duplicated in terminal output. A strict completed-item accumulator
is recommended, not implemented here. Contradiction/privacy/framing hardening remains valuable;
no progress-only/prose-only acceptance, implicit route change or further live call is authorized.

## Subsequent authorized observation

[The post-evidence T18(b) retry](BAZ-069-native-t18b-post-evidence-trial-20261003.md) subsequently
observed one completed streamed hosted-web item but **zero output items in `response.completed`**;
reconciliation refused. No successful search/source receipt, clean blocker `done`, no retry/
fallback. Authorization exhausted, T18(b) still unchecked. This new attempt-specific evidence
does not establish earlier bodies or a safe supported reconstruction contract. The offline
investigation below remains historical; no production proof requirement was relaxed.

## Outcome and limits

The operator requested offline investigation and repair after the
[post-alias T18(b) attempt](BAZ-069-native-t18b-post-alias-trial-20261003.md) reached evidence
validation but refused the combined missing/duplicate/excessive search-ID predicate.

**Confirmed consistency and diagnostic defects are repaired; final independent review accepted.**
No new live research/provider compatibility request ran. The exact live failure remains unknown:
no raw upstream body or structural inventory survived that attempt. We did **not** assume the
provider omitted terminal execution items or make that hypothetical omission acceptable.
T18(b), account entitlement, packed/operator acceptance and live effectiveness remain unqualified.

## Offline contract findings

Inspected only locally available source/reference artifacts:

- Official Responses definitions in locally present OpenAI **7.19.0** declare `response.output`
  as generated output items and `web_search_call` with `id`, `status`, and an action whose type
  is `search`, `open_page`, or `find_in_page`. Search permits `queries`, deprecated `query` and
  optional sources. Our execution gate does not require either query spelling.
- `response.output_item.done` supplies the item and `output_index`. Web-search lifecycle events
  (`in_progress`, `searching`, `completed`) supply item identity/index but **no action or citations**;
  a completed marker alone does not prove a search rather than another web action.
- Locally present official OpenAI **6.40.0** `ResponseStream` accumulates a provisional snapshot
  then **replaces it with the terminal response**. These are local reference package versions,
  not a claim that Bazilion's Pi transport imports either official SDK at runtime.
- Pinned Pi **1.0.0** consumes streamed completed message/reasoning/function items for chat, but
  is not Bazilion's hosted-search proof projector. Its handling of chat items cannot establish
  that terminal hosted-search omission is a supported contract.
- The previously pinned OpenClaw source injects the hosted `web_search` declaration with mode/
  domain settings; it neither supplies our execution-evidence checks nor proves entitlement.

**No source establishes that this live failure can be fixed by unioning streamed items into an
incomplete terminal, treating lifecycle markers as execution, or using provider prose/citations
alone.** No such compatibility relaxation, reconstruction, ID synthesis or deduplication was added.

## Reproduced defects and implemented repairs

A self-contained reproduction evaluated the exact prior reviewed adapter (imports removed,
TypeScript compiled locally, no network/application imports). It confirmed that all three
contradictory synthetic streams were previously accepted:

1. A failed `response.output_item.done` search item followed by a plausible successful terminal.
2. A completed streamed search whose action disagreed with the terminal item's action.
3. One event containing conflicting top-level `response_id` and nested `response.id`.

`apps/daemon/src/lib/native-search-evidence.ts` now records bounded observed stream identities
and checks them against the **unchanged, still mandatory terminal output**:

- Added/done output slots must have valid index 0–127, bounded ID and exact admitted string type.
  Slot identity/type cannot change, and IDs cannot move between indices. Every observed slot
  must agree with terminal item index/identity/type. Evolving added action/status is not treated
  as final; it is deliberately not compared to the completed action.
- Completed streamed hosted-search items must themselves have completed status and a known
  action. Duplicate completed proofs refuse; their identity/status/action must agree with the
  final item. Action comparison is exact structural equality, not query normalization or fuzzy
  equivalence; unsupported differences fail closed.
- Observed web-search progress markers must identify a corresponding completed terminal web
  item at the same index. They never count as execution proof independently.
- Unadmitted streamed output capabilities refuse rather than disappear from validation.
- Native parsing checks both top-level and nested response identity when supplied together.
  Event/item/action types must be actual strings, not coercible arrays/objects.
- The projector's combined error is split into fixed **missing**, **duplicate**, and **excessive**
  hosted-search execution errors. The requirement for 1–8 unique actual search-action IDs remains.

Terminal status/model/search/citation/domain/capability validation, complete-stream framing,
Codex-only terminal alias, byte/deadline/cancellation, raw/decoded secrecy, admission and
one-request/no-replay rules remain mandatory. No request/credential/transport configuration changed.
These are stricter consistency checks, **not a new acceptance path for missing execution proof**.

## Safe structural diagnostics

Failures may now append a fixed `evidence` object alongside existing safe phase/code/status/media/
body hints. It contains only:

- Terminal category: `unseen`, `json`, `completed`, `done`.
- Terminal output-item count (or null when unavailable), terminal web-search item count,
  terminal search-action count, terminal non-search web-action count (including malformed actions).
- Streamed completed web-search-item count (all web actions, not necessarily search queries),
  and observed web-search lifecycle-event count (not execution proof).

Counts saturate at **129**, one above the 128-item admitted output bound; identity maps contain
at most 128 slots with bounded IDs and remain private/in-memory. Only the first 129 terminal
items are inspected for diagnostics. Raw secret filtering precedes observation; decoded secrecy
checks still govern output. No diagnostic IDs, URLs, queries, action bodies, raw event names,
provider errors or upstream response excerpts are retained/disclosed. Counts are diagnostic
facts, never authorization, entitlement or source-reading evidence. A future trial harness must
parse only these fixed keys and numeric/category ranges, not start retaining arbitrary bodies.

## Independent reviews and validation

- Initial read-only review `/tmp/baz069-evidence-review-EBxh82/` accepted the narrow delta and
  identified two preexisting residual gaps: `String(type)` coercion and added-item identity
  contradictions. Both were repaired and directly regression-tested, not dismissed or waived.
- Follow-up `/tmp/baz069-evidence-final-review-mUvMKG/`: **narrowly accepted, no actionable
  findings**. Reviewer used supplied files and standalone offline checks, not repository tests.
  Production files match the final reviewed bundle exactly. Ephemeral Codex model inference
  was remote; tools were read-only, hosted search disabled, user config/rules ignored, no home/
  credential/session inspection or live research. No credential imported/copied.
- Final review SHA-256:
  **`b09f81e952d48c3fc13a0e5cb7774c5a62a4b4a4d5fabfb3c025c8e032ada1a7`**.
- Added nine required cases for precise errors, consistent evidence, no backfill, contradictions,
  strict types/added identity, dual response IDs, bounded diagnostics, secrecy and turn-host/no-replay.
- Focused suites: **135 passed / six files**. Root/web types passed. Scoped Biome passed without
  warnings for edited files; `git diff --check` passed. No whole-tree lint claim.
- Full bounded-concurrency suite: **2,347 passed / 47 skipped**, **271 files passed / seven
  skipped**. Security acceptance: **307 required cases passed**, exit 0.
- Logs, baseline reproduction and final source/dependency/test manifest:
  `/tmp/baz069-evidence-contract-lIW01z/`. `candidate.sha256` SHA-256:
  **`c4510d4b399b1114bfa04b1eed6a7527f8854f54879a2b06af41ce9ff33304bd`**.

## Operator state / next boundary

The first local idle check timed out before any signal; a subsequent read-only health/idle
check succeeded. Only then was the owned idle daemon gracefully stopped for the known test-port
conflict, and restarted on 127.0.0.1:4321 with scheduler/browser/image disabled, native auto/cached.
Operator home/account preserved; passive status reports connected without a provider refresh/
compatibility probe. No new Agent or research turn created; no outstanding worker.

The repaired candidate can distinguish future execution-evidence failures without discarding
contradictions or weakening proof. **It does not prove the previous live refusal is resolved.**
Further authenticated observation requires fresh explicit bounded authorization and pin/readiness
checks; no automatic retry/fallback. T18(b) still needs actual search → guarded official NASA
source read → verified facts/effective URL → cited answer → clean same-attempt `done`.
