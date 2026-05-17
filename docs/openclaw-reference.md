# OpenClaw — reference for Bazilion contributors

Bazilion's README and `CLAUDE.md` call the project "OpenClaw-inspired", and the daemon literally reads `~/.openclaw/skills/` when you run `bazilion skill import --from openclaw`. This doc captures what upstream OpenClaw actually is, so contributors know what we borrowed, what we deliberately didn't, and where the format we accept comes from.

Snapshot date: 2026-05-17. Source: `docs.openclaw.ai` + `github.com/openclaw/openclaw` `main`. Re-fetch before relying on exact counts.

## 1. What OpenClaw is

A self-hosted personal AI-assistant gateway — *not* a Claude Code clone. Repo: `github.com/openclaw/openclaw`. Docs: `docs.openclaw.ai`. License: MIT. Runs on Node 22.12+. Install: `npm i -g openclaw && openclaw onboard` (or `curl -fsSL https://openclaw.ai/install.sh | bash`).

It speaks to the user over channels they already use (WhatsApp, Telegram, iMessage, Signal, IRC, Mattermost, voice), holds persistent memory, and is LLM-agnostic (~35 model-provider plugins). The mascot is a lobster; the slogan is "the lobster way".

The two extensibility surfaces are **skills** and **plugins**. They are *not* interchangeable.

## 2. Skills vs plugins — the actual difference

From the docs, verbatim: *"Skills tell the agent how to do things. Plugins give the agent new abilities it couldn't have otherwise."*

| Axis | Skill | Plugin |
|---|---|---|
| What it is | A directory with a `SKILL.md` (YAML frontmatter + markdown body) | An npm-shaped TypeScript package loaded in-process by the gateway |
| What it adds | New *knowledge* — instructions the LLM follows using already-available tools | New *capability* — new channels, model providers, tools, memory backends, lifecycle hooks |
| Runtime cost | Zero — only text is injected into the prompt (progressive disclosure: YAML metadata loaded eagerly, body loaded on description match) | Live code running inside the gateway process |
| Author writes | Markdown | TypeScript |
| Manifest | YAML frontmatter inside `SKILL.md` | Separate `openclaw.plugin.json` (declarative) + the npm package's `package.json` (code + deps) |
| Install source | ClawHub registry, local dir, bundled | `clawhub:<pkg>`, `npm:<pkg>`, `git:<repo>@<ref>`, `./local` |
| Discovery | Directory scan (precedence-ordered, see §5) | Listed in `openclaw.json`, loaded at gateway start |
| Hooks | None — skills are pure prompt content | 28 lifecycle hooks across model/agent/message/tool/session/sub-agent layers |
| Failure blast radius | A bad skill produces bad answers | A bad plugin can crash the gateway, leak secrets, intercept every tool call |
| Trust gate needed | No (text only) | Yes (arbitrary code) |
| Can ship the other? | No — a skill cannot register code | Yes — a plugin may bundle skills via a `skills` directory referenced in its manifest |

**Rule of thumb:** if the new behavior can be expressed as "tell the agent, in English, how to use existing tools to do X", it's a skill. If it needs to register a new model provider, a new transport, a custom tool, or hook into the request/tool lifecycle, it's a plugin. The split exists because most "I want my agent to know how to do X" requests are content, not code — and content is far cheaper to author, distribute, and trust.

## 3. Default skills (~57 bundled in `skills/` on `main`)

Grouped by purpose (slugs match `github.com/openclaw/openclaw/tree/main/skills`):

| Category | Skills |
|---|---|
| Messaging / chat | `imsg`, `wacli` (WhatsApp), `discord`, `slack`, `voice-call`, `xurl` (X/Twitter) |
| Productivity / tasks | `apple-notes`, `apple-reminders`, `bear-notes`, `notion`, `obsidian`, `things-mac`, `trello`, `taskflow`, `taskflow-inbox-triage`, `spike` |
| Google / Office | `gog` (Gmail/Calendar/Drive/Docs/Sheets), `goplaces`, `gh-issues`, `github` |
| Smart-home / hardware | `openhue` (Hue), `eightctl` (Eight Sleep), `sonoscli`, `blucli` (BluOS), `camsnap` (RTSP cams) |
| Media / generation | `canvas`, `diagram-maker`, `meme-maker`, `gifgrep`, `nano-pdf`, `video-frames`, `songsee`, `summarize` |
| Speech | `openai-whisper`, `openai-whisper-api`, `sherpa-onnx-tts`, `sag` (ElevenLabs TTS) |
| Coding / dev | `coding-agent`, `gemini` (Gemini CLI), `tmux`, `node-connect`, `node-inspect-debugger`, `python-debugpy`, `oracle`, `peekaboo` (macOS UI automation) |
| Email / RSS | `himalaya` (IMAP/SMTP), `blogwatcher` |
| Utility / infra | `1password`, `clawhub` (registry mgmt), `healthcheck`, `mcporter` (MCP bridge), `model-usage`, `session-logs`, `skill-creator`, `weather`, `spotify-player`, `ordercli` |

