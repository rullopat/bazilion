// Bazilion system-prompt builder. Feeds pi's `getAppendSystemPrompt()` hook
// so the agent sees its persona + skills + workspaces + memory guidance
// stacked on top of pi's built-in base prompt (which lists coding tools and
// general guidelines). Pure filesystem read — no LLM, no DB.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import { parseSkillContent } from '../../core/skills/parse.ts'
import { readRegularFileNoFollow, resolveRealDirectory } from '../safe-files.ts'
import type { BashSandboxMode } from '../shell/security.ts'
import type { AgentContact } from '../worker/ipc-protocol.ts'
import { browserGuideSection } from './browser-guide.ts'

const SANDBOX_SKILLS_DIR = '/skills'

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
  /**
   * Include the bundled browser operating guide. Supplied only
   * when the ordinary browser tools are actually admitted — the SAME host
   * presence that registers the `browser_*` tools, so guidance and
   * capability never drift apart.
   * `'attached'` when the tools drive the user's own browser (in this conversation).
   */
  browserGuide?: boolean | 'attached'
  /** The turn has `browser_use`: the browser conversations start with (BAZ-102). */
  browserDefault?: 'own' | 'yours'
  /** Web research guidance, when the turn has web_search. */
  searchGuide?: boolean
  /**
   * MCP connections whose tools wait to be found (BAZ-100): their group name (`mcp__github`), the
   * operator's name for them, and how many tools each has.
   */
  connections?: readonly { group: string; name: string; tools: number }[]
  /** Whom the Agent can message: its teammates, and Agents of other Teams it may reach. */
  contacts?: readonly AgentContact[]
  /** The turn offers `agent_create`. */
  canCreateAgents?: boolean
  /**
   * The operator started the turn (a chat, a follow-up, Telegram). Otherwise (a schedule, a
   * teammate's message) a first-run ritual waits: there is nobody to answer its questions.
   */
  withOperator?: boolean
  /** The turn's replies go to the Agent's Telegram topic too (it has one, and the bot runs). */
  telegram?: boolean
  /** Messages from other Agents waiting unread: the prompt says so, so the Agent reads them. */
  unreadMessages?: number
  /** The Agent's secrets, by name and the hosts web_fetch may send each to. */
  secrets?: readonly { name: string; hosts: readonly string[] }[]
}

/** Teammates listed by name in the prompt; past this, the rest are counted. */
const MAX_LISTED_TEAMMATES = 40
const MAX_LISTED_OUTSIDE = 20

/** One titled block of the appended system prompt, kept apart so it can be measured. */
export interface PromptSection {
  id:
    | 'agent-instructions'
    | 'first-run'
    | 'agent-home'
    | 'telegram'
    | 'skills'
    | 'search-guide'
    | 'connections'
    | 'browser-guide'
    | 'team'
    | 'user'
    | 'secrets'
    | 'memory'
  text: string
}

