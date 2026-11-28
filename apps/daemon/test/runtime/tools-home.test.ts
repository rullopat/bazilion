import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { homeTools } from '../../src/runtime/tools/home.ts'
import { createToolRegistry } from '../fixtures/tool-registry.ts'

let agentDir: string

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'bazilion-home-'))
  writeFileSync(join(agentDir, 'IDENTITY.md'), '# IDENTITY\n\n- Name:\n', 'utf8')
  writeFileSync(join(agentDir, 'SOUL.md'), '# SOUL\n\nhelpful and honest.\n', 'utf8')
  writeFileSync(join(agentDir, 'BOOTSTRAP.md'), '# BOOTSTRAP\n\nfirst run.\n', 'utf8')
})
afterEach(() => rmSync(agentDir, { recursive: true, force: true }))

test('home_read returns the file contents', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  const out = await tools.invoke('home_read', JSON.stringify({ file: 'IDENTITY.md' }))
  expect(out).toContain('# IDENTITY')
})

test('home_read rejects files outside the whitelist', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  await expect(
    tools.invoke('home_read', JSON.stringify({ file: '../etc/passwd' })),
  ).rejects.toThrow(/must be one of/)
  await expect(
    tools.invoke('home_read', JSON.stringify({ file: 'memory/notes.md' })),
  ).rejects.toThrow(/must be one of/)
})

test.each([
  'HEARTBEAT.md',
  'AGENTS.md',
  'TOOLS.md',
])('home tools do not expose or edit a %s left from an older version', async (file) => {
  const legacy = '# legacy instructions\n'
  writeFileSync(join(agentDir, file), legacy, 'utf8')
  const tools = createToolRegistry(homeTools(agentDir))

  await expect(tools.invoke('home_read', JSON.stringify({ file }))).rejects.toThrow(
    /must be one of/,
  )
  await expect(
    tools.invoke('home_write', JSON.stringify({ file, content: '# replacement\n' })),
  ).rejects.toThrow(/must be one of/)
  expect(await tools.invoke('home_list', '{}')).not.toContain(file)
  expect(readFileSync(join(agentDir, file), 'utf8')).toBe(legacy)
})

test('home_read surfaces a helpful error if the file is missing', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  // BOOTSTRAP.md is retired after the first conversation: reading it then is an error.
  rmSync(join(agentDir, 'BOOTSTRAP.md'))
  await expect(tools.invoke('home_read', JSON.stringify({ file: 'BOOTSTRAP.md' }))).rejects.toThrow(
    /could not read BOOTSTRAP\.md/,
  )
})

test('home_write replaces file contents and is readable back', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  const body = '# IDENTITY\n\n- Name: Molty\n- Emoji: 🦞\n'
  const w = await tools.invoke('home_write', JSON.stringify({ file: 'IDENTITY.md', content: body }))
  expect(w).toMatch(/wrote IDENTITY\.md/)
  expect(readFileSync(join(agentDir, 'IDENTITY.md'), 'utf8')).toBe(body)
  const r = await tools.invoke('home_read', JSON.stringify({ file: 'IDENTITY.md' }))
  expect(r).toBe(body)
})

test('home_edit changes one passage or adds to the end, and keeps the rest', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  const edit = (args: Record<string, string>) =>
    tools.invoke('home_edit', JSON.stringify({ file: 'SOUL.md', ...args }))
  await edit({ old_text: '', new_text: '## How you work\n\n- Answer in Italian.' })
  expect(readFileSync(join(agentDir, 'SOUL.md'), 'utf8')).toBe(
    '# SOUL\n\nhelpful and honest.\n\n## How you work\n\n- Answer in Italian.\n',
  )
  await edit({ old_text: '- Answer in Italian.', new_text: '- Answer in Italian.\n- Be brief.' })
  await edit({ old_text: '- Answer in Italian.\n', new_text: '' })
  expect(readFileSync(join(agentDir, 'SOUL.md'), 'utf8')).toBe(
    '# SOUL\n\nhelpful and honest.\n\n## How you work\n\n- Be brief.\n',
  )

  // A passage that is not there, or is there twice, changes nothing.
  await expect(edit({ old_text: 'Answer in French.', new_text: 'x' })).rejects.toThrow(
    /does not contain/,
  )
  await edit({ old_text: '', new_text: '- Be brief.' })
  const twice = readFileSync(join(agentDir, 'SOUL.md'), 'utf8')
  await expect(edit({ old_text: '- Be brief.', new_text: '' })).rejects.toThrow(/more than once/)
  expect(readFileSync(join(agentDir, 'SOUL.md'), 'utf8')).toBe(twice)
  await expect(
    tools.invoke(
      'home_edit',
      JSON.stringify({ file: 'BOOTSTRAP.md', old_text: 'first run.', new_text: '' }),
    ),
  ).rejects.toThrow(/must be one of/)
})

