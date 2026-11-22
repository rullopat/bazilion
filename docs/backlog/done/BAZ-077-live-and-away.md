---
id: BAZ-077
title: Live updates, reaching the operator when away, browser tests
status: done
created: 2026-11-22
shipped: 2026-11-22
release: v0.55.0
---

# BAZ-077 — Live updates, reaching the operator when away, browser tests

## Outcome

What an Agent waits on reaches the operator at once and wherever they are: the web UI is pushed
changes instead of asking every few seconds, the browser can notify, a waiting command can be
decided from Telegram, and a phone shows who waits first. Browser tests on CI catch what unit
tests cannot. The embedded Pi moves to 1.6.0. Picked by the owner from the suggestions after
0.54.0.

## Scope

- `GET /api/events`: activity and Attention, pushed on change; the web UI reads it, one stream per
  browser, and asks on its own while it is down.
- Desktop notifications, from the session menu, when an Agent starts waiting and no tab has the
  focus.
- A command waiting for approval waits five minutes; after half a minute it is posted in the
  Agent's Telegram topic with Allow once and Deny, for the paired owner only.
- On a phone, **Waiting for you** above the Agent list.
- `pnpm test:e2e` (a CI job) and `pnpm site-pictures`, sharing `e2e/`.
- The suite passes on macOS.
- Pi 1.6.0: GPT-6.2 Sol suggested for ChatGPT and OpenAI, one key per Qwen Token Plan, llama.cpp
  on port 9931.

## As built

- Daemon: `lib/live-signal.ts`, `lib/live.ts`, `routes/events.ts`; the registries, turn start and
  end and acknowledgements signal. `lib/telegram/approvals.ts`; `CommandApprovalRegistry.get` and
  `settled`.
- Web: `lib/live.tsx` (Web Lock and BroadcastChannel), `lib/desktop-notifications.tsx`,
  `workspace/WaitingStrip.tsx`; the activity, Attention count, Attention page and conversation
  read the feed. Jump to keeps an Enter typed before its lists arrive.
- Tests: off Linux, a context directory refuses a replaced directory instead of reading it.
- No schema change.

## Known limits

- Questions and approvals still live in the daemon's memory: a restart ends them.
- Desktop notifications need `https://` or this computer's address.
- Telegram turns still deny flagged commands.
