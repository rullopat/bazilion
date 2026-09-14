# BAZ-041 implementation progress

Started: 2026-09-14 (resumed). Status: daemon/API/CLI/Telegram/web complete, locally green,
covered by 10 BAZ-041 cases in the adversarial release gate, and observed in real Docker — see
[the acceptance record](BAZ-041-acceptance.md). What remains before delivery is one real-model turn,
not feature code. The retained-log browser read is deliberately first-page-only (no
search/pagination) in this pass.

Story: [BAZ-041](in_progress/BAZ-041-coding-command-verification.md).
Branch: `feat/baz-041-042-coding-evidence`.
Resume HEAD: `1063c8b` (prior session left the retention repo layer uncommitted).

## Objective and stopping condition

Extend BAZ-040 command receipts with bounded live progress and retained diagnostics, reachable by
the producing Agent, an authorized peer, and the operator, without inventing a second receipt
identity or a new execution engine. Completion requires live chat progress, retained-log access on
every required surface, honest retention states, and passing root validation. No release, merge or
push is included; BAZ-041 stays unshipped.

## What is implemented

### Retention store (`apps/daemon/src/core/repos/coding-command-logs.ts`)

- Per-command cap 2 MiB, home-wide budget 256 MiB with oldest-first eviction, 7-day TTL.
- `retained` / `expired` / `deleted` tombstones; reads lazily report expiry even before a prune.
- Bounded byte-offset pages (`readCodingCommandLog`) and bounded literal search
  (`searchCodingCommandLog`); offsets/sizes are UTF-8 bytes, never host paths.
- Audience gate: `producer` or `disclosure`; disclosure requires `released_at`.
- Truncation is an explicit stored flag, not inferred from byte counts, because redaction can
  shorten or lengthen bytes. A non-redacted `observed > retained` is still accepted as truncation.
- 24 unit tests in `apps/daemon/test/core/coding-command-logs.test.ts`.

### Schema and backup

- `coding_command_logs` + retention/team-time indexes in the canonical `0001_init.sql`
  (clean-install only; no ALTER/legacy path).
- Canonical backup fingerprint updated; `CANONICAL_OBJECTS` now lists the table and indexes.
- `invalidateRestoredCodingEvidence` expires logs whose original window already passed, keeping
  the backup's original expiry rather than extending it.

### Live progress

- `CodingDiagnostics` gained configurable retention, `observedBytes`/`redacted` accounting, and a
  non-finalizing redacted `preview()`.
- The `coding_command` executor emits throttled cumulative updates through Pi's `onUpdate`.
- `translatePiEvent` maps Pi `tool_execution_update` to a new cumulative `coding_progress`
  `SessionEvent` (later updates replace earlier ones for the same tool call). Tests in
  `apps/daemon/test/runtime/coding-progress.test.ts`.
- Telegram deliberately does not stream every chunk (`coding_progress` renders to `null`).
- The worker's `codingTools` accepts a secret *supplier* read at command start. `session.ts`
  shares one mutable redaction set between the coding tools and the provider refresher, and the
  protected credential boundary appends refreshed tokens to that same set — so a credential
  learned mid-turn is redacted before the next command's live and retained output is built.

### Agent and peer access

- New `coding_log` tool (`apps/daemon/src/runtime/pi/coding.ts`) plus `log` / `log-search` IPC
  actions, proxied through the existing generic `coding` RPC.
- `agent-host.ts` shares one `authorizeEvidence` gate for receipts and logs: the producing Agent
  reads freely; any other member must present the policy-authorized message carrying
  `coding-receipt:<id>`. An authorized peer read releases the captured bytes for disclosure.
- Retained log tool results are masked in history replay like other coding evidence.

### Operator surfaces

- `GET /api/teams/:id/coding-commands/:commandId/log` and `.../log/search` — 404 when the command
  is not in the team, 403 while the log has not been shared, otherwise metadata + a bounded page.
- `@bazilion/client` `codingLogs(teamId).page/search`.
- CLI `bazilion team log <team> <commandId> [--offset --limit] [--search]`.
- Web chat renders live progress tails and `coding_log` pages inline.
- **Web reopen control.** A masked history card carries an opaque `{commandId, teamId}`
  `codingLog` pointer on the wire `ProviderMessage`. The projection lifts it from the raw tool
  result while masking (`apps/daemon/src/lib/coding-environment/receipt-reference.ts`), so no Team
  context has to be threaded through `piMessagesToProviderView`. `CodingToolResult` renders a
  ghost button that reads one bounded page through the same-origin `/api` proxy
  (`apps/web/src/lib/coding-log.ts`). Holding the pointer discloses nothing: the read is an
  explicit click and the daemon re-checks Team membership *and* release on every call. A held log
  renders as "hasn't been shared yet" (403 / null page), never as an empty result.

