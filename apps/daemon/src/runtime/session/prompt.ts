// Bazilion system-prompt builder. Feeds pi's `getAppendSystemPrompt()` hook
// so the agent sees its persona + skills + workspaces + memory guidance
// stacked on top of pi's built-in base prompt (which lists coding tools and
// general guidelines). Pure filesystem read — no LLM, no DB.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'

// Prompt order: peers first (who else is around), then persona, then tooling
// hints, then self-knowledge, then the wake-up playbook, then the one-shot
// bootstrap intro.
const CONTEXT_FILE_ORDER = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
] as const

export function buildSystemPrompt(agent: ResolvedAgent): string {
  const parts: string[] = []

  const contextBlocks: string[] = []
  let bootstrapPresent = false
  for (const file of CONTEXT_FILE_ORDER) {
    const path = join(agent.agent.dir, file)
    if (!existsSync(path)) continue
    const content = readFileSync(path, 'utf8').trimEnd()
    if (!content) continue
    contextBlocks.push(`## ${file}\n\n${content}`)
    if (file === 'BOOTSTRAP.md') bootstrapPresent = true
  }
  if (contextBlocks.length > 0) {
    parts.push(`# Project Context\n\n${contextBlocks.join('\n\n')}`)
  }
  if (bootstrapPresent) {
    parts.push(
      'NOTE: This is your first session. After you have completed the bootstrap conversation, call the `bootstrap_done` tool to delete BOOTSTRAP.md.',
    )
  }

  parts.push(
    [
      '# Agent Home',
      '',
      'Your private home holds who you are — identity, soul, behaviour rules, wake-up routine. It is not shared with other agents and cannot be overwritten by them. The files above (IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md) live in this home.',
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
      `# About the User\n\nRead-only context about the human you're working with in this group. You cannot edit this — if it's wrong, say so and they will update it.\n\n${agent.group.userMd.trim()}`,
    )
  }

  parts.push(
    '# Memory\n\nYou share a persistent memory backend with every other agent in this group. Use `memory_write` to remember things across sessions, and `memory_search` / `memory_read` / `memory_list` to recall them. This memory is for project knowledge — codebase notes, decisions, things the user told you about the work. For personal notes about yourself (preferences, persona quirks), use `home_write` on IDENTITY.md instead. Always check memory at the start of a session: another agent in the group may have already learned something useful.',
  )

  return parts.join('\n\n---\n\n')
}
