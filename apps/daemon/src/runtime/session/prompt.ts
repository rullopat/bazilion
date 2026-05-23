// Bazilion system-prompt builder. Feeds pi's `getAppendSystemPrompt()` hook
// so the agent sees its persona + skills + workspaces + memory guidance
// stacked on top of pi's built-in base prompt (which lists coding tools and
// general guidelines). Pure filesystem read — no LLM, no DB.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'

// Prompt order: peers first (who else is around), then persona, then tooling
// hints, then self-knowledge, then the wake-up playbook.
//
// BOOTSTRAP.md is intentionally NOT in this generic-context list — it gets
// its own dedicated "First-Run Ritual" section below with explicit
// anti-checklist framing, so models treat it as multi-turn Q&A guidance
// rather than a one-shot script to execute. The system prompt regenerates
// per turn, so the section auto-vanishes when `bootstrap_done` removes the
// file (vs. wrapping the user message, which would persist in pi's session
// JSONL forever and replay on every future turn).
const CONTEXT_FILE_ORDER = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
] as const

export function buildSystemPrompt(agent: ResolvedAgent): string {
  const parts: string[] = []

  const contextBlocks: string[] = []
  for (const file of CONTEXT_FILE_ORDER) {
    const path = join(agent.agent.dir, file)
    if (!existsSync(path)) continue
    const content = readFileSync(path, 'utf8').trimEnd()
    if (!content) continue
    contextBlocks.push(`## ${file}\n\n${content}`)
  }
  if (contextBlocks.length > 0) {
    parts.push(`# Project Context\n\n${contextBlocks.join('\n\n')}`)
  }

  // First-Run Ritual block — only emitted while BOOTSTRAP.md exists on disk.
  // The wording deliberately frames it as "multi-turn Q&A" not "checklist"
  // and lists hard rules at the top so tool-eager models still notice them
  // even if they skim the body.
  const bootstrapPath = join(agent.agent.dir, 'BOOTSTRAP.md')
  if (existsSync(bootstrapPath)) {
    const bootstrap = readFileSync(bootstrapPath, 'utf8').trimEnd()
    if (bootstrap) {
      parts.push(
        [
          '# First-Run Ritual',
          '',
          'This is your first session. The document below is **conversational guidance**, not a checklist to execute in one shot. It describes a multi-turn Q&A you should have with the human, one question per turn.',
          '',
          '## Hard rules',
          '- Your first reply is ONLY a greeting + ONE question. No tool calls. Wait for the human to answer.',
          '- Each subsequent turn: at most one new question. Wait between turns.',
          '- Only after the ritual is complete (you have enough to write IDENTITY.md): call `home_write` once, then `bootstrap_done`.',
          '',
          '## BOOTSTRAP.md',
          '',
          bootstrap,
        ].join('\n'),
      )
    }
  }

  parts.push(
    [
      '# Agent Home',
      '',
      'Your private home holds who you are — identity, soul, behaviour rules, wake-up routine. It is not shared with other agents and cannot be overwritten by them. The files above (IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md, HEARTBEAT.md) live in this home, plus BOOTSTRAP.md when you are still in your first-run ritual.',
      '',
      '- To change who you are (name, vibe, personality, how you behave): use `home_write`.',
      '- To inspect exact wording of your own files: use `home_read` or `home_list`.',
      '- To remember facts the user told you or things you learned: use `memory_write` — NOT `home_write`.',
      '- To produce work output (code, docs, artefacts): use `write` / `edit` — those land in your workspace, not your home.',
    ].join('\n'),
  )

  if (agent.skills.length > 0) {
    parts.push(
      `# Available Skills\n\nYou have access to the following skills: ${agent.skills.join(', ')}.`,
    )
  }

  const groupLines = [
    '# Group',
    '',
    `- ${agent.group.id} (${agent.group.name}): ${agent.group.path}`,
    '',
    'Your group is where work product lives — code, docs, artefacts, shared scratch. It may be shared with other agents in the same group. Your coding tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) are rooted at the group directory. Never use these tools to edit your identity/soul/behaviour files — those live in your home and are reached via `home_write` / `home_read`.',
  ]
  parts.push(groupLines.join('\n'))

  if (agent.group.userMd.trim()) {
    parts.push(
      `# About the User\n\nShared context about the human you're working with in this group. Both you and the human curate it. To update: call \`user_md_get\` (returns current content + an etag), merge your change into the full text, then call \`user_md_write\` with the merged content and the etag. Use this for STABLE user-specific facts (preferences, role, working hours, how they like to be addressed) — and to CORRECT stale entries when the human tells you something different from what's recorded. For project knowledge use \`memory_write\` instead; for personal notes about yourself use \`home_write\` on IDENTITY.md. **Do NOT send peer messages announcing USER.md changes — every agent in the group sees the new content in their system prompt on their next turn automatically.**\n\n${agent.group.userMd.trim()}`,
    )
  } else {
    parts.push(
      `# About the User\n\nThis group's USER.md is empty. As you learn STABLE facts about the human (preferences, role, working hours, how they like to be addressed), populate it via \`user_md_get\` then \`user_md_write\` (always get first — you need the etag). Reserve this for things you're confident are durable — project knowledge belongs in \`memory_write\`, personal notes about yourself in \`home_write\` on IDENTITY.md. **Do NOT send peer messages announcing USER.md changes — every agent in the group sees the new content in their system prompt on their next turn automatically.**`,
    )
  }

  parts.push(
    '# Memory\n\nYou share a persistent memory backend with every other agent in this group. Use `memory_write` to remember things across sessions, and `memory_search` / `memory_read` / `memory_list` to recall them. This memory is for project knowledge — codebase notes, decisions, things the user told you about the work. For personal notes about yourself (preferences, persona quirks), use `home_write` on IDENTITY.md instead. Always check memory at the start of a session: another agent in the group may have already learned something useful. **Do NOT send peer messages announcing memory writes — every agent has access to the same store via `memory_search` and will find your note when they need it.**',
  )

  return parts.join('\n\n---\n\n')
}