### Skill file layout

A skill is a directory whose only required file is `SKILL.md`. Helper scripts are optional and referenced via `{baseDir}`. No separate `metadata.json` — everything lives in YAML frontmatter:

```yaml
---
name: summarize
description: "Summarize or transcribe URLs, YouTube/videos, podcasts, articles, transcripts, PDFs, and local files."
homepage: https://summarize.sh
metadata:
  {
    "openclaw":
      {
        "emoji": "🧾",
        "requires": { "bins": ["summarize"] },
        "install":
          [ { "id": "brew", "kind": "brew",
              "formula": "steipete/tap/summarize",
              "bins": ["summarize"],
              "label": "Install summarize (brew)" } ]
      }
  }
---
```

Required frontmatter: `name`, `description`. Optional: `homepage`, `version`, `user-invocable` (slash command), `hidden`, `command-dispatch` / `command-dispatch-tool` (bypass model — direct tool dispatch), `command-arg-mode`, `disable-model-invocation`, and a **single-line JSON** `metadata.openclaw` object holding `emoji`, `requires.{bins,env}`, `primaryEnv`, `os`, and `install[]` recipes (brew/npm/pip/etc.). The parser only supports single-line frontmatter values.

## 4. Default plugins (~120 in the inventory)

From `docs.openclaw.ai/plugins/plugin-inventory`. The inventory doesn't flag which are on by default — only that model providers, speech, and the browser plugin are auto-enabled.

| Category | Plugins |
|---|---|
| Model providers (~35) | Anthropic, OpenAI, Google, Groq, Cerebras, DeepSeek, Fireworks, GitHub Copilot, Hugging Face, LM Studio, Ollama, Mistral, Moonshot, OpenRouter, Qwen, Together, vLLM, xAI, Z.AI, Arcee, BytePlus, Chutes, DeepInfra, Kilocode, Kimi, LiteLLM, NVIDIA, OpenCode, OpenCode Go, Qianfan, StepFun, Synthetic, Venice, Vercel AI Gateway, Volcengine, Xiaomi |
| Channels | Clickclack, iMessage, IRC, Mattermost, Signal, Telegram |
| Speech / media | Azure Speech, Deepgram, ElevenLabs, Gradium, Inworld, Microsoft Speech, TTS Local CLI |
| Web / search | DuckDuckGo, Exa, Firecrawl, Perplexity, SearXNG, Web Readability |
| Image / video gen | Alibaba, ComfyUI, FAL, Minimax, OpenRouter, Runway, Together |
| Memory | Memory Core, Memory Wiki, Voyage |
| Infra / utilities | Admin HTTP RPC, Bonjour, Browser, Canvas, Document Extract, File Transfer, LLM Task, Migrate Claude, Migrate Hermes, OC Path, Open Prose, Skill Workshop, Tokenjuice, Webhooks |

### Plugin manifest (`openclaw.plugin.json`)

Declarative only — runtime code lives in the npm package itself. Minimum:

```json
{
  "id": "plugin-name",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

Optional fields: `name`, `description`, `version`, `providers[]`, `channels[]`, `contracts` (capability snapshot), `activation` (activation-planner metadata), `setup`, `uiHints`.

### Plugin hooks (28, six categories)

- **Model resolution:** `before_model_resolve`
- **Agent lifecycle:** `agent_turn_prepare`, `before_prompt_build`, `before_agent_{start,run,reply,finalize}`, `agent_end`, `heartbeat_prompt_contribution`
- **Message flow:** `model_call_{started,ended}`, `llm_{input,output}`, `message_{received,sending,sent}`, `before_dispatch`, `reply_dispatch`, `inbound_claim`
- **Tools:** `before_tool_call` (rewrite params, block, or require approval), `after_tool_call`, `tool_result_persist`, `before_message_write`
- **Sessions / compaction:** `session_{start,end}`, `before_compaction`, `after_compaction`, `before_reset`
- **Sub-agents / gateway:** `subagent_{spawning,delivery_target,spawned,ended}`, `gateway_{start,stop}`, `cron_changed`, `before_install`

Bundled hook packs: `session-memory`, `command-logger`, `bootstrap-extra-files`. Plugins may also ship hooks inline.

## 5. On-disk layout, config, discovery

```
~/.openclaw/
  openclaw.json          # JSON5 config
  skills/                # managed/local skills
  credentials/           # channel + provider creds
  agents/<id>/agent/auth-profiles.json
  workspace/             # default workspace (overridable)
    skills/<name>/SKILL.md
    .agents/skills/<name>/SKILL.md
