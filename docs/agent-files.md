# Agent files & storage — which surface holds what

One-page map of Bazilion's storage surfaces: who writes each artifact, where it lives,
and which surface is canonical when a doubt arises. Modeled on Hermes Agent's
"which file does what" and OpenClaw's memory tier table (see
`docs/backlog/design/storage-comparison-openclaw-hermes.md`).

## The rule

There are three storage surfaces, and every artifact has exactly one canonical owner:

1. **Workspace files** (the team filesystem root) — canonical for persona, identity,
   and instruction documents. Agents edit them with file tools (`home_write`); the
   daemon never rewrites them behind the agent's back.
2. **`bazilion.db` (SQLite)** — canonical for all domain state: rosters, policies,
   conversations metadata, queues, approvals, evidence, secrets (encrypted),
   and USER.md content.
3. **The filesystem around them** (`auth.json`, Pi session JSONL, logs) — credentials
   pair, canonical transcripts, and diagnostics.

Never hand-edit `bazilion.db`; stop the daemon and use the CLI instead.

## The master table

| Artifact | What it holds | Canonical | Who writes it | When the agent sees it |
|---|---|---|---|---|
| **SOUL.md** | Personality, tone, behavioral red lines | Workspace file | You (seeded on first run) | System prompt, every turn |
| **IDENTITY.md** | The agent's name, creature, avatar | Workspace file | The agent during bootstrap (`home_write`) | System prompt, every turn |
| **AGENTS.md** | Team operating manual: memory discipline, messaging rules | Workspace file | You (seeded default) | System prompt, every turn |
| **TOOLS.md** | Tool-use guidance | Workspace file | You (seeded default, opt-in) | System prompt, every turn |
| **USER.md** | Who you are: preferences, context | **DB** (`teams.user_md`) | The agent via `user_md_get`/`user_md_write` with etag; capped at 12 KB | Inlined into every agent's system prompt, every turn |
| **Session transcripts** | Conversation history | Pi session JSONL files | Pi engine | Replay / resume |
| **Memory & lessons** | Durable learned lessons | DB tables | The agent, human-approved (learning loop) | Prompt lessons on relevant turns |
| **Domain state** | Teams, policies, queue, approvals, receipts, snapshots, publications | DB tables | The daemon | Via API/tools |
| **Secrets** | Credentials | DB tables, PBKDF2-encrypted from `auth.json` | The daemon | Never in prompts |

## The USER.md duality, explained

USER.md *looks* like a workspace file but is stored in `teams.user_md`. The daemon
materializes it at the team root for inspection. Writes go through
`user_md_get` → `user_md_write` with an etag (optimistic concurrency — no locks; a
conflict means another agent in the team wrote concurrently, re-read, re-merge, retry).
The content is capped because it is inlined into every system prompt on every turn:
uncapped growth would silently blow out context.

Do not edit the materialized USER.md file directly — edit via the tools (or the API);
a hand edit to the file is not canonical and will be overwritten.

## Why the mix

Plain Markdown keeps persona/instructions inspectable and agent-editable with zero
hidden state (the model only "remembers" what is written to disk it can see). SQLite
keeps domain state transactional, concurrent-safe, and consistently backupable —
BAZ-024 online snapshots, BAZ-030 encryption. Both reference projects in the personal
agent space converged on this same split; see the storage comparison in the backlog
for the full analysis.
