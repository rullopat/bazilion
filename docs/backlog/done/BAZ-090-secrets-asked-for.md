---
id: BAZ-090
title: "Secrets an Agent asks for, kept out of the conversation"
status: done
created: 2026-11-27
shipped: 2026-11-27
release: v0.64.0
---

# BAZ-090 — Secrets an Agent asks for, kept out of the conversation

## Outcome

A token pasted into chat goes into the conversation file, to the model provider and into every
later turn. Now the Agent asks for a secret by name, you type it into a masked field, and the
Agent uses it without ever seeing it. Taken from OpenClaw's `secrets`.

## Scope

- `secret_request` takes a name (`GITHUB_TOKEN`), a reason and optionally hosts: a masked card on
  the web, a link on Telegram, `bazilion agent secret set` without echo. The Agent is told
  **stored** or **declined**, never the value.
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

## As built

- `core/agent-secrets.ts`: `agent-secret/<agent>/<NAME>` rows of `secrets` hold the value, reason,
  hosts and time; `mergeSecretsIntoEnv` leaves them out, and deleting the Agent deletes them.
- `secret_request` is a question kind like an action (no timer; `askSecret`, `settleSecret` in
  `lib/questions.ts`). The answer `{kind: 'secret', value}` is stored before the card closes;
  `decline` takes a note. The wake says only stored or declined. Storing it from the sheet or the
  CLI answers a waiting request with its reason; hosts only as given there.
- The turn adds the Agent's secrets to the worker's environment, Docker gets `--env NAME`, and
  jobs get them too; MCP servers do not. The system prompt lists the names.
- `web_fetch` takes `headers`; `{{secret:NAME}}` only for its hosts, over https, uncached, and
  dropped on a cross-origin redirect. A Telegram reply to the request is deleted, not passed on.
- `redactToolResults` wraps Pi's `afterToolCall` (content and details), and the turn's message
  is cleaned too: secrets and Bazilion's credentials, in the forms output shows them.
- Guides: [questions](../../questions.md#secrets-an-agent-asks-for), coding environments.
## Decided while building

- A secret stays with one Agent; a Team-wide secret is not part of this story.
- `secret_request` is offered where `ask_user` is; `secret_list` in every turn.
- A name Bazilion or a command's process uses (`PATH`, provider keys, `BAZILION_*`) is refused.
- An Agent's secret is taken out of output whatever its length.
## Limits

- Not a sandbox: a command can still send the value elsewhere or change it, and only the exact
  value is taken out. A Docker command has no network, so `web_fetch` is the way out.
- A waiting request lives in memory: a restart forgets it.
