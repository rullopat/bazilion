---
id: BAZ-037
title: Structured agent questions across web, CLI, and Telegram
status: draft
size: L
created: 2026-09-07
priority: high
---

# BAZ-037 — Structured agent questions across web, CLI, and Telegram

## User stories

- **As an operator**, I want an Agent to ask a clear question with choices and a free-text answer
  when my preference is missing, so it can continue with the information I actually intended.
- **As an operator using Telegram and the web**, I want to answer a pending question from either
  surface and see the same outcome, so switching devices cannot answer the wrong conversation.
- **As an operator returning after an interruption**, I want to see whether a question is still
  waiting, answered, skipped, expired, or cancelled, so I do not mistake silence for progress.

## Goal

Add one daemon-owned clarification tool for an eligible human conversation. The Agent asks one
bounded question, waits for an explicit answer or typed no-answer outcome, and resumes the same
live turn. Web, TTY CLI, and paired-owner Telegram share its lifecycle and response contract.
Question responses provide information; they never grant execution or communication permission.

## Why and current baseline

- [Chat wire events](../../../packages/api-types/src/events.ts) include `command_approval` but no
  operator-question event or structured answer. The existing approval type is shell-specific.
- [ChatPane](../../../apps/web/src/components/ChatPane.tsx) restores pending shell cards after
  reload. [CLI chat](../../../apps/cli/src/commands/agent.ts) owns one readline prompt and can
  answer shell requests. These are useful interaction precedents, not a shared decision registry.
- [Shell approvals](../../../apps/daemon/src/lib/bash-approval.ts) are ephemeral and distinct from
  durable Team Policy approvals. Neither represents a missing user preference.
- [The durable user queue](../../../apps/daemon/src/lib/user-queue-drain.ts) waits for the active
  Agent turn to finish. Queuing an answer there would strand a worker waiting for that answer.
- [Turn preparation](../../../apps/daemon/src/lib/turn-preparation.ts) and
  [trusted invocation](../../../apps/daemon/src/lib/turn-invocation.ts) own execution authority.
  [Tool composition](../../../apps/daemon/src/runtime/pi/tools.ts) has separate configured and
  protected capabilities; Telegram turns cannot obtain a question tool by enabling host tools.

OpenClaw 2.0 demonstrates the useful interaction: explicit choices with a free-text alternative,
native channel controls, and a visible terminal outcome. Bazilion can adopt this without taking
on a persistent workflow engine or changing its single-operator model.

## Scope

### Question and lifecycle

- Start with one question per tool call, two to four single-select choices, an optional recommended
  choice, free-text Other, and Skip. Bound prompt, labels, descriptions, and answer lengths.
- The daemon assigns question identity and binds Agent, Team, session, turn, tool call, creator
  authority, and eligible response routes. The model supplies question content only.
- Use explicit `pending`, `answered`, `skipped`, `expired`, and `cancelled` states. Return either
  a structured answer or `no_answer` with a reason; no missing answer becomes a synthetic choice.
- Only one question may wait per Agent turn. Use a bounded deadline within the existing turn
  lifetime; asking cannot extend execution budgets or keep a disconnected worker alive forever.
- Keep narrow question records for card recovery and terminal outcomes. A browser reload leaves
  a live question answerable. Worker loss, daemon restart, or turn cancellation closes it visibly;
  startup reconciliation cancels pending records from the previous daemon lifetime.
- The continuation waiting on IPC is process-local. Never restart the turn, replay a tool, or
  claim that recording an answer proves the Agent consumed it. If the worker dies after acceptance,
  show the accepted answer and interrupted continuation separately.
- Store the question and consumed answer in the owning session's canonical transcript, using
  stable question identity for correlation. Avoid duplicating complete transcripts or introducing
  runs/events tables. Define bounded retention for terminal question records during refinement.

### Daemon, IPC, and policy

- Put hermetic question types/envelopes in `@bazilion/api-types`; implement daemon-owned list,
  detail, and response operations, an IPC host, and a selected `ask_user` tool.
- Enable it only for human-origin turns with a daemon-verified response route, including eligible
  protected Telegram turns. It grants no browser, MCP, host environment, or filesystem capability.
- Scheduled, inbox-wake, restricted-review, and other unattended turns without a supported human
  response route do not receive the tool. The worker cannot invent a recipient or mark itself
  interactive; client capability alone cannot bypass trusted turn preparation.
- Authenticate every response and apply existing Team Policy authorization to question delivery
  and answer ingress. Revalidate live membership, session ownership, and Telegram binding before
  settlement. A denied or approval-required edge cannot be treated as an answered question.
- If policy requires a communication approval, use its existing source-owned decision path;
  answering a question cannot satisfy that approval. Pending approval never extends the question
  deadline, and later approval cannot revive an expired question or closed turn.
- Bind replies to the exact question, including idempotency. Identical retries return the known
  outcome; conflicting answers, late replies, and other clients losing the race receive that
  authoritative outcome without another worker resume.
