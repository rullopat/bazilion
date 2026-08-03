// Bazilion system-prompt builder. Feeds pi's `getAppendSystemPrompt()` hook
// so the agent sees its persona + skills + workspaces + memory guidance
// stacked on top of pi's built-in base prompt (which lists coding tools and
// general guidelines). Pure filesystem read — no LLM, no DB.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import { parseSkillFile } from '../../core/skills/parse.ts'
import type { BashSandboxMode } from '../shell/security.ts'

export const SANDBOX_SKILLS_DIR = '/skills'

export interface PromptSkill {
  name: string
  description: string
  body: string
  hostDir: string
  sandboxDir: string
}

export interface BuildSystemPromptOptions {
  skills?: readonly PromptSkill[]
  sandboxMode?: BashSandboxMode
}

/** Load only direct, installed skill directories attached to this agent. */
export function loadPromptSkills(
  skillsDir: string,
  attachedNames: readonly string[],
): PromptSkill[] {
  if (!existsSync(skillsDir) || attachedNames.length === 0) return []
  const attached = new Set(attachedNames)
  const discovered = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && attached.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  const loaded: PromptSkill[] = []
  for (const entry of discovered) {
    const hostDir = join(skillsDir, entry.name)
    try {
      const parsed = parseSkillFile(join(hostDir, 'SKILL.md'))
      const safeLabel = entry.name.replace(/[^A-Za-z0-9._-]/g, '_') || 'skill'
      loaded.push({
        name: entry.name,
        description: parsed.frontmatter.description,
        body: parsed.body.trim(),
        hostDir,
        sandboxDir: `${SANDBOX_SKILLS_DIR}/${loaded.length}-${safeLabel}`,
      })
    } catch {
      // The attachment surface already reports missing/parse-broken skills.
      // Keep turn creation resilient and name the unavailable attachment below.
    }
  }
  return loaded
}

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
const CONTEXT_FILE_ORDER = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md'] as const

export function buildSystemPrompt(
  agent: ResolvedAgent,
  options: BuildSystemPromptOptions = {},
): string {
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
      'Your private home holds who you are — identity, soul, and behaviour rules. It is not shared with other agents and cannot be overwritten by them. The files above (IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md) live in this home, plus BOOTSTRAP.md when you are still in your first-run ritual.',
      '',
      '- To change who you are (name, vibe, personality, how you behave): use `home_write`.',
      '- To inspect exact wording of your own files: use `home_read` or `home_list`.',
      '- To remember facts the user told you or things you learned: use `memory_write` — NOT `home_write`.',
      '- To produce work output (code, docs, artefacts): use the workspace tools currently exposed to you — those operate on your team workspace, not your private home.',
    ].join('\n'),
  )

  if (agent.skills.length > 0) {
    const loaded = options.skills ?? []
    const loadedNames = new Set(loaded.map((skill) => skill.name))
    const unavailable = agent.skills.filter((name) => !loadedNames.has(name))
    const skillBlocks = loaded.map((skill) => {
      const runtimeDir = options.sandboxMode === 'docker' ? skill.sandboxDir : skill.hostDir
      return [
        `## ${skill.name}`,
        '',
        skill.description,
        '',
        `Runtime directory: \`${runtimeDir}\`. Resolve any relative scripts or assets mentioned by this skill from that directory.`,
        '',
        skill.body,
      ]
        .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
        .join('\n')
        .trimEnd()
    })
    const unavailableNote =
      unavailable.length > 0
        ? `Attached but unavailable or invalid: ${unavailable.join(', ')}.`
        : ''
    parts.push(
      [
        '# Available Skills',
        '',
        'Use these attached skill instructions when they are relevant to the task.',
        '',
        ...skillBlocks,
        ...(unavailableNote ? ['', unavailableNote] : []),
      ].join('\n'),
    )
  }

  const teamLines = [
    '# Team',
    '',
    `- ${agent.team.id} (${agent.team.name}): ${agent.team.path}`,
    '',
    'Your team is where work product lives — code, docs, artefacts, shared scratch. It may be shared with other agents in the same team. Use the workspace tools currently exposed to work there. Never use workspace tools to edit your identity/soul/behaviour files — those live in your private home and are reached via `home_write` / `home_read`.',
  ]
  parts.push(teamLines.join('\n'))

  if (agent.team.userMd.trim()) {
    parts.push(
      `# About the User\n\nShared context about the human you're working with in this team. Both you and the human curate it. To update: call \`user_md_get\` (returns current content + an etag), merge your change into the full text, then call \`user_md_write\` with the merged content and the etag. Use this for STABLE user-specific facts (preferences, role, working hours, how they like to be addressed) — and to CORRECT stale entries when the human tells you something different from what's recorded. For project knowledge use \`memory_write\` instead; for personal notes about yourself use \`home_write\` on IDENTITY.md. **Do NOT send peer messages announcing USER.md changes — every agent in the team sees the new content in their system prompt on their next turn automatically.**\n\n${agent.team.userMd.trim()}`,
    )
  } else {
    parts.push(
      `# About the User\n\nThis team's USER.md is empty. As you learn STABLE facts about the human (preferences, role, working hours, how they like to be addressed), populate it via \`user_md_get\` then \`user_md_write\` (always get first — you need the etag). Reserve this for things you're confident are durable — project knowledge belongs in \`memory_write\`, personal notes about yourself in \`home_write\` on IDENTITY.md. **Do NOT send peer messages announcing USER.md changes — every agent in the team sees the new content in their system prompt on their next turn automatically.**`,
    )
  }

  const reviewedLessons = boundReviewedLessons(agent.privateLessons)
  if (reviewedLessons.length > 0) {
    parts.push(
      `# Reviewed lessons\n\nThese private lessons were explicitly approved by the human for your behavior. Follow them when relevant; current user instructions and higher-priority policy still win.\n\n${reviewedLessons.map((lesson) => `- ${lesson}`).join('\n')}`,
    )
  }

  parts.push(
    '# Memory\n\nYou share a persistent memory backend with every other agent in this team. Use `memory_write` to remember things across sessions, and `memory_search` / `memory_read` / `memory_list` to recall them. This memory is for project knowledge — codebase notes, decisions, things the user told you about the work. For personal notes about yourself (preferences, persona quirks), use `home_write` on IDENTITY.md instead. Always check memory at the start of a session: another agent in the team may have already learned something useful. **Do NOT send peer messages announcing memory writes — every agent has access to the same store via `memory_search` and will find your note when they need it.**',
  )

  return parts.join('\n\n---\n\n')
}

function boundReviewedLessons(lessons: readonly string[], maxCharacters = 8_000): string[] {
  const selected: string[] = []
  let used = 0
  for (const raw of lessons) {
    const lesson = raw.trim()
    if (!lesson) continue
    const remaining = maxCharacters - used
    if (remaining <= 0) break
    selected.push(lesson.slice(0, remaining))
    used += Math.min(lesson.length, remaining)
  }
  return selected
}