interface HomeDocuments {
  'SOUL.md': string | null
  'IDENTITY.md': string | null
  'BOOTSTRAP.md': string | null
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
      const parsed = parseSkillContent(readRegularFileNoFollow(join(hostDir, 'SKILL.md')))
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

// Who the Agent is and how it works (SOUL.md, with its role and rules), then its name and look.
//
// BOOTSTRAP.md is intentionally NOT in this generic-context list — it gets
// its own dedicated "First-Run Ritual" section below with explicit
// anti-checklist framing, so models treat it as multi-turn Q&A guidance
// rather than a one-shot script to execute. The system prompt regenerates
// per turn, so the section auto-vanishes when `bootstrap_done` removes the
// file (vs. wrapping the user message, which would persist in pi's session
// JSONL forever and replay on every future turn).
const CONTEXT_FILE_ORDER = ['SOUL.md', 'IDENTITY.md'] as const

/** Snapshot the exact Agent-home prompt inputs without following fixed-name links. */
function loadHomeDocuments(agentDir: string): HomeDocuments {
  const root = resolveRealDirectory(agentDir)
  const read = (file: keyof HomeDocuments): string | null => {
    try {
      return readRegularFileNoFollow(join(root, file))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error(`private Agent home is unsafe at ${file}`)
    }
  }
  return {
    'SOUL.md': read('SOUL.md'),
    'IDENTITY.md': read('IDENTITY.md'),
    'BOOTSTRAP.md': read('BOOTSTRAP.md'),
  }
}

export function buildSystemPrompt(
  agent: ResolvedAgent,
  options: BuildSystemPromptOptions = {},
): string {
  return buildSystemPromptSections(agent, options)
    .map((section) => section.text)
    .join('\n\n---\n\n')
}

export function buildSystemPromptSections(
  agent: ResolvedAgent,
  options: BuildSystemPromptOptions = {},
): PromptSection[] {
  const parts: PromptSection[] = []
  const homeDocuments = loadHomeDocuments(agent.agent.dir)

  const contextBlocks: string[] = []
  for (const file of CONTEXT_FILE_ORDER) {
    const content = homeDocuments[file]?.trimEnd()
    if (!content) continue
    contextBlocks.push(`## ${file}\n\n${content}`)
  }
  if (contextBlocks.length > 0) {
    parts.push({
      id: 'agent-instructions',
      text: `# Agent instructions\n\n${contextBlocks.join('\n\n')}`,
    })
  }

  // First-Run Ritual block — only emitted while BOOTSTRAP.md exists on disk.
  // The wording deliberately frames it as "multi-turn Q&A" not "checklist"
  // and lists hard rules at the top so tool-eager models still notice them
  // even if they skim the body.
  const bootstrap = homeDocuments['BOOTSTRAP.md']?.trimEnd()
  if (bootstrap && options.withOperator === false) {
    parts.push({
      id: 'first-run',
      text: [
        '# First-Run Ritual',
        '',
        'You have not had your first conversation with the human yet; it waits until they talk to you. This turn was not started by them (a teammate wrote to you, or a schedule fired), so nobody is here to answer its questions: do not greet the human or ask who you are. Do the work this turn asks for, with what you know.',
      ].join('\n'),
    })
  } else if (bootstrap) {
    parts.push({
      id: 'first-run',
      text: [
        '# First-Run Ritual',
        '',
        'This is your first session. The document below is **conversational guidance**, not a checklist to execute in one shot. It describes a multi-turn Q&A you should have with the human, one question per turn.',
        '',
        '## Hard rules',
        '- Your first reply is ONLY a greeting + ONE question. No tool calls. Wait for the human to answer.',
        '- Each subsequent turn: at most one new question. Wait between turns.',
        '- Only after the ritual is complete (you have enough to write IDENTITY.md): call `home_write` once, then `bootstrap_done`.',
        ...(agent.team.userMd.trim()
          ? [
              "- The Team's USER.md (under About the User) already says some things about the human: do not ask what it answers.",
            ]
          : []),
        '',
        '## BOOTSTRAP.md',
        '',
        bootstrap,
      ].join('\n'),
    })
  }

  parts.push({
    id: 'agent-home',
    text: [
      '# Agent Home',
      '',
      'Your private home holds who you are: SOUL.md (your role, personality, boundaries and the rules you keep about how you work) and IDENTITY.md (your name and look), plus BOOTSTRAP.md when you are still in your first-run ritual. It is not shared with other agents and cannot be overwritten by them.',
      '',
      '- To change who you are (name, vibe, personality, how you behave): use `home_write`.',
      '- When the human gives you a rule about how you work that should hold from now on ("always…", "never…", "from now on…"), add it to SOUL.md under `## How you work` with `home_edit` (start that section if it is missing). Change or remove it when they take it back. A preference every Agent in the Team should follow belongs in USER.md instead.',
      '- To inspect exact wording of your own files: use `home_read` or `home_list`.',
      '- To remember facts the user told you or things you learned: use `memory_write` — NOT `home_write`.',
      '- To produce work output (code, docs, artefacts): use the workspace tools currently exposed to you — those operate on your team workspace, not your private home.',
    ].join('\n'),
  })

  if (options.telegram) {
    parts.push({
      id: 'telegram',
      text: [
        '# Telegram',
        '',
        "Your replies also go to your topic in the human's Telegram group, often read on a phone. Keep them short and match the length of what you were asked. Say a thing in one message rather than several in a row. Markdown is converted for Telegram: headings become bold lines and tables fixed-width blocks, so short paragraphs and lists read best.",
      ].join('\n'),
    })
  }

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
    parts.push({
      id: 'skills',
      text: [
        '# Available Skills',
        '',
        'Use these attached skill instructions when they are relevant to the task.',
        '',
        ...skillBlocks,
        ...(unavailableNote ? ['', unavailableNote] : []),
      ].join('\n'),
    })
  }