- A selected option saying “yes” is still clarification data. All downstream shell and
  communication actions retain their normal authorization checks. The tool is not for credentials;
  credential setup continues through existing configuration flows, with no new secret-entry path.

### Operator surfaces

- **Web:** show the Agent and conversation beside an inline question card, keyboard-accessible
  choices, editable free text, Skip, pending feedback, and answer/error state. Recover cards through
  the daemon after reload; do not reconstruct pending state from a stale browser event alone.
- **TTY CLI:** reuse the single stdin owner for choices, free text, and Skip. Provide HTTP-client
  list/detail/answer parity for an existing question. Piped/non-interactive chat advertises no
  live response capability and never blocks trying to read a terminal.
- **Telegram:** deliver a question in the paired owner's authorized Agent topic with native choice
  buttons. Free text uses a reply to that exact prompt or an explicit question identifier. Check
  callback sender, chat, topic, prompt, question, and current binding before accepting anything.
- Route a proven question answer to its waiter instead of the ordinary inbound FIFO. Unrelated
  topic text remains normal chat; plain “1” or “yes” without explicit correlation is not an answer.
  Best-effort button updates reflect settlement; stale buttons still receive authoritative status.
- **Native mobile is deferred:** do not advertise native response support. Show an explicit
  unsupported/waiting state and a supported web handoff where reachable, rather than dropping the
  event. Mobile-only turns without another supported response route cannot ask this question.
- BAZ-035 session-library work is not a prerequisite. Capture the session identity at question
  creation now; if session switching lands, responses never follow a newly selected current session.

## Acceptance

- An eligible web, TTY CLI, or Telegram turn asks a question and consumes one explicitly submitted
  answer in its originating session; another supported client can resolve the same question.
- Client reload preserves an answerable question while its worker is alive. Agent reset/removal,
  worker exit, daemon restart, cancellation, expiry, and revoked access leave no active waiter or
  answerable stale card; affected surfaces explain the resulting state.
- Two clients answering concurrently, repeated callbacks, and a response racing expiry/cancel
  settle once. Lost HTTP acknowledgements can be reconciled without submitting a second answer.
- A consumed answer is recorded with its question; an accepted but unconsumed answer is not shown
  as successful continuation. Neither condition silently starts a replacement turn.
- Wrong Agent/session/topic/sender responses and forged worker identities cannot reach a waiter.
  Policy changes take effect before settlement, and no clarification bypasses either approval type.
- Skip/expiry return typed `no_answer`; a cancelled turn stops. A live Agent may use a reasonable
  default or explain the blocker, but it must retain any requirement for an actual authorization.
- Protected eligible turns can ask through the narrow IPC capability; unsupported unattended
  invocations receive no tool and retain their existing protected posture.

## Out of scope

- Multiple-question forms, multi-select, questionnaires, assignments, reminders, or escalation.
- Credential collection, shell approval in Telegram, or changes to communication approval rules.
- Durable worker checkpoints, automatic restart/resume, tool replay, or a general follow-up queue.
- Native mobile question controls, OS push notifications, and a new Attention Center source.
- Multi-operator identity, shared-account access, or questions directed to arbitrary recipients.

## Tests

- Contract/state tests cover input bounds, trusted identity, deadline limits, lifecycle cleanup,
  idempotent retries, conflicting answers, answer-versus-expiry races, and startup cancellation.
- Daemon/IPC tests cover authenticated reads/responses, worker isolation, accepted-but-unconsumed
  replies, closed-session rejection, protected capability selection, and unattended exclusion.
- Policy and Telegram tests cover owner/topic rebinding, revoked access, existing approval gates,
  duplicate/stale callbacks, explicit free-text correlation, and ordinary-message FIFO separation.
- Web/CLI integration checks cover reload recovery, failed acknowledgement reconciliation,
  keyboard/screen-reader behavior, one stdin owner, and non-TTY operation. Verify truthful native
  mobile fallback. Run affected typechecks and the applicable security acceptance cases.

## Open Questions

- **Wait budget:** recommend five minutes, capped by the turn's existing deadline; refine after
  checking actual worker limits. Keep the Agent slot occupied while its live worker waits.
- **Question retention:** recommend a small daemon-owned domain record, with startup cancellation
  and bounded terminal retention; canonical conversation content remains in session JSONL.
- **Delivery policy mapping:** identify the exact existing ingress/egress attempt contracts and
  approval dispatch hooks before implementation. Reuse the shared authorizer; no new bypass flag.
- **Mobile sequencing:** recommend web/TTY/Telegram first with explicit fallback, then a separate
  native-card slice against the same wire contract. Do not count a web handoff as native parity.

## Inspiration

- [OpenClaw v2026.8.1 / 2.0 release](https://github.com/openclaw/openclaw/releases/tag/v2026.8.1)
  (2026-08-31): structured questions across web, native cards, and messaging controls.
- [OpenClaw Ask user](https://docs.openclaw.ai/tools/ask-user) (reviewed 2026-09-07): choices,
  free text, Skip, bounded waits, and explicit no-answer outcomes; clarification is not permission.
