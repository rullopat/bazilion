# Documentation

Start with the [README](../README.md): install, first run and the CLI.
[Installing](install.md) covers the one-line installer, the Bazilion app on macOS and signing in.

## How it works

- [Architecture](architecture.md): processes, state on disk, authentication and secrets
- [Agent engine](agent-engine.md): how a turn runs, the worker, tools, Pi and the scheduler

## Running Bazilion

- [Models and providers](models-and-providers.md): connect a provider, choose the models Agents
  use, and read what its state means
- [Tools](tools.md): web search, the page reader, the browser, commands and message chains on one
  page, each card saved whole
- [Private gateway](private-gateway.md): reach the web UI from other devices over Tailscale
- [Backup, restore and reset](backup.md)
- [Installing](install.md) and [upgrades](upgrades.md)
- [What grows in a home](growth-and-retention.md)

## Working with Agents

- [The web workspace](workspace.md): what is where on the home screen, and its address
- [Manage](manage.md): the pages for Agents, Teams, Agent and Team templates, and skills
- [Usage and cost](usage.md): tokens and money per day, Team, Agent, model and conversation
- [Conversations](conversations.md), the [follow-up queue](follow-up-queue.md) and
  [questions](questions.md)
- [Reviewed learning](backlog/done/BAZ-003-reviewed-learning.md): lessons an Agent proposes from
  its conversations, used only after you approve them
- [Team Policy and Team templates](team-policy.md)
- [Coding](coding-environments.md): shell, Docker sandbox, repository instructions
- [Change review and live tool output](change-review.md)
- [Results](results.md) and [image generation](image-generation.md)
- [Web research](web-research.md), the [managed browser](browser-research.md) and [MCP](mcp.md)
- [Telegram](telegram.md) and [Attention notifications](attention-notifications.md)

## Product work

[User stories](backlog/README.md) record what each shipped feature does and what it leaves out.
[`examples/`](../examples/) holds a sample content Team and a Docker image for coding.
