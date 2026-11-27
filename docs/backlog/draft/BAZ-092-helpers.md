---
id: BAZ-092
title: "Helpers: short runs of the same Agent"
status: draft
created: 2026-11-27
release: v0.64.0
---

# BAZ-092 — Helpers: short runs of the same Agent

## Outcome

An Agent with five sources to read reads them one after another, and every page stays in its
context. Teammates can share the work, but each is a lasting Agent with an identity of its own,
added in a turn you started. A helper is a fresh run of the same Agent for one self-contained
task. It starts with an empty conversation, works with the same tools, and hands back its final
answer, and several helpers can run at once. Taken from OpenClaw's `sessions_spawn`,
`agents_wait` and `subagents`.

## Scope

- `helper_start` takes a task and, optionally, a model, and answers at once with the helper's id.
- `helper_wait` takes one or more ids and returns each answer as it arrives, as `wait_for_reply`
  does for messages. `helper_stop` ends a helper.
- A helper has the Agent's tools except the `helper_*` tools and `ask_user`, since nobody answers
  it. A helper therefore cannot start another helper: that is a rule, not a depth limit.
- In chat, a helper's work shows under the tool call that started it, as live output, with
  **Stop**. Its transcript is kept with the Agent's sessions and can be opened from there.
- `bazilion agent helpers <agent>` lists the running helpers and stops them.
- Usage counts helpers under their Agent, each on its own row.
- There is no cap on how many run. Each one is a worker process, and the panel shows how many are
  running.

## Where it goes

- `src/runtime/tools/helpers.ts`, a helper host with its RPC methods.
- `src/lib/turn-preparation.ts` and `src/lib/agent-turn.ts`: a `helper` turn origin. The busy
  check lets an Agent's own helpers run beside its turn.
- `src/runtime/worker/`, `src/lib/usage.ts`, the conversation view,
  `apps/cli/src/commands/agent.ts`.
- Guide: [agent engine](../../agent-engine.md).

## Limits and open questions

- **Product call:** helpers overlap with teammates (`agent_create`). This story keeps them apart:
  a helper has no name, memory writes or inbox, and it ends with its task. Confirm that the
  difference is wanted.
- A helper's answer is trusted like the Agent's own work, and nothing checks it.
- Helpers share the Agent's browser, so two of them browsing at once take turns on it.
