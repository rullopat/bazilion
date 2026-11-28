// 0.67.0 (BAZ-105): AGENTS.md and TOOLS.md are gone from Agent homes and templates. Starting the
// daemon on a home from before moves what they held that the defaults did not into SOUL.md, and
// keeps the files as they were under upgrades/.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_SOUL } from '../../src/core/profile/templates.ts'
import { soulWithOldFiles } from '../../src/lib/soul-only.ts'

const shipped = (file: string) =>
  readFileSync(join(import.meta.dirname, '../fixtures/agent-files-0.66', file), 'utf8')
const OLD = { soul: shipped('SOUL.md'), agents: shipped('AGENTS.md'), tools: shipped('TOOLS.md') }
const ROLE =
  '# Your role\n\nWrites the newsletter.\n\nThe operator added you to the Team Launch on 2026-11-20.'
const LESSONS = [
  '## Lessons the human approved',
  '',
  "These were approved by the human for your behaviour. Follow them when relevant; the human's current instructions still win.",
  '',
  '- Run the tests before saying it works.',
].join('\n')

let home: string
let oldHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-soul-only-'))
  oldHome = process.env.BAZILION_HOME
  process.env.BAZILION_HOME = home
  vi.resetModules()
})

afterEach(async () => {
  const { closeCtxForShutdown } = await import('../../src/lib/ctx.ts')
  closeCtxForShutdown()
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

function writeFiles(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
}

async function start(): Promise<void> {
  vi.resetModules()
  const { closeCtxForShutdown, getCtx } = await import('../../src/lib/ctx.ts')
  getCtx()
  closeCtxForShutdown()
}

const read = (...parts: string[]) => readFileSync(join(home, ...parts), 'utf8')

test('starting on a 0.66 home moves AGENTS.md and TOOLS.md into SOUL.md and keeps the originals', async () => {
  const roled = `${ROLE}\n\n---\n\n${OLD.agents.trim()}\n`
  writeFiles(join(home, 'agents', 'plain'), {
    'SOUL.md': OLD.soul,
    'AGENTS.md': OLD.agents,
    'TOOLS.md': OLD.tools,
    'IDENTITY.md': '- **Name:** Plain\n',
  })
  writeFiles(join(home, 'agents', 'roled'), {
    'SOUL.md': OLD.soul,
    'AGENTS.md': roled,
    'TOOLS.md': OLD.tools,
  })
  writeFiles(join(home, 'agents', 'edited'), {
    'SOUL.md': '# Me\n\nA custom soul.\n',
    'AGENTS.md': `# AGENTS.md — How You Work\n\nAlways answer in Italian.\n\n${LESSONS}\n`,
    'TOOLS.md': '# TOOLS.md — Tool Playbook\n\n- The NAS is 10.0.0.2.\n',
  })
  writeFiles(join(home, 'profiles', 'default'), {
    'SOUL.md': OLD.soul,
    'AGENTS.md': OLD.agents,
    'TOOLS.md': OLD.tools,
    'IDENTITY.md': '- **Name:**\n',
  })
  writeFiles(join(home, 'agents', 'done'), { 'SOUL.md': 'Already moved.\n' })
  await start()

  expect(read('agents', 'plain', 'SOUL.md')).toBe(DEFAULT_SOUL)
  expect(read('agents', 'roled', 'SOUL.md')).toBe(`${ROLE}\n\n---\n\n${DEFAULT_SOUL}`)
  expect(read('agents', 'edited', 'SOUL.md')).toBe(
    [
      '# Me',
      '',
      'A custom soul.',
      '',
      '## How you work',
      '',
      'Always answer in Italian.',
      '',
      '## Tools',
      '',
      '- The NAS is 10.0.0.2.',
      '',
      `${LESSONS}\n`,
    ].join('\n'),
  )
  expect(read('profiles', 'default', 'SOUL.md')).toBe(DEFAULT_SOUL)
  expect(read('agents', 'done', 'SOUL.md')).toBe('Already moved.\n')
  for (const dir of ['agents/plain', 'agents/roled', 'agents/edited', 'profiles/default']) {
    expect(readdirSync(join(home, dir)).filter((file) => file !== 'IDENTITY.md')).toEqual([
      'SOUL.md',
    ])
  }

  const kept = readdirSync(join(home, 'upgrades')).filter((name) => name.startsWith('agent-files-'))
  expect(kept).toHaveLength(1)
  const copy = (...parts: string[]) => read('upgrades', kept[0] ?? '', ...parts)
  expect(copy('agents', 'roled', 'AGENTS.md')).toBe(roled)
  expect(copy('agents', 'roled', 'SOUL.md')).toBe(OLD.soul)
  expect(copy('agents', 'plain', 'TOOLS.md')).toBe(OLD.tools)
  expect(copy('profiles', 'default', 'AGENTS.md')).toBe(OLD.agents)
  expect(existsSync(join(home, 'upgrades', kept[0] ?? '', 'agents', 'done'))).toBe(false)

  // A second start finds nothing to move and keeps no new copy.
  await start()
  expect(read('agents', 'roled', 'SOUL.md')).toBe(`${ROLE}\n\n---\n\n${DEFAULT_SOUL}`)
  expect(
    readdirSync(join(home, 'upgrades')).filter((name) => name.startsWith('agent-files-')),
  ).toEqual(kept)
})

test('a home it cannot move is left as it is and does not stop the others', async () => {
  writeFiles(join(home, 'outside'), { 'rules.md': 'Linked rules.\n' })
  writeFiles(join(home, 'agents', 'linked'), { 'SOUL.md': OLD.soul })
  symlinkSync(join(home, 'outside', 'rules.md'), join(home, 'agents', 'linked', 'AGENTS.md'))
  writeFiles(join(home, 'agents', 'plain'), { 'SOUL.md': OLD.soul, 'TOOLS.md': OLD.tools })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await start()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the Agent linked'))
  } finally {
    warn.mockRestore()
  }
  expect(read('agents', 'linked', 'SOUL.md')).toBe(OLD.soul)
  expect(read('agents', 'linked', 'AGENTS.md')).toBe('Linked rules.\n')
  expect(read('agents', 'plain', 'SOUL.md')).toBe(DEFAULT_SOUL)
  expect(existsSync(join(home, 'agents', 'plain', 'TOOLS.md'))).toBe(false)
})

test('what an Agent added to the end of a default is all that moves', () => {
  const moved = soulWithOldFiles(OLD.soul, {
    'AGENTS.md': `${OLD.agents.trimEnd()}\n\n- Always answer in Italian.\n`,
    'TOOLS.md': `${OLD.tools.trimEnd()}\n- The NAS is 10.0.0.2.\n`,
  })
  expect(moved).toBe(
    `${DEFAULT_SOUL.trim()}\n\n## How you work\n\n- Always answer in Italian.\n\n## Tools\n\n- The NAS is 10.0.0.2.\n`,
  )
})

test('a role with a --- line of its own moves whole, and the default does not come back', () => {
  const role = [
    '# Your role',
    '',
    'Research lead.',
    '',
    '---',
    '',
    'Sources: primary only.',
    '',
    'Sally (Agent id a1) added you to the Team Sales on 2026-11-20, when the operator asked. Report back to Sally unless the operator says otherwise.',
  ].join('\n')
  const moved = soulWithOldFiles(OLD.soul, { 'AGENTS.md': `${role}\n\n---\n\n${OLD.agents}` })
  expect(moved).toBe(`${role}\n\n---\n\n${DEFAULT_SOUL}`)
})

test('a move cut short and run again adds nothing twice', () => {
  const once = soulWithOldFiles(OLD.soul, {
    'AGENTS.md': `${ROLE}\n\n---\n\nBe brief.\n\n${LESSONS}\n`,
  })
  expect(once).toBe(
    `${ROLE}\n\n---\n\n${DEFAULT_SOUL.trim()}\n\n## How you work\n\nBe brief.\n\n${LESSONS}\n`,
  )
  // SOUL.md was written but AGENTS.md was not removed yet: the next start moves it again.
  expect(
    soulWithOldFiles(once, { 'AGENTS.md': `${ROLE}\n\n---\n\nBe brief.\n\n${LESSONS}\n` }),
  ).toBe(once)
})

test('a changed SOUL.md keeps its text, and its Continuity no longer names AGENTS.md', () => {
  const changed = OLD.soul.replace('Have opinions.', 'Have strong opinions.')
  const moved = soulWithOldFiles(changed, { 'AGENTS.md': OLD.agents })
  expect(moved).toContain('Have strong opinions.')
  expect(moved).not.toContain('AGENTS.md')
  expect(
    moved.trim().endsWith(DEFAULT_SOUL.slice(DEFAULT_SOUL.indexOf('Each session')).trim()),
  ).toBe(true)
})
