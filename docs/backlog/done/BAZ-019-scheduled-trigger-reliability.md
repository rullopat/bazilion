---
id: BAZ-019
title: Scheduled triggers without heartbeat files
status: done
size: L (1-2 weeks)
created: 2026-07-19
refined: 2026-07-19
shipped: 2026-08-01
priority: high
note: Breaking alpha cleanup; HEARTBEAT.md is removed rather than deprecated.
---

# BAZ-019 - Scheduled triggers without heartbeat files

**Status:** Done. Unreleased.

## User stories

- **As an operator**, I want a scheduled task's instructions and schedule configured together,
  so I can understand what an Agent will do without coordinating a trigger message with a
  separate `HEARTBEAT.md` file.
- **As an operator**, I want a due scheduled task to survive Agent contention and daemon
  restarts, so work is not silently lost while an Agent is busy.
- **As an operator**, I want bounded retry and visible terminal failure state, so transient
  failures recover and permanent failures can be diagnosed.
- **As a maintainer**, I want Agents to remain the actors and triggers to remain ingress,
  so scheduling does not introduce a second kind of Agent or duplicate Agent lifecycle rules.

## Goal

Remove the OpenClaw-derived heartbeat-file convention and make interval/cron triggers the
single scheduled-work model. Follow with a narrow durable dispatch mechanism that records
delivery state for scheduled occurrences without reintroducing the deleted general-purpose
runs/events audit layer.

## Decisions

- There is no special scheduled-Agent subtype. A scheduled Agent is an ordinary Agent with
  one or more triggers.
- Trigger `message` is the complete instruction injected into the Agent turn.
- Dispatch persistence contains operational delivery metadata only; the session JSONL remains
  the canonical conversation and tool transcript.
- The default overlap policy is `coalesce`: missed interval occurrences while one dispatch is
  pending or running collapse into one future execution.
- The default failure policy is bounded retry, then an explicit terminal failure.
- This is a breaking alpha cleanup. Old `HEARTBEAT.md` files may remain on an operator's disk,
  but Bazilion no longer loads, exposes, copies, or edits them. No compatibility field or API
  alias is added.

## Scope

### Slice 1 - remove heartbeat files

- Remove `HEARTBEAT.md` from profile creation, loading, file APIs, Agent spawn, home tools,
  system prompts, CLI flags/output, web template editors, shipped templates, and current docs.
- Delete the unused heartbeat runtime helpers and their tests.
- Describe interval and cron resources consistently as scheduled triggers.

### Slice 2 - durable scheduled dispatch

- Add a clean-install `trigger_dispatches` table keyed idempotently by trigger and scheduled
  occurrence.
- Materialize due occurrences as pending dispatches and claim them transactionally when the
  target Agent becomes available.
- Recover abandoned running dispatches using a lease/timeout after daemon restart.
- Add bounded retry with attempt count, next-attempt time, and terminal error metadata.
- Coalesce interval occurrences by default; preserve an explicit path for queue/skip policies
  only if a concrete product use case requires them during implementation.
- Expose recent dispatch status through HTTP, CLI, and web with required surface parity.

## Acceptance criteria

- A repository search outside historical release/backlog/OpenClaw reference documents finds
  no production `HEARTBEAT.md` contract or heartbeat scheduling terminology.
- Creating and spawning a profile cannot create or inject a `HEARTBEAT.md` file.
- An interval or cron trigger contains the complete scheduled instruction in `message`.
- A due occurrence waiting on a busy Agent remains durably pending and executes when the Agent
  becomes available according to its overlap policy.
- A daemon restart does not lose pending work and safely makes abandoned work claimable again.
- A failed dispatch retries only up to its configured bound, then exposes a terminal error.
- Trigger deletion/disable semantics for existing pending work are explicit and tested.
- Team Policy authorization is revalidated at dispatch time; no scheduling bypass is added.
- Session JSONL remains the only content transcript; dispatch rows do not copy prompts,
  responses, tool calls, or provider events.
- CLI and web surfaces have parity for trigger configuration and dispatch diagnostics.
- Focused tests, full daemon tests, root/web typechecks, lint, and `git diff --check` pass.

## Out of scope

- A general workflow engine, arbitrary stages, dependencies, or DAG execution.
- A new Agent type or detached scheduled-worker identity.
- Restoring runs/events audit tables or duplicating session transcripts.
- Exactly-once execution across external side effects; dispatch claiming is at-least-once after
  lease expiry and Agent instructions must remain safe to retry.

## Tests

- Profile/API/home/prompt tests prove heartbeat files are neither accepted nor loaded.
- Scheduler tests cover busy Agent, coalescing, restart recovery, concurrent claims, success,
  bounded retry, terminal failure, disable/delete behavior, and Team Policy denial/approval.
- Route/client/CLI/web tests cover dispatch status and validation.

## As-built (2026-08-01)

The heartbeat-file removal shipped in v0.10.0. The durable-dispatch closure is complete and
verified locally, with its Changeset awaiting the next release. It adds:

- clean-install `trigger_dispatches` persistence with idempotent `(trigger_id, scheduled_at)`
  occurrences;
- coalesced interval materialization, transactional claims, running leases, restart recovery,
  bounded exponential retry, and explicit terminal/cancelled states;
- lifecycle-lease ordering and Team Policy revalidation immediately before each attempt;
- approval-gated occurrences that remain pending until an operator records a durable grant;
  the scheduler remains the sole owner of execution, retry, restart recovery, and terminal state;
- correct provider-error/fatal outcome classification, so failed turns retry instead of being
  recorded as successful, including after the scheduling watermark advances;
- disable semantics that cancel pending/retrying work; running work is allowed to finish, while
  trigger deletion cascades its dispatch history without cancelling an already-started turn;
- recent dispatch diagnostics through agent trigger responses, a dedicated HTTP endpoint,
  `bazilion trigger history`, and the Agent triggers web page.

Verification passed 99 test files / 793 tests, root and web typechecks, lint with existing
warnings only, the production build, and `git diff --check`.
