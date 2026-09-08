# BAZ-034 implementation record

Goal: complete the full durable-deliverables story with acceptance evidence. Publication is
outside this goal. Refinement is complete and the story is in progress.

## Checkpoints

- [x] Refine storage, lifecycle, provenance and authorization; reproduce browser regression.
- [ ] Implement durable publication and transcript references.
- [ ] Implement authorization-aware API, CLI, native handoff and Telegram integration.
- [ ] Implement persistent chat cards and Team results UI.
- [ ] Integrate backup/restore and deletion lifecycles.
- [ ] Verify all seven acceptance criteria and required checks; review final diff.

## 2026-09-07: baseline inspection

- Baseline: local `9cf0086`, clean worktree before this record; Node 26.7.0, pnpm 11.14.0.
- `runtime/tools/deliver-file.ts` reads a confined workspace file and sends base64 bytes to
  a synchronous sink. It returns descriptive text only. Its pre-read size check does not
  bound bytes actually read if a source grows during reading.
- `runtime/pi/tools.ts:ourToolToPiTool` discards the tool-call ID and always returns empty
  details. Publication needs source-operation identity and structured transcript details.
- `runtime/pi/events.ts:piMessagesToProviderView` preserves tool-call IDs but no file reference.
- `ChatPane.tsx` replaces messages and clears live entries on `done`. Browser reproduction
  was outstanding at this checkpoint; the subsequent browser evidence is recorded below.
- `lib/communication.ts:authorizeHttpChatFrame` gates file frames through the existing
  Agent-to-user authorizer. `lib/telegram/mirror.ts` separately authorizes Telegram egress.
- `routes/approvals.ts` currently completes approved HTTP frames by making the captured
  payload available to the polling caller. Durable publication must hook this source-owned
  release path; merely storing a file must never make it listable or downloadable.
- `lib/backup.ts` captures SQLite before archiving surrounding live files. Immutable result
  bytes need a snapshot-consistent overlay/manifest, including protection from concurrent deletion.

## Initial refinement direction (superseded by the decisions below)

- Daemon-owned result bytes outside Team workspaces, with opaque IDs and a narrow publication
  receipt. Preserve original producing Team/Agent identity through Agent transfers.
- No automatic expiry for released results; explicit operator deletion, documented bounded
  storage, and visible capacity errors. Set the exact cap and cascade behavior during refinement.
- Keep staged/held results private. Tie release to existing authorization/approval ownership,
  and resolve all operator projections through that persisted decision. Settle policy changes
  and separate HTTP/Telegram delivery attempts before implementing the read contract.
- Store structured references in canonical Pi tool-result details and carry those references
  through wire types. Never reconstruct historic bytes from descriptive transcript strings.
- Use isolated temporary homes for runtime/browser verification and destructive lifecycle tests.

## Browser regression evidence

Baseline reproduced in Chromium against the real daemon, per-turn worker, Pi session/tool
adapter, `deliver_file`, HTTP gateway, and React ChatPane. A deterministic loopback OpenAI-compatible
provider requested `deliver_file({path: 'report.txt'})`, then delayed the final assistant response
to let the browser inspect the live card. No external model credentials or operator data were used.

- Temporary fixture: `/tmp/baz034-repro/server.mts`; browser driver:
  `/tmp/baz034-repro/browser.mjs`; isolated home: `/tmp/baz034-repro/home`.
- Listeners: daemon 14321, web 14322, fixture provider 14323, all loopback.
- While running: `report.txt` and a `download` link were visible beside the delivery tool result.
- After completion: the descriptive tool result and final assistant response remained, but the
  filename card/download link disappeared. Reload produced the same missing-card state.
- Screenshots: `/tmp/baz034-repro/during.png` and `/tmp/baz034-repro/after.png`.
- The browser driver exited successfully. This establishes the baseline regression; it is not
  evidence that the new behavior works. These temporary artifacts are local, not release assets.

## Acceptance evidence

Baseline reproduction completed. Implementation and all post-change acceptance checks remain.

## Refinement completed

The in-progress story records the final storage, quota, lifecycle and release decisions.
SQLite BLOB publication removes the cross-filesystem staging race and makes the stored
size/hash manifest part of the same online backup snapshot. Implementation begins with
that transaction boundary and its failure/retry tests.

## 2026-09-07: storage and operator API checkpoint

Implemented, not yet connected to worker delivery:

- `agent_results` stores immutable BLOB bytes and the provenance/size/hash receipt in one
  transaction. Private publication, source-operation uniqueness, a 25 MiB file cap and 1 GiB
  retained-byte cap are enforced. Explicit deletion leaves a tombstone; retry cannot resurrect it.
- Producing Agent IDs survive Agent deletion. Producing Team deletion cascades result rows;
  no result cleanup traverses the Team filesystem.