~/.agents/skills/        # personal (non-workspace) agent skills
```

**Config — `openclaw.json`** (JSON5):

```json5
{
  skills: {
    entries: {
      "image-lab": { enabled: true },
      "peekaboo":  { enabled: true },
      "sag":       { enabled: false },
    },
  },
}
```

**Skill load order (highest precedence wins):**

1. `<workspace>/skills`
2. `<workspace>/.agents/skills`
3. `~/.agents/skills`
4. `~/.openclaw/skills`
5. Bundled (shipped with install)
6. `skills.load.extraDirs`

Discovery is a directory scan — no index file. On name collision, the higher source wins. Enable/disable is **config-only**: `skills.entries.<name>.enabled` in `openclaw.json` overrides even bundled skills. SKILL.md frontmatter has no `enabled` flag.

### CLI surface

```
openclaw skills search "calendar" [--limit 20] [--json]
openclaw skills install <slug> [--version <v>] [--force] [--agent <id>]
openclaw skills update <slug> | --all [--agent <id>]
openclaw skills list [--eligible] [--json] [--verbose] [--agent <id>]
openclaw skills info <name> [--json] [--agent <id>]
openclaw skills check [--agent <id>] [--json]

openclaw plugins install clawhub:<pkg>
openclaw plugins install npm:<pkg>
openclaw plugins install git:github.com/<owner>/<repo>@<ref>
openclaw plugins install ./local-dir [--link]
openclaw plugins install <pkg> --marketplace <source>
```

No `remove` / `enable` / `disable` subcommands — those flow through `openclaw.json` edits and filesystem cleanup.

### ClawHub

Official registry: `github.com/openclaw/clawhub`. ~13,729 third-party skills as of Feb 2026. Community-curated lists include `awesome-openclaw-plugins`, `awesome-openclaw-skills`, `awesome-openclaw`.

## 6. What Bazilion borrows, and what it doesn't

**Borrowed:**

- The **prompt-only skill model.** `apps/daemon/src/core/skills/` reads `SKILL.md` and injects the body into the system prompt of every attached agent. Helper scripts run via the agent's generic `bash` tool. See `CLAUDE.md` → "OpenClaw skill model: prompt-only".
- The **`SKILL.md` + YAML frontmatter format.** Upstream skills "drop in unchanged" per the README — `bazilion skill import --from openclaw` resolves to `~/.openclaw/skills/` (see `apps/daemon/src/routes/skills.ts`).
- The general idea of a per-user state root with a workspace concept. Bazilion's `~/.bazilion/groups/<slug>/` is roughly the analogue of OpenClaw's `<workspace>/`.

**Bazilion-only extensions on top of the upstream format:**

- `entry:` frontmatter field + the `run_skill` tool. Upstream OpenClaw skills don't have these; that's why imported skills surface as `docs-only` in Bazilion (memory: `project_skill_model.md`).

**Deliberately *not* borrowed:**

- The **plugin model** (28 hooks, TypeScript in-process modules, `openclaw.plugin.json`). Bazilion has no plugin SDK — all extensibility goes through skills + native daemon code.
- **Channels.** Upstream's first-class WhatsApp/Telegram/iMessage/Signal transports have no Bazilion equivalent; we expose HTTP only.
- **ClawHub.** No registry integration.
- **JSON5 `openclaw.json`** config surface. Bazilion stores config in the daemon's SQLite (`config` table) + secrets in the encrypted `secrets` table (see `CLAUDE.md` → "Secrets and config").
- The richer skill frontmatter (`user-invocable`, `command-dispatch`, `disable-model-invocation`, install recipes). Bazilion's skill loader only consumes `name` + `description` + body today.

## 7. Authoritative sources

- `https://github.com/openclaw/openclaw` — main repo (`AGENTS.md`, `skills/`)
- `https://github.com/openclaw/openclaw/tree/main/skills` — bundled skills
- `https://docs.openclaw.ai/tools/skills` — SKILL.md format + load-path precedence
- `https://docs.openclaw.ai/tools/skills-config` — `openclaw.json` skills config
- `https://docs.openclaw.ai/tools/plugin` — plugin overview + install CLI
- `https://docs.openclaw.ai/plugins/manifest` — `openclaw.plugin.json` schema
- `https://docs.openclaw.ai/plugins/plugin-inventory` — bundled plugin list
- `https://docs.openclaw.ai/plugins/hooks` — 28-hook SDK reference
- `https://docs.openclaw.ai/cli/skills` — `openclaw skills …` CLI surface
- `https://docs.openclaw.ai/clawhub/skill-format` — registry skill format
- `https://github.com/openclaw/clawhub` — registry
