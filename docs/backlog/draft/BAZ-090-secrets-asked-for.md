---
id: BAZ-090
title: "Secrets an Agent asks for, kept out of the conversation"
status: draft
created: 2026-11-27
release: v0.64.0
---

# BAZ-090 — Secrets an Agent asks for, kept out of the conversation

## Outcome

When an Agent needs an API token, you paste it into chat. From there it goes into the
conversation file, to the model provider, and into the context of every later turn. After this
story the Agent asks for a secret by name, you type it into a masked field, and the Agent gets to
use it without ever seeing it. Taken from OpenClaw's `secrets`.

## Scope

- `secret_request` takes a name in environment-variable form (`GITHUB_TOKEN`), a reason and,
  optionally, the hosts it is for.
  - In web chat, a card with a masked field appears.
  - On Telegram you get a link to that card, because a Telegram message is not masked.
  - From a terminal, `bazilion agent secret set` reads the value without echoing it.
  - The Agent is told **stored** or **declined**, never the value.
- `secret_list`: names, reasons and when each was stored, without values.
- **Where it is used:** as an environment variable of the Agent's commands, on the host and in
  Docker. Also in `web_fetch` headers written `{{secret:NAME}}`, which the daemon fills in only
  for the hosts the secret was given for.
- Values are encrypted in the `secrets` table, like Bazilion's own keys, under a name of the
  Agent's. No schema change.
- Tool output is checked for the exact value, which is replaced before the model sees it. The
  turn already does this for Bazilion's credentials (`redactExactValues`).
- The Agent's sheet lists its secrets with **Replace** and **Remove**, as does
  `bazilion agent secret list|set|rm`.

## Where it goes

- `src/runtime/tools/secrets.ts`, a secret host with its RPC methods, `src/core/secrets.ts`,
  `src/runtime/shell/security.ts` (the environment of commands), `src/runtime/tools/web.ts`.
- `src/lib/questions.ts` for the card, Telegram questions, routes, `packages/api-types`,
  `apps/cli/src/commands/agent.ts`, the Agent sheet.
- Guides: [questions](../../questions.md), [coding environments](../../coding-environments.md).

## Limits and open questions

- This keeps the value out of the conversation. It is not a sandbox: a command can still send
  the value somewhere or transform it, and redaction catches only the exact value.
- The Docker network is off, so a token in a command's environment helps only local tools there.
  `web_fetch` is the way out.
- To decide: whether a secret can be shared with the whole Team rather than one Agent.