- `/api/results` provides authenticated list/detail/download/delete. Private receipts are
  invisible. Downloads are attachments with no-store/nosniff/CSP headers; deleted downloads
  return 410 and corrupt downloads fail explicitly.
- CLI canonical schema object list/fingerprint updated for the clean-install schema.
- Both daemon backup creation and CLI restore validation iterate stored result bytes and check
  size/hash against the receipt manifest. Metadata/bytes are in the same online SQLite snapshot.

Validation so far:

- Nine storage tests passed (publication/privacy, immutability, idempotency, rollback, malicious
  inputs, deletion, reopened SQLite snapshot, corruption, lifecycle and capacity boundaries).
  The full-store test substitutes only the aggregate-byte query to avoid allocating 1 GiB.
- Three HTTP route tests passed through the application auth middleware: private-result
  non-disclosure, protected downloads, pagination, deletion and corruption behavior.
- Two result snapshot tests passed: captured bytes survive source-store deletion after backup,
  current CLI schema validation accepts them, and both validators reject corrupted content.
- Existing CLI backup integration suite: 42 tests passed after allowing isolated local listeners.
  This ran before the added per-result hash loops; the dedicated snapshot tests cover those loops.
- Root typecheck and focused Biome passed during this checkpoint. Full final gates remain pending.

Next integration checkpoint:

1. Turn-scoped daemon publication host; bind Agent/Team from the prepared turn and validate
   canonical session/tool-call provenance. Bound actual source reads as well as received bytes.
2. Carry opaque references through IPC and canonical Pi tool-result details/history projection.
3. Release from existing HTTP/Telegram authorization and approval dispatch; held/denied payloads
   must not leak through transcript hydration or download projections.
4. CLI/native handoff, chat cards, Team library, safe previews, and remaining lifecycle/browser
   acceptance evidence. API/storage passing tests do not establish complete story acceptance.

## 2026-09-07: worker publication, authorization and chat-card checkpoint

- `deliver_file` now bounds actual reads to 25 MiB plus one sentinel byte and awaits
  turn-scoped publication over IPC. The daemon binds Agent/Team from the prepared turn,
  checks the active canonical session header and `deliver_file` tool-call identity, validates
  base64/actual byte count, then atomically saves the result. Cancelled publication fails.
- The Pi tool adapter carries the real tool-call ID and stores the opaque result reference
  in canonical tool-result details. HTTP/IPC DTOs carry references through live and hydrated
  messages. Review workers do not receive a result host.
- Existing HTTP and Telegram egress authorizers resolve the captured receipt before dispatch
  and release it only after allow. Approval payloads store the reference with empty inline data;
  the existing approval dispatcher resolves the saved bytes and releases the result. Pending
  approvals therefore do not expose file bytes through approval detail. Newly released results
  also require that their producer is still in the original Team.
- Web ChatPane now projects durable references as `ResultCard` both live and from history.
  The card resolves authenticated metadata and gives an explicit download error/deleted state.

Evidence:

- Updated isolated fixture completed a real daemon/worker/Pi tool turn and saved result
  `9cad1abc-d178-424d-bc0f-cbd0151d2444`. The fixture home is now
  `/tmp/baz034-repro/home-durable` (old baseline schema home retained separately).
- Chromium driver `/tmp/baz034-repro/verify-durable.mjs` changed the workspace `report.txt`,
  downloaded the original captured bytes through the browser, reloaded and found the download
  card still present. At 390 px, the page had no horizontal overflow. Inspected screenshot:
  `/tmp/baz034-repro/durable-390.png`. This does not yet cover restart or every UI state.
- 14 attachment tests passed with the awaited publication contract; the 48 existing Telegram
  mirror and approval-plan tests passed during integration.
- 47 tests passed across communication routes, core communication approvals, result delivery,
  Telegram mirroring and protected session prompts. The four new result-delivery tests cover
  source identity, cancellation, captured-byte resolution, private held approval payloads,
  successful canonical HTTP approval, and revocation before approval.
- Root and web typechecks passed during this checkpoint. Final gates remain outstanding.

Remaining work includes CLI management/download parity, native reference/handoff handling, Team
results library and previews/source navigation, rejected/expired/orphan private-snapshot cleanup,
additional Telegram-held/transport and size-race tests, full lifecycle/restore/browser acceptance,
and final whole-tree checks/documentation/release notes. Existing source navigation and reset
semantics must be checked against retained results; do not infer completeness from card hydration.

## 2026-09-07: client interfaces and library checkpoint

- Added `bazilion result list/show/download/rm`, with Team/Agent filters, pagination,
  JSON inspection, explicit output paths, exclusive creation and fsync, and confirmed deletion.
  The shared HTTP client exposes authenticated binary reads without credential-bearing URLs.