  if (options.searchGuide) {
    parts.push({
      id: 'search-guide',
      text: '# Web research\n\nUse web_search to find sources and web_fetch to read them. Cite the URLs you actually read.',
    })
  }

  if (options.connections && options.connections.length > 0) {
    parts.push({ id: 'connections', text: connectionsSection(options.connections) })
  }

  // Browser operating guide — only when the browser tools are admitted (T10).
  if (options.browserGuide) {
    parts.push({
      id: 'browser-guide',
      text: browserGuideSection(
        options.browserGuide === 'attached',
        options.browserDefault ? { byDefault: options.browserDefault } : undefined,
      ),
    })
  }

  const teamLines = [
    '# Team',
    '',
    `- ${agent.team.id} (${agent.team.name}): ${options.sandboxMode === 'docker' ? '/workspace' : agent.team.path}`,
    '',
    'Your team is where work product lives — code, docs, artefacts, shared scratch. It may be shared with other agents in the same team. Use the workspace tools currently exposed to work there. Never use workspace tools to edit your identity/soul/behaviour files — those live in your private home and are reached via `home_write` / `home_read`.',
    '',
    'An `AGENTS.md` file in the workspace holds repository instructions that govern its own directory and everything below it. The ones from the workspace root down to your working directory are already in your project instructions; read any other `AGENTS.md` on the path to files you edit.',
  ]
  teamLines.push('', ...teammateLines(agent, options))
  parts.push({ id: 'team', text: teamLines.join('\n') })

  if (agent.team.userMd.trim()) {
    parts.push({
      id: 'user',
      text: `# About the User\n\nShared context about the human you're working with in this team. Both you and the human curate it. To update: call \`user_md_get\` (returns current content + an etag), merge your change into the full text, then call \`user_md_write\` with the merged content and the etag. Use this for STABLE user-specific facts (preferences, role, working hours, how they like to be addressed) — and to CORRECT stale entries when the human tells you something different from what's recorded. For project knowledge use \`memory_write\` instead; for personal notes about yourself use \`home_write\` on IDENTITY.md. **Do NOT send peer messages announcing USER.md changes — every agent in the team sees the new content in their system prompt on their next turn automatically.**\n\n${agent.team.userMd.trim()}`,
    })
  } else {
    parts.push({
      id: 'user',
      text: `# About the User\n\nThis team's USER.md is empty. As you learn STABLE facts about the human (preferences, role, working hours, how they like to be addressed), populate it via \`user_md_get\` then \`user_md_write\` (always get first — you need the etag). Reserve this for things you're confident are durable — project knowledge belongs in \`memory_write\`, personal notes about yourself in \`home_write\` on IDENTITY.md. **Do NOT send peer messages announcing USER.md changes — every agent in the team sees the new content in their system prompt on their next turn automatically.**`,
    })
  }

  const secrets = options.secrets ?? []
  if (secrets.length > 0) {
    parts.push({
      id: 'secrets',
      text: [
        '# Secrets',
        '',
        'The user gave you these secrets. You never see their values: your commands have each as an environment variable of its name, and web_fetch fills in a header written {{secret:NAME}} for the hosts listed. Never print one or send it anywhere else.',
        '',
        ...secrets.map(
          (secret) =>
            `- ${secret.name}${secret.hosts.length > 0 ? `: web_fetch for ${secret.hosts.join(', ')}` : ': commands only'}`,
        ),
      ].join('\n'),
    })
  }

