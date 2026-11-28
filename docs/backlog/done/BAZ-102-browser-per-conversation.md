---
id: BAZ-102
title: "Which browser, chosen in the conversation"
status: done
created: 2026-11-28
shipped: 2026-11-28
release: v0.66.0
---

# BAZ-102 — Which browser, chosen in the conversation

## Outcome

Whether Agents used a browser of their own or your running Chrome was one setting for all of
them, changed under Setup. Now that setting is the default, a browser of the Agent's own unless
you change it, and you tell an Agent in the conversation which one to use: "use my Chrome" or
"use your own browser". It switches for the rest of that conversation.

## As built

- `browser_use` (`runtime/tools/browser.ts`), the model's own tool (never from a script), calls
  the new `browserUse` RPC. The daemon's browser host (`lib/browser/host.ts`) keeps the
  conversation's choice and runs each action with that browser. Each turn starts from the
  latest switch that went through in the conversation's file (`conversationBrowserChoice`,
  read once by the daemon for the host and the worker's prompt); a helper from the conversation
  that started it. A switch records whether you approved it: a move made without asking, while
  your Chrome was the default, ends with that default. Asking for the same browser records
  nothing.
- Moving to your Chrome, unless it is the default, goes through the command approval registry
  with the risk `your-browser` (`lib/agent-turn.ts`): the card in the chat and on Telegram says
  it lasts for the conversation; a turn nobody can answer is refused at once. The host then
  reaches your Chrome at once, so a Chrome that does not allow it says so at the switch.
- The prompt's browser guide follows the conversation's browser and says to switch only when
  asked (`browserGuideSection`); the Agent's Browser panel names the browser in use
  (`browserStatus`).
- Setup: **Which browser, unless you say otherwise**, with how to switch; the advanced settings of
  both kinds of browser show whatever the default.
- Tests: `test/lib/browser-choice.test.ts` (approval, refusal, the default, reading the choice
  back, the guide).

## Decided while building

- A tool the model calls, not a control in the page: you say it in the conversation, on the web,
  Telegram or the terminal alike.
- An Agent works in one browser at a time: switching closes the other one; its profile and logins
  stay.

## Limits

- The approval is asked again in each conversation that moves to your Chrome.
- A turn's prompt says which browser it started in; a switch during the turn is told to the
  Agent by the tool's answer.
