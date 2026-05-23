# bazilion

Multi-agent runtime CLI — spawn LLM agents, manage profiles/groups/skills, and run the local daemon.

[![npm](https://img.shields.io/npm/v/bazilion.svg)](https://www.npmjs.com/package/bazilion) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/rullopat/bazilion/blob/main/LICENSE)

> Alpha. APIs may change between 0.x releases.

## Install

Requires **Node 24 or newer**.

```sh
npx bazilion serve         # one-shot
# or install globally
npm install -g bazilion
bazilion serve
```

## Quickstart

```sh
# Start the daemon — auto-bootstraps ~/.bazilion on first run
# (creates dirs, runs migrations, mints the bootstrap token, writes auth.json).
bazilion serve
```

The daemon prints a bootstrap token before binding `127.0.0.1:4321`. CLI commands pick it up automatically from `~/.bazilion/auth.json`.

From another terminal:

```sh
# Set up a provider (env var, or `bazilion config set` to persist it).
export ANTHROPIC_API_KEY=sk-ant-...
bazilion provider enable anthropic
bazilion provider models anthropic claude-sonnet-4-6

# Spawn an agent from the default profile and chat with it.
bazilion agent spawn --profile default --name first
# → spawned agent <uuid> (first)

bazilion agent chat <uuid>                       # interactive REPL
bazilion agent chat <uuid> --message "say hi"    # one-shot
```

Run `bazilion --help` for the full command list, or `bazilion <command> --help` for details on any subcommand.

## Web UI

The web UI lives in the [bazilion repo](https://github.com/rullopat/bazilion) under `apps/web` and is **not yet shipped in the npm package**. To run it alongside the daemon today:

```sh
git clone https://github.com/rullopat/bazilion
cd bazilion && pnpm install
cd apps/web && pnpm dev    # http://127.0.0.1:4322
```

Bundling the web UI into `bazilion` is on the roadmap.

## ChatGPT (Plus/Pro/Team) OAuth

Use your ChatGPT account instead of an API key to access `gpt-5.x` / `gpt-5.x-codex` models:

```sh
bazilion auth openai login     # browser flow on localhost:1455
bazilion auth openai status    # check connection / token expiry
```

After connecting, enable `openai-codex` and curate at least one model. Credentials are stored AES-256-GCM-encrypted in the daemon's `secrets` table.

## What's in the box

- **CLI + daemon**, both spawned via `bazilion serve`. The daemon binds `127.0.0.1:4321` and owns `~/.bazilion/` (SQLite DB, profiles, agents, groups, skills, logs).
- **17 subcommand families**: `agent`, `profile`, `group`, `skill`, `provider`, `config`, `auth`, `memory`, `send`, `inbox`, `trigger`, `serve`, `doctor`, `backup`, `token`, `login`, `uninstall`.
- **Provider support** via [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai): Anthropic, OpenAI (key + ChatGPT OAuth), Google AI Studio + Vertex, Azure OpenAI, AWS Bedrock, Mistral, Groq, Cerebras, xAI, Z.AI, Hugging Face, OpenRouter, Vercel AI Gateway, LM Studio, Ollama.
- **OpenClaw-compatible skills**: drop a `SKILL.md` into `~/.bazilion/skills/<name>/`, or import in bulk via `bazilion skill import --from openclaw`.

## Uninstall

```sh
bazilion uninstall                # interactive: data wipe, then optional full wipe
bazilion uninstall --yes          # data tier only (DB + profiles/agents/groups)
bazilion uninstall --yes --all    # also remove auth.json, logs/, skills/
```

## Documentation

- Full README: <https://github.com/rullopat/bazilion#readme>
- Architecture: <https://github.com/rullopat/bazilion/blob/main/docs/architecture.md>
- Agent engine walkthrough: <https://github.com/rullopat/bazilion/blob/main/docs/agent-engine.md>
- Website: <https://bazilion.com>
- Issues: <https://github.com/rullopat/bazilion/issues>

## License

[MIT](https://github.com/rullopat/bazilion/blob/main/LICENSE)
