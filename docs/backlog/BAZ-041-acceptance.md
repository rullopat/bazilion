# BAZ-041 coding-progress acceptance record

Audit date: 2026-09-14. Scope: local acceptance evidence for
[BAZ-041](in_progress/BAZ-041-coding-command-verification.md) against
[the progress record](BAZ-041-progress.md). No release, merge, push or deployment is included and
BAZ-041 remains unshipped.

The run used a **disposable home** (`/tmp/baz041-home`), a **fake provider**
([`scripts/fake-coding-provider.mjs`](../../scripts/fake-coding-provider.mjs)) and real Docker. No
personal runtime state, real provider credential or Telegram message was involved.

## Acceptance criteria

| Criterion | Observed evidence | Result |
| --- | --- | --- |
| 1. Live changing output from an ordinary chat request, no setup form | Real Docker turn emitted 10 cumulative `coding_progress` frames before the terminal receipt (each replacing the prior tail, so no duplication), then the receipt. Observed in the browser too. The Team needed no checks/catalog; the coding environment is optional when `BAZILION_BASH_SANDBOX_IMAGE` is set. | Observed |
| 2. Diagnostics survive scratch cleanup; operator reopen after navigation and restart | Container was gone while `bazilion team log` still returned all 61 retained bytes. Re-read succeeded unchanged after killing and restarting the daemon. Reopened from a reloaded chat card in the browser. | Observed |
| 3. Cancel, timeout, worker loss, preflight failure and exits stay distinct; no replay | Observed `succeeded` (61 bytes) and `cancelled` (14 bytes = exactly the two ticks emitted before cancellation) as distinct receipts. Progress is cumulative, so reconnect cannot duplicate output. Timeout, worker-loss and preflight-failure states are covered by the suite, not observed here. | Partly observed |
| 4. Held/denied output stays inaccessible; redaction and hostile bytes | A retained row with `released_at` NULL returned HTTP 403 (`Coding log has not been shared`) and the CLI printed `error: Coding log has not been shared`; the browser card rendered the explicit "hasn't been shared" copy rather than an empty box. The withheld state itself was **staged** (see caveats). | Partly observed |
| 5. Quota, truncation, expiry, deletion and persistence failure are truthful | Observed truthful metadata: `observedBytes`=61, `byteLength`=61, 7.00-day expiry, plus explicit `truncated`/`redacted` columns. Quota eviction, expiry/deletion tombstones and persistence failure were **not** observed; they rest on the unit suite and the release gate. | Proven locally |
| 6. Web/CLI outcome parity; no coverage inferred from an exit code | CLI read and browser card reported byte-for-byte identical retained output for the same command id. Outcome and applicability remain separate facts. | Observed |

## Detailed observations

Frame sequence for one ordinary chat turn (NDJSON from `POST /api/agents/:id/chat`):

```
user_message
assistant_delta / assistant_message
tool_call      coding_command
coding_progress x10   cumulative tail: "" -> "tick 1" -> ... -> "tick 1..tick 8\ndone"
tool_result    coding_command  {id, teamId, ...}
assistant_delta x5 / assistant_message
done
```

Retention rows for that home (command id abbreviated):

| command | state | retained | observed | released | note |
| --- | --- | --- | --- | --- | --- |
| `e87bc0fb…` | succeeded | 61 | 61 | yes | terminal operator delivery |
| `a71f0a2e…` | cancelled | 14 | 14 | yes | cancelled receipt is still a terminal delivery |
| `9fdc0437…`, `a574b836…`, `69690b04…` | succeeded | 61 | 61 | yes | `69690b04…` later re-held for the criterion 4 check |

Other observed facts:

- No leftover containers after the turns; the Team workspace held only `memory/`.
- The browser payload (`GET /api/agents/:id/sessions/messages`) carried five masked
  `coding_command` cards, each with an opaque pointer, e.g.
  `codingLog={"commandId":"e87bc0fb-…","teamId":"default"}`. Masking does not carry bytes.
- A cancelled turn still delivers a terminal receipt, so it releases the retained log. Release
  happens at the egress authorization boundary, not at the socket write, so a client that
  disconnects cannot leave a delivered outcome unreleased.

## Reproducible procedure

Prerequisites: Docker on a local Unix socket, `debian:bookworm-slim` already present locally
(`--pull never`), Node 24+ and pnpm.

```sh
node scripts/fake-coding-provider.mjs 18080 &
rm -rf /tmp/baz041-home
BAZILION_HOME=/tmp/baz041-home PORT=4399 \
  LMSTUDIO_URL=http://127.0.0.1:18080/v1 \
  BAZILION_BASH_SANDBOX=docker BAZILION_BASH_SANDBOX_IMAGE=debian:bookworm-slim \
  pnpm tsx apps/cli/src/index.ts serve &
export BAZILION_HOME=/tmp/baz041-home BAZILION_SERVER=http://127.0.0.1:4399
pnpm tsx apps/cli/src/index.ts provider enable lmstudio
pnpm tsx apps/cli/src/index.ts provider models-set lmstudio baz041-stub
pnpm tsx apps/cli/src/index.ts agent spawn --profile default --team default --name baz041-tester
# optional browser surface
cd apps/web && BAZILION_DAEMON=http://127.0.0.1:4399 pnpm dev   # http://127.0.0.1:4322
```

