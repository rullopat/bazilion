# BAZ-041 implementation progress

Started: 2026-09-14 (resumed). Status: daemon/API/CLI complete and locally green;
web reopen control and Telegram disclosure remain.

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

### Egress

- `coding_progress` and the terminal `coding_command` tool result are user-facing frames, so they
  pass the same shared authorizer as assistant output. Terminal operator delivery releases the
  retained log; live progress never releases. A held result stays unreadable.

## Validation

- `pnpm typecheck` clean; `pnpm lint` no errors; `pnpm format` applied.
- `pnpm test`: 1523 passed, 7 skipped (194 files).
- `pnpm security:acceptance`: 60 required adversarial cases passed.
- `pnpm --filter @bazilion/web typecheck` clean.

## Remaining work (not done in this pass)

1. **Web reopen control.** The API/client/CLI can reopen a released log after navigation and
   restart, but the web chat has no button yet; history replay still shows the masked placeholder.
   A TanStack server function plus a small control in `CodingToolResult` is required, and the
   Vite import-protection boundary for a component-imported server function needs verifying.
2. **Telegram disclosure.** Terminal coding outcomes still mirror through the existing verbose
   tool-result path; they do not yet trigger `releaseCodingCommandLog`.
3. **Peer message egress does not itself release.** Release happens when an authorized peer reads
   the log or the operator receives the terminal result. Confirm this matches the intended
   "source-owned egress" moment for `send_message`.
4. **Mid-turn credential refresh** does not join the redaction set after turn start; redaction
   covers the credentials known at spawn.
5. **BAZ-042 linkage.** Snapshot-bound applicability/invalidations are out of scope here.

## Acceptance map

1. Live changing output without a setup form — implemented (executor `onUpdate`, daemon/event/web).
   Real-Docker manual observation still required.
2. Failure diagnostics after scratch cleanup; operator reopen — retention + API/CLI done; web
   reopen control outstanding.
3. Distinct terminal states; no replay on disconnect — BAZ-040 behavior preserved; progress is
   cumulative so reconnect cannot duplicate output.
4. Held output inaccessible; redaction/control bytes/hostile markup — audience gate, redaction
   pipeline, React-escaped rendering; `security:acceptance` green.
5. Quota/truncation/expiry/deletion/persistence failure truthful — explicit truncation flag,
   tombstones, lazy expiry, best-effort persistence.
6. Web/CLI consistent outcomes; no exit-code inference of coverage — preserved; CLI log command
   reports availability honestly.
