---
id: BAZ-016
title: Harness ingress, egress, scheduler, and turn-boundary enforcement
status: todo
size: L (1-2 weeks)
created: 2026-07-10
refined: 2026-07-10
priority: high
note: Complete BAZ-011 enforcement at every user, transport, scheduler, and turn boundary with atomic claims and lifecycle leases. Activation is release-coupled to BAZ-017 recovery UX.
---

# BAZ-016 - Harness ingress, egress, scheduler, and turn-boundary enforcement

**Status:** Refined and ready after BAZ-011 and BAZ-015. Enforcement may merge disabled;
it may be released enabled only with BAZ-017. ADR 0001 is normative.

## User stories

- **As an operator**, I want web, CLI, API, Telegram, tools, and scheduler to enforce the
  same policy before their first protected side effect.
- **As two Group owners**, I want both sides to consent to cross-Group delivery at the
  actual delivery boundary.
- **As an operator**, I want trigger and inbox denial to become one terminal audited event,
  not a retry loop or split crash state.

## Goal

Apply BAZ-011's authorizer/audit contract to every remaining runtime boundary and establish
an explicit linearization point for turn start, lifecycle mutation, database effects, and
external transport items.

## Communication truth table

| Attempt | Required current edge(s) | Deny before |
|---|---|---|
| User -> Agent via web/CLI/API/Telegram | Target Group `user -> Agent` | Attachment/media persistence, queue insert, active-turn registration, worker start |
| Agent -> user via HTTP/proactive/file/image/Telegram | Source Group `Agent -> user` | Final enqueue/send of each frame or item |
| Same-Group A -> B | Exact owning-Group `A -> B` | Message insert/wake |
| Cross-Group A -> B | Source `A -> outside_group` and target `outside_group -> B` in one snapshot | Message insert/wake |
| Reply | Same as a new underlying path | Insert/delivery |
| Agent inbox read/wait/drain | Re-evaluate original sender -> recipient | Return/prompt inclusion |
| Operator history/policy/block/inbox read | No delivery edge | API authentication applies instead |

## Scheduler truth table

| Path | Atomic actor/claim behavior |
|---|---|
| Due interval/cron | Under target turn/lifecycle lease, claim occurrence, evaluate `user -> Agent` with `scheduler_trigger`, update fired state, and insert denial in one transaction; allowed turn is registered before lease release |
| Inbox wake | Claim rows and evaluate each current sender/recipient in one transaction; denied disposition+block is atomic, allowed rows only enter prompt, allowed turn registers before lease release |
| Mixed batch | Per-message result; empty allowed set starts no turn |
| Agent moved after insert | Recompute current same/cross-Group path; insertion allow is not a lease |
| Scheduler output | Each user-facing frame/item independently checks `Agent -> user` |
| Archived/active target | Archived denies; active retains existing defer-until-idle without a duplicate attempt |

Agent tool read/wait and scheduler drain use the same `inbox:<messageId>` denial key.
Trigger uses `scheduler_trigger:<triggerId>:<scheduledOccurrence>`. Claim, terminal state,
and block insert cannot split across a crash or concurrent tick.

## Turn/lifecycle linearization

- Extend and audit BAZ-010's daemon per-Agent turn/lifecycle lease for authorized turn start;
  BAZ-015 lifecycle operations already use the same primitive.
- The lease spans current-state authorization, database claim/persistence, active-turn
  registration, and commit. On failure, registration/claim rolls back before release.
- Lifecycle mutation either runs first or observes active and rejects; it cannot enter
  between an allow and worker registration.
- Policy saves serialize through the same database write boundary. Database effects combine
  authorization and mutation in one transaction.
- External effects reauthorize immediately before final enqueue/send. Each HTTP ChatFrame,
  proactive item, file/image, or Telegram item has its own typed transport attempt. A sent
  item cannot be retracted, but every later item observes new policy.
- Telegram/media ingress checks before download and rechecks the same logical attempt before
  persistence/queue/turn registration.

## Scope

- Carry semantic source/target, origin, and typed attempt identity through every
  `runAgentTurn` caller.
- Enforce user ingress before web/CLI/API attachments and turn start, and before Telegram
  media download/queue insertion.
- Enforce every direct HTTP/NDJSON, proactive, file/image, and Telegram Agent-output item
  immediately before transport.
- Implement the scheduler and turn/lifecycle contracts above, including claimed/delivered/
  terminal-blocked inbox state and occurrence claims.
- Re-audit every direct message insertion, queue, turn-start, and user-facing transport;
  new paths must call the same service.
- Return visible structured control results without revealing denied payload content.
- Add end-to-end metrics/logging and operational degraded signals.
- Add a shared compiled `HARNESS_MANAGEMENT_CONTRACT_VERSION`, initially 0 and exposed in
  health/capabilities. Startup refuses `HARNESS_ENFORCEMENT=on` unless the compiled version
  is at least 1. BAZ-017 changes it to 1 only after its release acceptance passes. Bazilion
  ships daemon/web from the same release, so this is a release-manifest check rather than a
  runtime handshake between processes.

## Out of scope

- Persistence/lifecycle semantics (BAZ-010/015), authorizer/audit primitives (BAZ-011), or
  production editor/recovery UI (BAZ-012/017).
- CLI policy management (BAZ-013), approvals (BAZ-014), workflows, routing/retries,
  transformation, federation, daemon command approval, or sandbox policy.

## Acceptance criteria

- Every row in both truth tables passes for same/cross-Group, reply, moved, archived,
  mixed-batch, policy-change, and concurrent lifecycle cases.
- A pre-download denial downloads nothing. If policy changes during an already-authorized
  media fetch, the mandatory second check discards transient bytes, persists/queues
  nothing, and starts no worker.
- Denied Agent output crosses no HTTP/proactive/file/image/Telegram boundary; authenticated
  transcript/history remains readable.
- External revocation is frame/item granular and test proves a policy change blocks all
  later items without claiming already-sent bytes can be retracted.
- Trigger occurrence claim/fired state/denial and inbox claim/disposition/denial are atomic
  and idempotent under crash injection and concurrent ticks.
- Allowed-only prompt construction and no-turn-on-empty behavior are deterministic.
- The turn/lifecycle lease closes the allow-to-worker-registration race for chat, Telegram,
  triggers, and inbox wake against move/archive/delete.
- Integration inventory finds no unclassified message insert, turn start, or direct
  transport.
- Gate activation fails startup until the compiled management contract is version 1;
  default remains off and mismatched separately deployed web builds are unsupported.
- No edge invokes a workflow, routes/retries a payload, or creates approval.

## Tests and verification

- Chat/attachment and Telegram media ingress tests with policy/lifecycle races.
- HTTP/NDJSON, proactive, file/image, and Telegram egress tests at per-item granularity.
- Scheduler claim, fired, allowed/denied/mixed batch, moved/archived, crash injection,
  concurrency, and busy-loop tests.
- Turn/lifecycle lease ordering tests across every `runAgentTurn` caller and BAZ-015
  mutation.
- Full repository tests, root/web typechecks, lint, build, focused transport smoke tests,
  and release-gate default/readiness tests.
