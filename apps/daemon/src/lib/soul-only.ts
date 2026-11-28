// From 0.67.0 (BAZ-105) an Agent's home and an Agent template have SOUL.md and IDENTITY.md (and
// BOOTSTRAP.md until the first conversation): AGENTS.md and TOOLS.md are gone. At each start the
// daemon moves into SOUL.md, which is in the instructions on every turn, what such a file still
// holds that the built-in default did not say: the role at the top of an AGENTS.md goes to the
// top of SOUL.md, its approved lessons to the end, and any other text under "How you work" (an
// AGENTS.md) or "Tools" (a TOOLS.md). A SOUL.md that is a shipped default becomes today's. The
// files as they were, SOUL.md included, are copied under upgrades/ first; then the two are
// removed, so a home already moved is not touched again.

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SOUL, type Paths } from '../core/index.ts'
import { LESSONS_HEADING } from './approved-lessons.ts'
import { AGENTS_066, TOOLS_066 } from './soul-only-defaults.ts'

const OLD_FILES = ['AGENTS.md', 'TOOLS.md'] as const

/** sha256 of every built-in default Bazilion shipped, trimmed: such text says nothing of its own. */
const SHIPPED_DEFAULTS = {
  'AGENTS.md': new Set([
    'c26bbf2efcd8d2ddd906d99699b02a3346d745ac0d3adf150548f054b504f6e3',
    '7058f6def3e8048d25cb0b6902b45e1809b5513908148d0ec61ac79d8f40cb70',
    'd53ff75f0d97d1368354e31079a929ea98af02206a0a43bd42530ad8ef852732',
  ]),
  'TOOLS.md': new Set([
    '6347657a1d25c3e81ed8e9fbbb3f6b187ee670b8148cc318e07aea7fd2e086b7',
    'ad35c08f216dc2771173e3b6748af20a0afbcbd2e0f4875ef94ad0bbd74ce6de',
  ]),
  'SOUL.md': new Set([
    'c8094265be65d6bacd4dedc459616a20db8f705c9d14e5877f3cc383c9feb410',
    '74147cc4e3f7bc618a3dc1caf03cf18f869c92dbcb6664b7d043f034b85f2b40',
    'fadf0309e68ba79e1f7038e21df9b9553c21a37a6e78375bc4883dbcda007a73',
  ]),
}

/** How the Continuity paragraph of a SOUL.md starts. */
const CONTINUITY = 'Each session you wake up fresh'

/** The Continuity paragraph of the SOUL.md shipped until 0.66.0, which named AGENTS.md. */
const OLD_CONTINUITY = `Each session you wake up fresh — no memory of the last one. These files *are*
your memory: SOUL.md (this), IDENTITY.md (who you are), USER.md (who you help),
AGENTS.md (how you work), plus the team memory store. Keep them current and
future-you will thank present-you.`

const ROLE_HEADING = '# Your role\n'
const ROLE_SEPARATOR = '\n---\n'
/** The last line of a role block: who added the Agent, and when (`core/agent/spawn.ts`). */
const ADDED_BY = / added you to the Team .+ on \d{4}-\d{2}-\d{2}[.,]/

const normal = (text: string) => text.replace(/\r\n/g, '\n').trim()
const isShipped = (file: keyof typeof SHIPPED_DEFAULTS, text: string) =>
  SHIPPED_DEFAULTS[file].has(createHash('sha256').update(normal(text)).digest('hex'))

/**
 * A file's role block (written when the Agent was given a role) and the rest of it. The block
 * ends with the line saying who added the Agent; a role may hold `---` lines of its own.
 */
function splitRole(text: string): { role: string | null; rest: string } {
  const body = normal(text)
  if (!body.startsWith(ROLE_HEADING)) return { role: null, rest: body }
  let end = body.indexOf(ROLE_SEPARATOR)
  for (let at = end; at >= 0; at = body.indexOf(ROLE_SEPARATOR, at + 1)) {
    const before = body.slice(0, at).trimEnd()
    if (ADDED_BY.test(before.slice(before.lastIndexOf('\n') + 1))) {
      end = at
      break
    }
  }
  if (end < 0) return { role: body, rest: '' }
  return { role: body.slice(0, end).trim(), rest: body.slice(end + ROLE_SEPARATOR.length).trim() }
}

/**
 * A file's own text: none when it is a shipped default, and only what follows when it starts with
 * the last one (an Agent added to the end of it).
 */
function ownText(file: 'AGENTS.md' | 'TOOLS.md', text: string): string {
  const body = normal(text)
  if (!body || isShipped(file, body)) return ''
  const shipped = normal(file === 'AGENTS.md' ? AGENTS_066 : TOOLS_066)
  return body.startsWith(shipped) ? body.slice(shipped.length).trim() : body
}

/** The text without its leading `# AGENTS.md …` or `# TOOLS.md …` title. */
function untitled(text: string, file: string): string {
  const [first, ...rest] = text.split('\n')
  return first?.startsWith(`# ${file}`) ? rest.join('\n').trim() : text
}

