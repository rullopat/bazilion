---
id: BAZ-041
title: Live coding progress and retained diagnostics in chat
status: todo
size: M
created: 2026-09-07
refined: 2026-09-09
priority: high
note: Extend BAZ-040 command receipts and chat; source-snapshot applicability belongs to BAZ-042.
---

# BAZ-041 — Live coding progress and retained diagnostics in chat

## User stories

- **As an operator**, I want to see what my Agent's build or test is doing while it runs,
  so I can distinguish useful progress from a stalled task without configuring checks.
- **As a coding Agent**, I want to inspect retained diagnostic output after a failed command,
  so I can investigate the cause even after the command container has disappeared.
- **As an operator returning to a conversation**, I want to reopen output that was shared with me,
  so I can understand the result without asking the Agent to rerun the command.

## Goal

Extend existing `coding_command` activity and `coding_receipt` access with bounded live progress
and retained diagnostics. Keep the ordinary chat task as the entry point. The Agent chooses the
command using BAZ-039 context and BAZ-040 admission; there is no saved check catalog or Run Check form.

## Why and current baseline

Reviewed against PR #46 commit `81aaa31` on 2026-09-09:

- BAZ-040 already implements execution-owned command receipts, observed terminal states, protected
  execution, cancellation, redacted 64 KiB diagnostic tails, and policy-checked peer receipt access.
  Reuse [wire types](../../../packages/api-types/src/coding-environment.ts),
  [diagnostics](../../../apps/daemon/src/lib/coding-environment/diagnostics.ts), and
  [Agent host](../../../apps/daemon/src/lib/coding-environment/agent-host.ts).
- [Pi events](../../../apps/daemon/src/runtime/pi/events.ts) do not expose live execution updates.
  The current chat renders a terminal result and caches already-delivered details in the mounted
  component. Private transcript replay does not itself authorize publishing those details again.
- BAZ-040 input fingerprints are bounded environment/input observations, not exact code snapshots.
  BAZ-042 owns the stronger source identity contract; this story must not award a verified-code badge.

## Scope

### Activity during the existing turn

- Carry start, bounded output updates and terminal state through hermetic IPC/chat events using
  existing Agent/session/tool-call and receipt identities. Do not add a command runner or job queue.
- Extend the actual admitted coding executor, including protected Docker commands; Pi-native tool
  updates alone are insufficient for the custom `coding_command` path. Preserve exact shell approval,
  workspace ownership, cancellation and cleanup semantics.
- Show a concise command label, elapsed time, running state and expandable text tail in chat.
  A rerun or correction is ordinary Agent input through existing admission/follow-up handling.
- Define whether each update replaces a cumulative tail or adds an ordered chunk. Bound event size,
  throttle frequency and subscriber queues; disconnects and slow clients cannot block execution.
- Clearly distinguish failure, timeout, cancellation, blocked admission and interrupted/unknown.
  No automatic replay after disconnect, lost worker or restart.

### Retained diagnostics and access

- Extend the existing receipt's bounded output rather than creating a parallel receipt identity.
  Retain a capped log before scratch cleanup, with explicit byte count, truncation and availability.
  Use opaque references and bounded read/search pages, never worker-supplied host paths.
- Producing Agents retrieve eligible logs through turn-bound IPC. Extend the current authorized
  message/receipt access for peers; do not grant access to every Team member or the private transcript.
- Privately retained bytes remain private until source-owned egress authorizes their disclosure.
  Persist the captured output shared with the operator so it can be reopened after navigation or
  restart. Live events, history, CLI reads, downloads and Telegram links honor that same decision.
  Approval releases the captured bytes; it cannot authorize a later reread of changed output.
- Redact known credentials across chunk boundaries before retention or emission, including refreshed
  credentials. Safely render control/binary bytes and hostile HTML. State redaction limits honestly.
- Bound per-command bytes, per-home storage, read sizes and retention; show expired, deleted,
  partially retained and unavailable output truthfully. A zero exit may remain known when log
  persistence fails, but missing evidence must not appear complete.
- Keep Pi JSONL authoritative for conversation history. Define log retention/deletion/backup as
  narrow evidence storage; reuse BAZ-034 primitives where suitable without auto-publishing Team results.

### Surfaces

- Web and CLI show live progress and reopen authorized retained diagnostics. Telegram receives
  concise authorized outcomes with authenticated access, without a stream of every output chunk.
  Native clients retain a gateway fallback. No separate Team readiness or checks dashboard.
- BAZ-042 can later attach snapshot applicability to these same receipts; it is not a prerequisite
  for useful progress and diagnostics. Display outcome and applicability as separate facts.

## Acceptance criteria

1. From an ordinary chat request on a Team without coding defaults, a real protected command shows
   changing output before completion, without repeated-tail duplication or a setup form.
2. Failure diagnostics remain available to the producing Agent after scratch cleanup; authorized
   operator output can be reopened after page navigation and daemon restart without rerunning work.
3. Cancel, timeout, worker loss, preflight failure and successful/nonzero exits remain distinct;
   disconnect/reconnect does not replay execution or fabricate terminal acknowledgement.
4. Held/denied output remains inaccessible through live events, replay, links and peer access.
   Credential chunk splits, control bytes and hostile markup do not leak or execute in clients.
5. Quota, truncation, expiry, deletion and persistence failure have truthful, bounded behavior.
6. Web/CLI show consistent command outcomes; source coverage is never inferred from an exit code.

## Dependencies and sequencing

- Build on implemented BAZ-039/040, existing communication authorization, BAZ-036 follow-ups and
  BAZ-034 retained-byte lifecycle. Do not reimplement receipts, peer handoff or writer admission.
- Implement this next. BAZ-042 adds immutable source snapshots and check applicability afterward.
  BAZ-043/044 consume both stories, without requiring a new execution engine.

## Out of scope

Snapshot capture (BAZ-042), named Team checks, operator-driven probe execution, test-framework
parsers, persistent terminals/services, CI hosting, retries, changing network policy, automatic
publication, and claims of code correctness. Existing task-driven BAZ-040 preparation remains usable.

## Tests and manual-semiauto acceptance

- Stream deterministic incremental output in real Docker; exercise cumulative updates, huge lines,
  split credentials, binary/control bytes, slow clients, cancellation and lost terminal messages.
- Exercise persistence failure, quotas, expiry/deletion, backup/restore and scratch cleanup;
  cover producer/authorized peer reads and held user egress on every retrieval surface.
- Ask “Run the app test and investigate any failure.” Observe progress, expand the useful failure,
  navigate away and reopen authorized output; the Agent can inspect logs and continue normally.
- Run relevant root/web checks and adversarial security acceptance for the changed boundaries.

## Refinement decisions

- Keep the current 64 KiB receipt tail and retain at most 2 MiB of diagnostic text per command,
  256 MiB per Bazilion home, for seven days. Evict expired logs before quota-based oldest-first
  eviction. Include retained logs in encrypted backups and preserve their original expiry.
- Key live and retained output to the existing Agent/session/turn/tool-call/receipt identity.
  Output is private until the normal source-owned user or peer delivery authorizes the captured
  bytes. Reconnect can replay only already-authorized bounded updates; refreshed credentials join
  the redaction set before subsequent bytes are retained or emitted.