- Added Team Results navigation/library with filters, pagination, provenance, safe previews,
  deletion confirmation and source-conversation access; `/results/:id` supports exact browser
  handoff from native clients. Result cards expose download errors and deleted states.
- Added preview API: plain text/Markdown rendered as text (256 KiB maximum), and signature-checked
  PNG/JPEG/GIF/WebP (10 MiB maximum). Active content and mismatched raster signatures cannot be
  previewed. Downloads remain available for supported files outside preview limits.
- Added source API and a read-only source view in the existing Agent route. It requires the
  current canonical session to match the recorded source and checks head stability while reading;
  unavailable source history is reported explicitly. It does not silently show the newest chat.
- Native chat state preserves result identity live and through done/history hydration. Its
  saved-file row offers the exact browser result page, with sign-in guidance and an open failure
  message. Physical-device browser handoff has not been exercised in this environment.

Evidence:

- CLI integration lifecycle test passed against an isolated daemon, including unchanged existing
  output files and no output file created for a deleted result.
- Twelve mobile chat-state tests passed, including single-reference preservation on completion
  and reload. Mobile, web and root typechecks passed during implementation.
- `/tmp/baz034-repro/library.mjs` passed in Chromium after an isolated daemon restart: populated
  library, text preview, original source view, narrow/desktop layouts, no horizontal overflow,
  retained download card, and explicit download-error UI (409 response injected for the latter).
- Inspected `/tmp/baz034-repro/library-desktop.png` and `library-390.png`. Adjusted byte-size
  formatting so small nonempty files no longer display as 0.0 KiB, and separated preview actions.
- First browser attempt timed out at login while the development server was updating; a repeat
  succeeded, and direct authenticated checks confirmed both test listeners served current data.

Next: finish private-result retention/reconciliation, audit non-HTTP/non-Telegram delivery visibility,
exercise pending/expired/revoked/failed Telegram delivery and the remaining lifecycle/UI states,
then run full tests/security/typecheck/lint/build gates and complete documentation/release notes.

## 2026-09-07: authorization, recovery, and acceptance completion

Final implementation decisions and fixes:

- Background turns now use `result_library` / `result_publication` / `agent_result` through the
  existing Agent-to-user authorizer and closed canonical approval dispatcher. Scheduled/inbox
  results no longer depend on a running Telegram mirror to reach the library. HTTP/Telegram
  transport approvals remain separate typed attempts with reference-only captured payloads.
- Private bytes are reclaimed only after the producing Agent is idle and no pending/delivering
  approval references them. Expiry uses the existing approval repository. Startup marks interrupted
  result dispatches failed without retrying uncertain transport; released receipts remain available.
  Cleanup runs at startup, turn settlement, result/approval access, and before new publication.
- Publication and source display share a bounded, no-follow descriptor reader. Source display uses
  Pi's own context builder on that captured input. Publication also captures the pre-turn transcript
  boundary and rejects tool calls from earlier history; source Agent/Team remain daemon-bound.
- Native browser handoff preserves the exact result through failed/successful sign-in. The redirect
  accepts only a UUID result identifier, never an arbitrary return URL.
- Browser acceptance exposed a CSP incompatibility in raster blob URLs. Validated raster previews
  now use data URLs permitted by the existing policy, with no CSP expansion. Downloads retain blob
  URLs. Preview/download work is aborted on card replacement and reports the correct busy state.
- Added the saved-results operator/API/storage guide, README and engine guidance, AGENTS next-release
  invariant, and an unpublished Changeset. No release versions, commits, pushes or deployments were made.

Acceptance evidence:

| Criterion | Passing evidence |
| --- | --- |
| 1. Immutable bytes after completion/reload/restart | Real daemon/worker/Pi turn retained result `9cad1abc-d178-424d-bc0f-cbd0151d2444`; browser changed its source, downloaded original bytes, then verified SHA-256 after restart and a fresh browser sign-in. Final provenance code also completed a real turn producing `9c2eec70-2d44-4327-a154-4276bacc2e48`, with a card during delivery, after done, and after reload. |
| 2. Distinct duplicate filenames | `core/results.test.ts` covers distinct source operations; browser fixture held 22 results with duplicate report filenames and verified 20/2 pagination and producing-Agent filtering. |
| 3. Retry/failure/recovery | Repository tests cover idempotency, mismatched/deleted retries, capacity, integrity and transactional rollback. `result-source-security.test.ts` rejects actual growth after fstat and propagates storage rejection. Result-delivery tests cover cancellation, abandoned snapshots, expired/denied/cancelled holds and interrupted dispatch recovery. |
| 4. API/CLI/web/native behavior | `routes/results.test.ts`, CLI `result.test.ts`, mobile `chat-state.test.ts`, and browser acceptance cover lookup/download/delete, safe previews, retained references, exact sign-in handoff, pagination, filters and truthful source/reset states. |
| 5. Confinement and authorization | Existing attachment confinement tests plus new source/ownership/size tests pass. HTTP and Telegram holds carry no bytes, canonical approval releases captured content, revoked policy fails, private IDs return 404, and corrupted/deleted downloads fail explicitly. Browser text preview made zero external requests and rendered markup literally; raster preview decoded under the unchanged CSP. |
| 6. Backup and lifecycle | Full CLI tar backup/restore preserves result bytes/hash/provenance; snapshot validators reject corrupt blobs. `result-lifecycle.test.ts` exercises actual move/delete operations and linked-source preservation. Chat reset preserves downloads and rejects replacement source history. Both uninstall tiers remove a copied result DB while leaving linked external files intact. |
| 7. Keyboard and 390 px | Browser used keyboard download, filter and pagination; deletion dialog traps focus and restores the trigger after Escape. Populated/empty/deleted/error states and raster/text previews were inspected at desktop and/or 390 px, with no narrow-layout overflow. |