Read retained output: `bazilion team log default <commandId>`, or
`GET /api/teams/default/coding-commands/<commandId>/log`.

### Traps found while running this (each cost real time)

- `BAZILION_BASH_SANDBOX` must be in the **daemon process environment**. `bazilion config set`
  does not change the reported `configuredExecution`, which reads `process.env`.
- The **bootstrap token cannot log a browser in** once setup is complete; `/api/login` only
  accepts it on a fresh install. Mint a device token with `bazilion token create <label>`.
- `POST /api/agents/:id/chat` requires `expectedSelection` from
  `GET /api/agents/:id/sessions/head`; otherwise it fails with
  `conversation_selection_required`.
- `curl ... > file` block-buffers, so killing it mid-turn can show zero captured frames. Read the
  DB or use a TTY when observing disconnects.
- A fake provider must key off the **last** message role, because pi replays prior turns' tool
  results in the history.
- The CLI prints a misleading "check that `BAZILION_SERVER` matches" hint on a 403 on top of the
  correct error message. Cosmetic, but it points at the wrong cause.

## Finding: held coding evidence could not complete an approval (fixed)

Pursuing the *real* withholding path (a Team Policy `approval_required` edge) exposed two defects
that a staged release could not reach:

1. `approval-delivery-plan.ts:isChatFrame` required `images` on **every** `tool_result`, while
   `communication.ts:isUserFacingFrame` captures `repository_context` and `coding_command` results
   that carry no images. A held coding result therefore became an approval that could never be
   dispatched: `POST /api/approvals/:id/approve` returned
   `500 approval_delivery_invalid: http_chat_frame_payload`.
2. `routes/approvals.ts` released captured result **files** on dispatch but never the retained
   coding log, so even a dispatched coding frame would have left the bytes unreadable — directly
   contradicting the story's "Approval releases the captured bytes".

Both are fixed: the validator now mirrors the capture predicate (images are validated only when
present), and dispatch releases the retained log like it already released file bytes. The opaque id
parse now lives in one place (`codingCommandIdFromResult`), which also removed the duplicated
parsers in `communication.ts` and `telegram/mirror.ts`.

Scope note: defect 1 **predates BAZ-041** — it was introduced for BAZ-039's `repository_context`,
which the same predicate admits. Repository-context evidence under an approval posture was broken
the same way and is fixed by the same change.

Evidence: `apps/daemon/test/lib/coding-log-disclosure.test.ts` (held → approve → released;
held → deny → still held; direct delivery → released), pinned in the release gate as
`RETAINED-LOG-APPROVAL-RELEASE` and `RETAINED-LOG-DENIAL-NO-RELEASE`.

### Reachability of that path (measured, not assumed)

Running a real turn with `approval_required` on the agent→user edge showed how the posture behaves:

- The **first** user-facing frame was captured — the assistant delta, not the coding result — the
  response ended `202` with a `communication_pending` fatal carrying the approval id, and **no
  command ever ran** (no new `coding_commands` row).
- Each approval therefore yields one frame and the turn does not resume: the original NDJSON stream
  cannot be re-opened, and nothing replays the held frame on approval.

So the chat-posture "approval releases the captured bytes" path is **not reachable for coding
evidence today**: `coding_progress` and assistant deltas are held first and abort the turn, so the
terminal coding result is never produced. The dispatch-release fix is therefore defence in depth —
correct if such a frame is ever captured, and exercised in tests by capturing the terminal frame
directly rather than through a turn.

The **Telegram** mirror has the same class of gap and it *is* reachable, because mirroring does not
abort the turn: under an approval posture an approved `telegram_text` frame delivers the rendered
line but cannot release the log, since `TelegramTextApprovalPayload` carries only rendered text and
transport (`{chatId, topicId, text, parseMode}`) — no opaque command reference. Closing it means
adding that reference to the payload, validating it as optional, and releasing on dispatch. It is
deliberately **not** done here: it is a second change to a security-relevant stored payload under
an opt-in posture, and the intended semantics (should approving a one-line summary disclose the
whole retained log?) deserve an explicit decision.

## Caveats

1. **Criterion 4's withheld state was staged in this run.** An existing retained row was
   un-released (`UPDATE coding_command_logs SET released_at = NULL`), which exercises the read
   surface end to end — route, proxy and UI copy — but is not genuine egress withholding. The real
   path is a Team Policy `approval_required` edge; the round trip is now covered by tests, but it
   was not re-run manually here.
2. **No real-model turn.** The fake provider scripts the `coding_command` call, so "a real model
   chooses to run a command from an ordinary prompt" is not established by this record.
3. **Criterion 5's edges are unobserved.** Quota eviction, expiry/deletion tombstones and
   persistence failure are covered by `apps/daemon/test/core/coding-command-logs.test.ts` and the
   release gate, not by this run.
4. The Telegram approval posture cannot release a retained log (see the reachability notes above).
5. The browser steps were driven manually. There is no scripted browser check yet; the repo
   pattern for one is [`scripts/check-repository-context-ui.mjs`](../../scripts/check-repository-context-ui.mjs)
   (inline fake provider + `startTestServer` + Playwright), which is the natural place to extend if
   these steps should run unattended.
