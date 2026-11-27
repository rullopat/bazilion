---
id: BAZ-092
title: "Helpers: short runs of the same Agent"
status: in_progress
created: 2026-11-27
release: v0.64.0
---

# BAZ-092 — Helpers: short runs of the same Agent

## Outcome

An Agent with five sources to read read them one after another, every page staying in its
context; teammates are lasting Agents of their own. A helper is a fresh run of the same Agent for
one self-contained task: an empty conversation, the same tools, its final answer handed back, and
several at once. Taken from OpenClaw's `sessions_spawn`, `agents_wait` and `subagents`.

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

## As built

- `lib/helpers.ts`: helpers in memory; each is a turn with origin `helper` (`turn-preparation.ts`
  skips the busy check and the Agent's registration) in a conversation created unselected.
  `runAgentTurn` leaves the Agent's running state and Telegram alone for it.
- `runtime/tools/helpers.ts`: `helper_wait` polls the daemon and sends each helper's step as tool
  progress, the live output under the call. A helper's turn gets no helper host.
- An answer nobody waited for becomes a wake when the starting turn ends; aborting that turn
  stops its helpers. The **Helpers** sheet (panel row with the count), `bazilion agent helpers`.
- Guide: [agent engine](../../agent-engine.md#helpers).

## Decided while building

- Helpers stay apart from teammates, as planned: no name, inbox or memory of their own; they end
  with their task. `secret_request` is left out with `ask_user`, since nobody answers a helper.
- Live output shows under `helper_wait`, which is where the Agent waits; the sheet has Stop and
  Open for each helper.
- What a helper delivers or schedules belongs to the conversation that started it.

## Limits

- A helper's answer is trusted like the Agent's own work, and nothing checks it.
- Helpers share the Agent's browser, so two of them browsing at once take turns on it.
- A restart stops running helpers; their conversations stay in the library.
