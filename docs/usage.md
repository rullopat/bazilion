# Usage and cost

**Usage** shows what your Agents' model calls used: the money spent on providers paid per use,
and the tokens of subscriptions and of model servers on this computer, per day, Team, Agent and
model. Nothing new is recorded for it: Pi writes the tokens and cost of every reply into the
conversation's history, and Usage adds them up.

- **Web:** **Manage → Usage** (`/usage`). Pick the period (today, 7, 30 or 90 days, or
  everything); the chart has a bar per day (point at one, or focus it and use the arrow keys) and
  a table of the days under it. Open a Team or an Agent to see only theirs (`/usage?agent=<id>`,
  `/usage?team=<id>`). Each conversation's use is under its title in the conversation menu,
  which also opens **This Agent's usage**.
- **CLI:**

  ```sh
  bazilion usage                      # the last 30 days, by Team, Agent and model
  bazilion usage --days 7 --daily     # and every day
  bazilion usage --all --agent <id>   # everything one Agent used
  bazilion conversation list <agent>  # each conversation's use in the "used" column
  ```

Days are counted in the time zone of the browser or terminal that asks.

## What a number means

| | |
| --- | --- |
| **Spent** | US dollars for providers paid per use. It is what the provider reported it billed when it says so (OpenRouter does), otherwise Pi's catalog price for the tokens, and then Usage says it is an estimate. |
| **On a subscription** | Tokens through ChatGPT, GitHub Copilot, a Qwen or Xiaomi MiMo token plan: the plan is paid for, not each call, so they cost nothing here. |
| **On this computer** | Tokens on LM Studio, Ollama or llama.cpp. |
| **Model calls** | Replies, conversation summaries and cache warm-ups. |

A conversation summary is counted for the model of the reply before it.

## What it leaves out

- Calls outside a conversation: an Agent's learning review, provider tests in Setup, and
  generated images.
- Conversations that are gone: a deleted Agent's, and a history that cannot be read (Usage says
  how many it skipped).
- An Agent moved to another Team counts for the Team it is in now.

## API

| Route | |
| --- | --- |
| `GET /api/usage?days=30&tz=Europe/Rome[&agent=<id>][&team=<id>]` | Totals, by day, Agent, Team and model; `days` is 1–3660 or `all` |
| `GET /api/agents/:id/conversations` | Each listed conversation's use in `usage`, by id |
