---
id: BAZ-037
title: Structured agent questions across web, CLI, and Telegram
status: done
shipped: 2026-09-08
release: v0.15.0
size: L
created: 2026-09-07
refined: 2026-09-07
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

## Baseline before implementation

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

## Refinement inputs (resolved below)

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

## Refined implementation contract (2026-09-07)

- **Identity and storage:** add a narrow daemon-owned question record bound to a generated live
  turn identity, Agent, captured Team/conversation and Pi tool-call ID. The worker submits question
  content plus its actual tool-call ID; its IPC host supplies every authority/recipient field.
  There is one pending question per live turn and at most 16 questions per turn, 100 pending per
  home. Retain terminal content/answers for seven days and at most 10,000 records per home; reject
  capacity rather than evicting pending records. UUIDs are never reused. Canonical Pi tool results
  include the question ID, normalized question and typed answer/no-answer result.
- **Content:** prompt at most 4,096 UTF-8 bytes; two to four choices, each label at most 120 bytes
  and description at most 500 bytes; optional zero-based recommended choice index. Free text is
  at most 4,096 bytes. Reject blank/duplicate labels and extra identity/authority fields. Responses
  carry a UUID request ID, exact conversation ID, and either a choice index, text, or Skip.
- **Wait lifetime:** five minutes per question, with the Agent's existing cancellation signal and
  worker IPC lifetime authoritative. Current normal turns have no universal wall-clock deadline;
  do not invent or reset a provider execution budget. If a caller supplies an existing deadline,
  use the earlier deadline. One live waiter and the per-turn question cap bound repeated asks.
  Worker loss/release cancels pending questions; startup and staged restore cancel all prior live
  questions and mark accepted-but-unconsumed continuation interrupted. No replacement worker starts.
- **Eligibility:** authenticated foreground web requests and TTY CLI requests may offer a narrow
  question response capability. Turn preparation verifies the human invocation and supported
  route before binding that capability; scheduler, inbox and review invocations cannot acquire it
  through a request flag. Native and piped CLI requests advertise none. Telegram-derived normal
  and approved queued turns use their retained owner/topic/credential binding and a live bot route.
  Queued HTTP work does not inherit an expired connection's capability. Questions are independent
  of shell-approval mode: protected Telegram may ask while shell approval remains `auto_deny`.
- **Policy:** use `authorizeAgentEgress` for delivery and `authorizeUserIngress` for an answer,
  with stable question-specific attempt identities. Revalidate current membership, captured
  conversation and Telegram binding before settlement and after outbound pacing. Add typed
  reference-only `question_delivery` and `question_answer` canonical approval plans; the question
  record retains immutable content/proposed answer. A held delivery does not expose its card
  content as already delivered; a held answer is not accepted or passed to the worker. Existing
  approval claiming rechecks the source and live deadline before releasing the specific effect.
  Expired/closed questions cannot be revived by later approval; no second approval dispatcher or
  permission interpretation is added. Losing/conflicting replies return authoritative state.
- **Accepted versus consumed:** response persistence settles at most once, but it does not prove
  consumption. Pi emits subscriber events before appending the `message_end` entry in the pinned
  implementation. Therefore neither receipt of IPC nor `tool_execution_end` alone marks consumed.
  A worker acknowledgement after Pi persistence must match the daemon's bounded canonical-session
  read of the exact question/tool-result tuple. UI says the answer reached the conversation only
  with this evidence, and never equates it with completion of the subsequent work. Failure between
  acceptance and evidence remains explicitly interrupted/unconfirmed; do not replay the tool.
- **Telegram correlation:** callback data names only the question ID and choice/Skip; the daemon
  compares the callback sender, chat, topic and exact sent prompt message ID with its captured
  binding. Free text must reply to that prompt or use an explicit question-ID command. Intercept
  proven replies before BAZ-036 admission; unrelated messages remain independent queued turns.
  Ambiguous prompt delivery cannot establish a prompt-message binding or auto-resend indefinitely.
- **Clients:** authenticated list/detail/answer API and typed client methods back web and CLI.
  Web reload fetches live state; choices use normal keyboard controls, and retries preserve the
  exact answer request ID. CLI retains its single readline owner. Mobile renders a waiting or
  unsupported notice with an approved web handoff where available and never claims native support.

## Implementation and acceptance evidence

The implementation is committed in PR #44 at `6e37e77`; this story shipped in v0.15.0. Passing
integrated checks and commit references are tracked in [the milestone progress log](../BAZ-035-038-progress.md).
See [Agent questions](../../questions.md) for operator instructions and the repeatable real-worker demo.

| Acceptance | Evidence |
| --- | --- |
| Eligible clients resolve one question in its originating session | `scripts/check-question-flow.mts` exercises real daemon/Pi workers for choice, Other and Skip; full web reload/keyboard and actual PTY demos pass. `turn-preparation.test.ts` exercises trusted Telegram preparation, callback routing and canonical held-answer release to the same waiter. |
| Reload and interruption leave truthful state | Browser reload recovers the live question. `questions.test.ts`, `question-waiters.test.ts`, `question-approval.test.ts` and worker tests cover cancellation, deadline, worker loss, startup and staged restore. Live service revalidates current Agent, Team, conversation, policy and Telegram binding. |
| Races and lost acknowledgements settle once | Repository tests race competing responses and deadlines; approval tests freeze held proposals. Browser retry fixture preserves the original request after a failed acknowledgement. Telegram repeated callbacks reuse stable identity and bypass the queue. |
| Consumption is separate from acceptance | Canonical transcript verification tests reject missing, altered, duplicate, reordered and wrong-conversation results. Real workers confirm consumption. Daemon-signed receipts retain authorized history after narrow question records expire. |
| Exact authority and approvals remain enforced | Input, worker-frame, receipt and approval tests reject forged identities and content. Canonical question delivery/answer claims bind current policy evidence; expired or cancelled source holds cannot revive a waiter. Telegram transport tests recheck sender, topic, prompt and post-pacing destination. |
| Skip, expiry and cancellation remain explicit | Real-worker Skip returns typed no-answer; waiter expiry tests return the expiry reason; cancellation aborts the originating waiter and no replacement turn starts. |
| Protected eligibility is narrow | Turn preparation and worker runtime tests enable only trusted supported human routes, including Telegram with auto-denied shell approval. Scheduled, review, inbox, queued HTTP, native and piped chat do not inherit interactive capability. Mobile handoff tests exclude credentials from the URL. |

Browser evidence includes desktop and 390px layouts, keyboard focus/submission and no horizontal
overflow. Telegram evidence uses fake APIs and protected preflight; no live external Telegram
message was sent. These checks do not claim native question controls or real-device acceptance.

## As-built release record

Shipped in [v0.15.0](https://github.com/rullopat/bazilion/releases/tag/v0.15.0) on 2026-09-08
through PR #44 and version PR #45. Earlier implementation checkpoint notes are historical.
The complete first-slice scope above is delivered; stated exclusions remain deferred.
See the milestone ledger for integrated, guided browser and release verification evidence.
