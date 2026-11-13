---
id: BAZ-025
title: Agent-message loop breaker
status: done
created: 2026-08-03
shipped: 2026-08-03
release: v0.12.0
---

# BAZ-025 — Agent-message loop breaker

## Outcome

Agents messaging each other cannot run up unbounded model spend: a chain of messages stops at a
hop limit the daemon enforces, and you can see which chain stopped, where and why, without a
second copy of the messages.

## Scope

- Every message carries a causal chain id and a hop count. A reply inherits from `reply_to`; a
  message sent during an inbox wake inherits from the highest-hop message that woke the Agent,
  even without `reply_to`; a message you send starts a new chain.
- A send past `BAZILION_AGENT_LOOP_MAX_HOPS` (default 8) is refused before it is stored, and a
  payload-free break event is recorded. The refusal reaches the sending Agent as a tool error.
- Break events appear in the Agent's inbox and in Attention as `agent_loop_break`.

## As built

- Columns `messages.causal_chain_id` and `causal_hop`; table `agent_loop_break_events`.
- CLI: `bazilion inbox loop-breaks <agent> [--limit N]`.
- Web: the Agent's **Inbox** tab; the hop limit is on `/config/services` (**Agent Runtime**).
- HTTP: `GET /api/agents/:id/loop-breaks`.
- Code: `apps/daemon/src/lib/agent-loop-guard.ts`, called from the one send path in
  `lib/communication.ts`.

## Known limits

- A stopped chain is not resumed; a new message from you starts a fresh one.
- The limit counts hops, not tokens or money.