Browser artifacts and drivers remain in `/tmp/baz034-repro/`: `acceptance.mjs`, `browser.mjs`,
`verify-durable.mjs`, `library.mjs`; inspected images include `library-desktop.png`,
`library-390.png`, `raster-preview-390.png`, `deleted-390.png`, and `empty-desktop.png`.
The acceptance driver's final result reports all handoff, restart-hash, keyboard, pagination,
preview, source-unavailable, deletion and empty-state checks true, with zero preview-origin requests.

Validation gates:

- `pnpm test`: **1,222 passed, 3 skipped**, 148 files passed / 1 skipped; log
  `/tmp/baz034-tests-verified.log`. The pre-existing health assertion was corrected to match the
  provider-neutral Docker baseline (OAuth readiness remains a separate provider diagnostic).
- `pnpm security:acceptance`: **60 required adversarial cases passed**; log
  `/tmp/baz034-security-final.log`, report `/tmp/bazilion-security-acceptance-3553545.json`.
- `pnpm typecheck`, web typecheck, mobile typecheck, and web production build passed.
- `pnpm lint` passed with 39 existing warnings; a focused check of all 44 changed/new eligible
  TypeScript files passed without diagnostics. `git diff --check` passed.
- A concurrent full-suite/security run collided on shared web build output and failed one gateway
  request; sequential reruns passed. Final suite commands used a disposable default home. Browser
  fixtures use only `/tmp/baz034-repro/home-durable` and a local fake provider.

Physical-device mobile testing, a live Telegram recipient, and production deployment are outside
this local verification: native state/handoff and Telegram captured-byte/failure behavior were
verified with client tests, a real browser handoff, and deterministic transport adapters. No actual
provider credentials, personal Team data, or external recipients were used in the acceptance fixtures.

Final turn-outcome browser check (`turn-outcomes.mts`) also passed: cancellation after file release
retains the download card after reload; a missing-source publication failure surfaces its error and
creates no live or hydrated download card. Screenshot: `cancelled-card-390.png`. The driver needed
to wait for hydration and use the Cancel control's accessible name (`Cancel current response`);
the fake response delay was extended to make the cancellation window deterministic.

Implementation and all seven acceptance criteria are complete for local review. The goal is complete;
the story remains `in_progress` because commit/push, release and production acceptance have not occurred.

### Manual demo follow-up: approval filenames and browser downloads

The guided demo confirmed durability across source edits/restart, approval release, deletion,
safe previews, cancellation retention, and failed-delivery behavior. The operator identified
missing filename context in approval details and UUID names on files downloaded in the demo browser.

Approval detail now projects captured filename, MIME type, and byte length for valid HTTP,
background, and Telegram result approvals. The web inspection panel displays these fields before
approval. Metadata is resolved from the daemon receipt after validating the canonical delivery plan
and matching its producer; held bytes remain private. A mismatched producer exposes no metadata.

The download filename issue was traced to the Playwright-launched demo browser: Bazilion suggested
`report.txt`, but Playwright stored it as a UUID artifact. The isolated browser launcher now uses
Chromium's normal filename saving in `/tmp/baz034-demo/downloads`. Browser verification saved an
actual `report.txt` with original contents and confirmed `approval-report.txt` in the approval UI.
No application download change was needed.

Validation: 54 focused result/approval tests passed; root and web typechecks passed; focused Biome
and `git diff --check` passed. Verification driver: `/tmp/baz034-demo/check-filename.mjs`.
Changes remain uncommitted and unreleased.

### Release PR preparation

BAZ-034 is the first implementation in the draft `release/0.15.0` collection branch. The final
pre-PR full-suite run passed: **1,223 tests passed, 3 skipped**, 148 test files passed and one skipped
(`/tmp/baz034-pr-tests.log`). The minor Changeset remains pending while additional stories are
selected and implemented; package versioning and publication follow the existing release workflow.
