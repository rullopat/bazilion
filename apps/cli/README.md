# bazilion

Multi-agent runtime CLI — spawn LLM agents, manage profiles/teams/skills, and run the local daemon.

[![npm](https://img.shields.io/npm/v/bazilion.svg)](https://www.npmjs.com/package/bazilion) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/rullopat/bazilion/blob/main/LICENSE)

> Alpha. APIs may change between 0.x releases.

## Install

Requires **Node 24 or newer**.

```sh
npx bazilion dashboard     # one-shot
# or install globally
npm install -g bazilion
bazilion dashboard
```

## Quickstart

```sh
# Start the daemon + bundled web UI — auto-bootstraps ~/.bazilion on first run
# (creates dirs, runs migrations, mints the bootstrap token, writes auth.json).
bazilion dashboard
```

The daemon writes a bootstrap token to `~/.bazilion/auth.json`, binds `127.0.0.1:4321`, and the bundled web UI binds `127.0.0.1:4322`. CLI commands pick the token up automatically from `auth.json`; paste it into the web login screen.

From another terminal:

```sh
# Set up a provider (env var, or `bazilion config set` to persist it).
export ANTHROPIC_API_KEY=sk-ant-...
bazilion provider enable anthropic
bazilion provider models-set anthropic claude-opus-5

# Spawn an agent from the default profile and chat with it.
bazilion agent spawn --profile default --name first
# → spawned agent <uuid> (first)

bazilion agent chat <uuid>                       # interactive REPL
bazilion agent chat <uuid> --message "say hi"    # one-shot
```

Run `bazilion --help` for the full command list, or `bazilion <command> --help` for details on any subcommand.

## Team Templates and Team Policy from the CLI

Canonical Team Templates and the one effective policy owned by each Team can be inspected
and exchanged without direct database access:

```sh
bazilion team list
bazilion team show research-team
bazilion team-template export research-team > research-team.json
bazilion team-template import research-team.json --dry-run
bazilion team-template import research-team.json --apply --expected-revision 3

bazilion team policy show default
bazilion team policy export default > default-policy.json
bazilion team policy import default default-policy.json --dry-run
bazilion team policy diff default
bazilion team policy evaluate default --source user --target agent:<uuid>
bazilion team policy blocks default --reason no_allow_edge --limit 25 --json

# Review policy-protected communication attempts.
bazilion approval list --status pending
bazilion approval show <approval-id>
bazilion approval approve <approval-id> --yes
bazilion approval deny <approval-id> --reason "Not ready" --yes
```

Imports always print a resolved diff. Existing state requires an expected revision; stale
state exits without overwriting. `--force` is not a bypass: after refetching it requires
`--confirm-current-revision <n>` and submits that revision through the same optimistic
lock. Evaluation is diagnostic only—it sends no message and records no denial.

Stable automation exit codes are: `0` success, `1` connection/server failure, `2`
validation or missing explicit confirmation, `3` revision conflict, and `4`
authentication/authorization failure. JSON output never includes bearer credentials,
filesystem paths, message bodies, or local database-only identities.

Approval list output is payload-free; `approval show` is the explicit sensitive-payload
detail surface. Approve, deny, and cancel require `--yes`. Approval authorizes one captured
attempt only and never changes the Team policy.

## Web UI

The web UI is bundled into the published `bazilion` package and starts with:

```sh
bazilion dashboard
```

For source development, clone the repo and run the daemon plus Vite dev server. Node 24+ and pnpm 10+ are required; if `corepack` is unavailable, install pnpm directly with `npm install -g pnpm`.

```sh
git clone https://github.com/rullopat/bazilion
cd bazilion && pnpm install
pnpm tsx apps/cli/src/index.ts serve
cd apps/web && pnpm dev    # http://127.0.0.1:4322
```

## ChatGPT (Plus/Pro/Team) OAuth

Use your ChatGPT account instead of an API key to access `gpt-5.x` / `gpt-5.x-codex` models:

```sh
bazilion auth openai login                # browser flow on localhost:1455
bazilion auth openai login --device-code  # headless/remote or callback-port fallback
bazilion auth openai status               # check connection / token expiry

# Source checkout: run from the repository root.
pnpm tsx apps/cli/src/index.ts auth openai login --device-code
```

After connecting, enable `openai-codex` and curate at least one model, for example
`gpt-5.6-sol` (the Pi 0.84 catalog also includes `gpt-5.6-luna` and `gpt-5.6-terra`).
Credentials are stored AES-256-GCM-encrypted in the daemon's `secrets` table.

## What's in the box

- **CLI + daemon + web UI**, spawned together via `bazilion dashboard`. The daemon binds `127.0.0.1:4321`, the web UI binds `127.0.0.1:4322`, and the daemon owns `~/.bazilion/` (SQLite DB, profiles, agents, teams, skills, logs).
- **Operator command families** include `agent`, `profile`, `team`, `team`, `skill`, `provider`, `config`, `auth`, `memory`, `send`, `inbox`, `trigger`, `serve`, `doctor`, `backup`, `token`, `login`, and `uninstall`.
- **Provider support** via [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai): Anthropic, OpenAI (key + ChatGPT OAuth), Google AI Studio + Vertex, Azure OpenAI, AWS Bedrock, Mistral, Groq, Cerebras, xAI, zAI, Hugging Face, OpenRouter, Vercel AI Gateway, Cloudflare, GitHub Copilot, DeepSeek, Fireworks, Together, Baseten, Moonshot/Kimi, MiniMax, Qwen Token Plan (including Individual), Xiaomi MiMo, Ant Ling, NVIDIA NIM, OpenCode, LM Studio, Ollama, and llama.cpp.
- **OpenClaw-compatible skills**: drop a `SKILL.md` into `~/.bazilion/skills/<name>/`, or import in bulk via `bazilion skill import --from openclaw`.

## Uninstall

```sh
bazilion uninstall                # interactive: reset, then optional full wipe
bazilion uninstall --yes          # reset DB + auth.json + profiles/agents/teams
bazilion uninstall --yes --all    # also remove logs/ and skills/
```

Both tiers remove the DB and `auth.json` together so the next `bazilion serve` creates a matching
bootstrap-token pair. They also remove the legacy `groups/`, `config.json`, and `secrets.enc`
paths. Team and legacy Group symlink slots are unlinked without touching their external targets. A
full wipe removes the Bazilion home when only managed paths remain; unmanaged files keep the home
in place. A symlinked `BAZILION_HOME` root remains as an empty slot so interrupted cleanup can be
safely resumed through the same canonical identity.

## Documentation

- Full README: <https://github.com/rullopat/bazilion#readme>
- Architecture: <https://github.com/rullopat/bazilion/blob/main/docs/architecture.md>
- Agent engine walkthrough: <https://github.com/rullopat/bazilion/blob/main/docs/agent-engine.md>
- Website: <https://bazilion.com>
- Issues: <https://github.com/rullopat/bazilion/issues>

## License

[MIT](https://github.com/rullopat/bazilion/blob/main/LICENSE)
