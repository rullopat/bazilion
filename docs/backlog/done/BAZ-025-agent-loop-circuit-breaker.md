---
id: BAZ-025
title: Durable agent-message loop circuit breaker
status: done
size: M
created: 2026-08-03
shipped: 2026-08-03
priority: high
---

# BAZ-025 — Durable agent-message loop circuit breaker

## User stories

- **As an operator**, I want agent-to-agent message chains to have a hard daemon-enforced limit so prompt drift cannot create unbounded LLM spend.
- **As an operator diagnosing automation**, I want to see which causal chain was stopped, where, and why without retaining another copy of message payloads.
- **As an Agent**, I want ordinary new conversations to remain independent while replies and messages emitted from an inbox wake retain their causal ancestry.

## Goal

Track durable causality on agent messages and reject a send before it can wake another LLM turn when the chain exceeds a configurable hop ceiling. Enforcement lives at the daemon communication boundary and does not depend on `reply_to`, prompt compliance, Team Policy, Telegram, or process-local counters.

## Scope

- Add `causal_chain_id` and `causal_hop` to every message in the canonical clean-install schema.
- Explicit replies inherit from `reply_to`; messages emitted during an inbox wake inherit from the highest-hop claimed message even if the tool omits `reply_to`; unrelated operator sends open a new chain.
- Enforce `BAZILION_AGENT_LOOP_MAX_HOPS` with a conservative default of 8. Record a durable payload-free break event and reject the send before insertion.
- Keep communication approval and Team Policy behavior intact; approval-delivered messages retain the causality captured at request time.
- Expose recent break events through HTTP, CLI, and the Agent inbox web surface.

## Out of scope

- Provider-token or currency accounting.
- A general workflow engine, retries, or automatic resumption of a stopped chain.
- Telegram rate limits, shell approval, or Team Policy denial semantics.
- Compatibility migrations for pre-v0.12 alpha databases.

## Tests

- New messages start at hop 0; explicit replies inherit and increment.
- Inbox-wake sends inherit causality even without `reply_to`, including three-Agent cycles.
- The ceiling persists across DB reopen/restart and records no payload.
- Separate new threads do not consume each other's budget.
- Policy-approved delivery keeps its captured chain metadata.
- API, CLI, and web diagnostics render recent stops.

## As-built

- Messages persist a causal chain identifier and hop count; direct replies and inbox-triggered
  turns preserve ancestry, while independent operator messages begin new chains.
- The daemon rejects sends beyond `BAZILION_AGENT_LOOP_MAX_HOPS` (default 8) before message
  insertion and records a payload-free `agent_loop_break_events` diagnostic row.
- Team Policy approvals preserve captured causality and revalidate the hop budget at dispatch.
- Operators can inspect recent stops through `GET /api/agents/:id/loop-breaks`,
  `bazilion inbox loop-breaks <agent>`, and the Agent inbox web page.
- The canonical backup schema, API types, documentation, and release Changeset include the new
  contract. The feature is merged for the next release and intentionally remains unreleased.