### Egress

- `coding_progress` and the terminal `coding_command` tool result are user-facing frames, so they
  pass the same shared authorizer as assistant output. Terminal operator delivery releases the
  retained log; live progress never releases. A held result stays unreadable.
- Telegram releases the retained log only when a terminal coding result is actually mirrored and
  its egress is authorized. A minimal-mode-suppressed or policy-denied outcome does not release.
- A peer read *is* the peer's delivery, so it releases; a `send_message` that merely names the
  receipt moves no bytes and correctly releases nothing. This matches the story's "source-owned
  user or peer delivery" refinement decision, so it is settled rather than open.

### Adversarial release gate

- 10 BAZ-041 cases were added to `security/acceptance-manifest.json` (gate total 60 → 70). Before
  this, the gate exercised no BAZ-041 boundary at all — it passed, but proved nothing about
  retained-evidence disclosure. The new cases pin the disclosure gate, release non-inheritance,
  truthful expiry, split-credential redaction, opaque references, pointer-without-bytes history
  projection, producer-only peer authorization, mid-turn credential redaction, no-fetch masked
  card, and held-log-is-not-empty.

## Validation

- `pnpm typecheck` clean; `pnpm lint` no errors; `pnpm format` applied.
- `pnpm test`: 1544 passed, 7 skipped (196 files).
- `pnpm security:acceptance`: 70 required adversarial cases passed, 10 owned by BAZ-041.
- `pnpm --filter @bazilion/web typecheck` clean.
- Local acceptance on a disposable home with a fake provider and real Docker: see
  [BAZ-041-acceptance.md](BAZ-041-acceptance.md). Criteria 1, 2 and 6 observed; 3 and 4 partly
  observed; 5 proven locally.

## Remaining work

**Blocking delivery — one acceptance run, not code:**

1. **A real-model turn.** Live progress, retention, restart persistence and web/CLI parity were
   observed with a *scripted* fake provider, so criterion 1's "a real model chooses the command
   from an ordinary prompt" is still unproven. One run on a disposable home closes it.

**Optional strengthening:**

2. **Genuine withholding evidence.** Criterion 4's withheld state was staged by un-releasing a
   retained row. A Team Policy `approval_required` edge (or a worker loss before any terminal
   frame) would prove the real egress path. The boundary is already pinned by a gate case, so this
   strengthens the record rather than closing a gap.
3. **Scripted browser check.** The browser steps were driven manually. The repo pattern to extend
   is `scripts/check-repository-context-ui.mjs` (inline fake provider + `startTestServer` +
   Playwright).

**Optional polish — not required by any acceptance criterion:**

4. **Retained-log search and paging in the web.** The browser control reads the first 64 KiB page
   only; `hasMore` is surfaced as a note. The search route and offset paging already exist on the
   API/client/CLI, so this is UI-only follow-up.
5. **`coding_log` masked cards carry no pointer.** `CodingCommandLogPage` has a `commandId` but no
   `teamId`, so a masked `coding_log` page degrades to the plain placeholder. This is cosmetic:
   such a card only exists in a transcript that also holds the terminal `coding_command` card,
   which does carry the pointer.

**Out of scope here:**

6. **BAZ-042 linkage.** Snapshot-bound applicability/invalidations are owned by BAZ-042.

## Acceptance map

1. Live changing output without a setup form — implemented (executor `onUpdate`, daemon/event/web)
   and **observed in real Docker** (10 cumulative frames, no duplication, no setup form).
   Real-model command selection still unproven.
2. Failure diagnostics after scratch cleanup; operator reopen — retention + API/CLI/Telegram/web
   control done (first page only; search/paging deferred) and **observed**: container gone, 61
   bytes read back, unchanged across a daemon restart, reopened from a reloaded chat card.
3. Distinct terminal states; no replay on disconnect — BAZ-040 behavior preserved; progress is
   cumulative so reconnect cannot duplicate output. **Succeeded vs. cancelled observed**; timeout,
   worker loss and preflight failure remain suite-covered only.
4. Held output inaccessible; redaction/control bytes/hostile markup — audience gate, redaction
   pipeline, React-escaped rendering; pinned by the 10 BAZ-041 adversarial cases in
   `security/acceptance-manifest.json` plus unit coverage, and **observed at the read surface**
   (403, CLI refusal, "hasn't been shared" card) with the withheld state staged.
5. Quota/truncation/expiry/deletion/persistence failure truthful — explicit truncation flag,
   tombstones, lazy expiry, best-effort persistence; metadata truthfulness **observed**, the quota
   and expiry/deletion edges remain suite-covered only.
6. Web/CLI consistent outcomes; no exit-code inference of coverage — preserved; CLI log command
   reports availability honestly.