  parts.push({
    id: 'memory',
    text: '# Memory\n\nYou share a persistent memory backend with every other agent in this team. Use `memory_write` to remember things across sessions, and `memory_search` / `memory_read` / `memory_list` to recall them. This memory is for project knowledge — codebase notes, decisions, things the user told you about the work. For personal notes about yourself (preferences, persona quirks), use `home_write` on IDENTITY.md instead. Always check memory at the start of a session: another agent in the team may have already learned something useful. **Do NOT send peer messages announcing memory writes — every agent has access to the same store via `memory_search` and will find your note when they need it.**\n\nWhen a conversation grows long, its older messages are replaced by a summary. They stay saved: when the summary leaves out a detail you need, find it with `recall` instead of guessing or asking again.',
  })

  return parts
}

/** Who the Agent can message, by name and id, so it never needs the operator to look them up. */
function teammateLines(agent: ResolvedAgent, options: BuildSystemPromptOptions): string[] {
  const contacts = options.contacts ?? []
  // Names are shown on one line whatever they hold: one made before names were checked cannot
  // start a line of these instructions.
  const line = (text: string) => text.replace(/[\p{Cc}\p{Cf}\u2028\u2029\s]+/gu, ' ').trim()
  const entry = (contact: AgentContact, team: boolean) =>
    `- ${line(contact.name)}${contact.calledName ? ` (calls itself ${line(contact.calledName)})` : ''}: id ${contact.id}${team ? '' : `, Team ${line(contact.teamName)}`} (template ${line(contact.template)})`
  const listed = (list: readonly AgentContact[], max: number, team: boolean) => [
    ...list.slice(0, max).map((contact) => entry(contact, team)),
    ...(list.length > max ? [`- and ${list.length - max} more`] : []),
  ]
  const teammates = contacts.filter((contact) => contact.teamId === agent.team.id)
  const reachable = teammates.filter((contact) => contact.canMessage)
  const unreachable = teammates.filter((contact) => !contact.canMessage)
  const outside = contacts.filter((contact) => contact.teamId !== agent.team.id)
  const create = options.canCreateAgents
    ? ' When the human asks you to add teammates, create them with `agent_create`.'
    : ''
  const lines = ['## Your teammates', '']
  if (teammates.length === 0) {
    lines.push(`You are the only Agent in this Team so far.${create}`)
  } else {
    lines.push(
      `Message an Agent with \`send_message\`: put its id (or its exact name) in \`to\`. These are current; do not ask the human for ids.${create}`,
    )
    if (reachable.length > 0) lines.push('', ...listed(reachable, MAX_LISTED_TEAMMATES, true))
    if (unreachable.length > 0) {
      lines.push(
        '',
        "In this restricted Team you have no connection to these teammates, so you cannot message them; the human can connect you in the Team's Connections view:",
        ...listed(unreachable, MAX_LISTED_TEAMMATES, true),
      )
    }
  }
  if (outside.length > 0) {
    lines.push(
      '',
      'Team Policy also lets you message these Agents of other Teams:',
      ...listed(outside, MAX_LISTED_OUTSIDE, false),
    )
  }
  const unread = options.unreadMessages ?? 0
  if (unread > 0) {
    lines.push(
      '',
      `${unread === 1 ? 'A message from another Agent is' : `${unread} messages from other Agents are`} waiting in your inbox, sent for you to know rather than to act on at once: read them with \`read_inbox\` when they bear on what you are doing.`,
    )
  }
  return lines
}

/** The MCP connections whose tools are found with `tool_search` or called from a script. */
function connectionsSection(
  connections: readonly { group: string; name: string; tools: number }[],
): string {
  return [
    '# Connections',
    '',
    "These connections' tools are not loaded yet. Load the ones a task needs with `tool_search` (they stay loaded for this conversation), or call them from a `codemode` script, where they are `tools.<name>` and `searchTools()` finds them.",
    '',
    ...connections.map(
      (connection) =>
        `- ${connection.name} (\`${connection.group}\`): ${connection.tools} tool${connection.tools === 1 ? '' : 's'}`,
    ),
  ].join('\n')
}