/** A file's approved lessons (added at its end by the 0.66.0 upgrade) and the text before them. */
function splitLessons(text: string): { text: string; lessons: string } {
  const at = text.indexOf(LESSONS_HEADING)
  if (at < 0) return { text, lessons: '' }
  return { text: text.slice(0, at).trim(), lessons: text.slice(at).trim() }
}

/** What SOUL.md becomes once the two files' own text is in it. */
export function soulWithOldFiles(
  soulText: string,
  old: { 'AGENTS.md'?: string; 'TOOLS.md'?: string },
): string {
  const soul = splitRole(soulText)
  const agents = splitRole(old['AGENTS.md'] ?? '')
  const kept = splitLessons(soul.rest)
  const carried = splitLessons(agents.rest)
  const rules = ownText('AGENTS.md', carried.text)
  const tools = ownText('TOOLS.md', old['TOOLS.md'] ?? '')

  const body =
    !kept.text || isShipped('SOUL.md', kept.text)
      ? normal(DEFAULT_SOUL)
      : kept.text.replace(
          OLD_CONTINUITY,
          normal(DEFAULT_SOUL.slice(DEFAULT_SOUL.indexOf(CONTINUITY))),
        )
  const sections: string[] = [body]
  for (const part of [
    rules && `## How you work\n\n${untitled(rules, 'AGENTS.md')}`,
    tools && `## Tools\n\n${untitled(tools, 'TOOLS.md')}`,
    kept.lessons,
    carried.lessons,
  ]) {
    if (part && !sections.some((section) => section.includes(part))) sections.push(part)
  }
  const role = soul.role ?? agents.role
  return `${role ? `${role}\n\n---\n\n` : ''}${sections.join('\n\n')}\n`
}

/** What is at `path`, without following a link: null when nothing is. */
function entry(path: string): 'file' | 'other' | null {
  try {
    return lstatSync(path).isFile() ? 'file' : 'other'
  } catch {
    return null
  }
}

/** Move one home's or template's AGENTS.md and TOOLS.md into its SOUL.md; false when it had none. */
function moveInto(dir: string, keep: () => string): boolean {
  const present = OLD_FILES.filter((file) => entry(join(dir, file)) !== null)
  if (present.length === 0) return false
  const soulPath = join(dir, 'SOUL.md')
  for (const path of [soulPath, ...present.map((file) => join(dir, file))]) {
    if (entry(path) === 'other') throw new Error(`${path} is not a regular file`)
  }
  const old: { 'AGENTS.md'?: string; 'TOOLS.md'?: string } = {}
  for (const file of present) old[file] = readFileSync(join(dir, file), 'utf8')
  const soul = existsSync(soulPath) ? readFileSync(soulPath, 'utf8') : ''

  const copy = keep()
  mkdirSync(copy, { recursive: true })
  for (const file of [...present, ...(soul ? ['SOUL.md'] : [])]) {
    copyFileSync(join(dir, file), join(copy, file))
  }
  const next = soulWithOldFiles(soul, old)
  if (next !== soul) {
    writeFileSync(`${soulPath}.tmp`, next)
    renameSync(`${soulPath}.tmp`, soulPath)
  }
  for (const file of present) rmSync(join(dir, file), { force: true })
  return true
}

function directories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Move every Agent's and template's AGENTS.md and TOOLS.md into its SOUL.md, keeping the files as
 * they were under `upgrades/agent-files-<time>/`. One that cannot be moved is reported and left as
 * it is, to be tried again at the next start.
 */
export function moveOldFilesIntoSoul(paths: Paths): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const keptAt = join(paths.upgradesDir, `agent-files-${stamp}`)
  const moved = { agents: 0, templates: 0 }
  for (const [kind, root, label] of [
    ['agents', paths.agentsDir, 'Agent'],
    ['templates', paths.profilesDir, 'Agent template'],
  ] as const) {
    for (const id of directories(root)) {
      const dir = join(root, id)
      try {
        if (moveInto(dir, () => join(keptAt, kind === 'agents' ? 'agents' : 'profiles', id))) {
          moved[kind] += 1
        }
      } catch (error) {
        console.warn(
          `bazilion could not move the ${label} ${id}'s AGENTS.md and TOOLS.md into its SOUL.md: ` +
            `${(error as Error).message}. They stay as they are, and what they say is not in its ` +
            'instructions: replace a link among SOUL.md, AGENTS.md and TOOLS.md with the file it ' +
            'points to, and restart Bazilion to move them.',
        )
      }
    }
  }
  if (moved.agents + moved.templates > 0) {
    console.log(
      `bazilion moved AGENTS.md and TOOLS.md into SOUL.md for ${moved.agents} Agent(s) and ` +
        `${moved.templates} Agent template(s); the files as they were are kept at ${keptAt}`,
    )
  }
}