test('home_edit refuses a linked file', async () => {
  const outside = join(agentDir, '..', `outside-${Date.now()}.md`)
  writeFileSync(outside, 'outside\n')
  try {
    unlinkSync(join(agentDir, 'SOUL.md'))
    symlinkSync(outside, join(agentDir, 'SOUL.md'))
    const tools = createToolRegistry(homeTools(agentDir))
    await expect(
      tools.invoke(
        'home_edit',
        JSON.stringify({ file: 'SOUL.md', old_text: 'outside', new_text: 'changed' }),
      ),
    ).rejects.toThrow(/home_edit: could not read SOUL\.md/)
    expect(readFileSync(outside, 'utf8')).toBe('outside\n')
  } finally {
    rmSync(outside, { force: true })
  }
})

test('home_write refuses to touch BOOTSTRAP.md (lifecycle belongs to bootstrap_done)', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  await expect(
    tools.invoke('home_write', JSON.stringify({ file: 'BOOTSTRAP.md', content: 'nope' })),
  ).rejects.toThrow(/must be one of/)
  // Seeded BOOTSTRAP.md content is intact
  expect(readFileSync(join(agentDir, 'BOOTSTRAP.md'), 'utf8')).toContain('first run')
})

test('home_write rejects files outside the whitelist', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  await expect(
    tools.invoke(
      'home_write',
      JSON.stringify({ file: '../escape.md', content: 'should not leak' }),
    ),
  ).rejects.toThrow(/must be one of/)
})

test('home_list reports seeded files with byte sizes', async () => {
  const tools = createToolRegistry(homeTools(agentDir))
  const out = await tools.invoke('home_list', '{}')
  expect(out).toMatch(/IDENTITY\.md \(\d+b\)/)
  expect(out).toMatch(/SOUL\.md \(\d+b\)/)
  expect(out).toMatch(/BOOTSTRAP\.md \(\d+b\)/)
  // files we never created should not appear
  expect(out).not.toMatch(/AGENTS\.md/)
})

test('home tools are scoped to the provided agentDir — sibling agents do not collide', async () => {
  const other = mkdtempSync(join(tmpdir(), 'bazilion-home-other-'))
  try {
    writeFileSync(join(other, 'IDENTITY.md'), 'sibling original\n', 'utf8')

    const a = createToolRegistry(homeTools(agentDir))
    const b = createToolRegistry(homeTools(other))

    await a.invoke(
      'home_write',
      JSON.stringify({ file: 'IDENTITY.md', content: 'agent-a writes its own\n' }),
    )

    expect(readFileSync(join(agentDir, 'IDENTITY.md'), 'utf8')).toBe('agent-a writes its own\n')
    expect(readFileSync(join(other, 'IDENTITY.md'), 'utf8')).toBe('sibling original\n')

    const bRead = await b.invoke('home_read', JSON.stringify({ file: 'IDENTITY.md' }))
    expect(bRead).toBe('sibling original\n')
  } finally {
    rmSync(other, { recursive: true, force: true })
  }
})

test('home tools never follow fixed-name symbolic links', async () => {
  const secretPath = join(agentDir, 'outside-secret')
  writeFileSync(secretPath, 'BOOTSTRAP_TOKEN_SENTINEL', 'utf8')
  unlinkSync(join(agentDir, 'IDENTITY.md'))
  symlinkSync(secretPath, join(agentDir, 'IDENTITY.md'))
  const tools = createToolRegistry(homeTools(agentDir))

  await expect(tools.invoke('home_read', JSON.stringify({ file: 'IDENTITY.md' }))).rejects.toThrow(
    /symbolic links are not allowed/,
  )
  await expect(
    tools.invoke('home_write', JSON.stringify({ file: 'IDENTITY.md', content: 'overwrite' })),
  ).rejects.toThrow(/symbolic links are not allowed/)
  expect(await tools.invoke('home_list', '{}')).not.toContain('IDENTITY.md')
  expect(readFileSync(secretPath, 'utf8')).toBe('BOOTSTRAP_TOKEN_SENTINEL')
})
