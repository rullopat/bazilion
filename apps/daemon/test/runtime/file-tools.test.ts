import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createSessionShellTools } from '../../src/runtime/shell/tooling.ts'
import { applyPatch, type PatchFiles } from '../../src/runtime/tools/apply-patch.ts'

const containerPrefix = `bazilion-${'1'.repeat(12)}-`
const toolContext = {
  sessionManager: {
    getSessionId: () => 'test-session',
    getSessionFile: () => '/tmp/test-session.jsonl',
    getCwd: () => '/workspace',
  },
} as never

let root: string
let workspace: string
let inputs: string
let outside: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-file-tools-')))
  workspace = join(root, 'team')
  inputs = join(root, 'agent', 'uploads')
  outside = join(root, 'outside')
  for (const dir of [workspace, join(workspace, 'memory'), inputs, outside]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(join(workspace, 'notes.txt'), 'first line\nsecond line\n')
  writeFileSync(join(workspace, 'memory', 'fact.md'), 'a fact\n')
  writeFileSync(join(inputs, 'upload.csv'), 'a,b\n')
  writeFileSync(join(outside, 'secret.txt'), 'host secret\n')
  symlinkSync(outside, join(workspace, 'escape'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function dockerTools(): Map<string, ToolDefinition> {
  const tools = createSessionShellTools(
    workspace,
    { BAZILION_BASH_SANDBOX: 'docker' },
    { containerPrefix, inputsDir: inputs },
  )
  return new Map(tools.fileTools.map((tool) => [tool.name, tool]))
}

async function run(tool: ToolDefinition | undefined, params: Record<string, unknown>) {
  if (!tool) throw new Error('no such tool')
  const result = await tool.execute('call', params as never, undefined, undefined, toolContext)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('\n')
}

test('Docker mode has the file tools on container paths, and apply_patch', () => {
  expect([...dockerTools().keys()].sort()).toEqual(
    ['apply_patch', 'edit', 'find', 'grep', 'ls', 'read', 'write'].sort(),
  )
  // On the host, Pi's own file tools stay, and apply_patch joins them.
  expect(createSessionShellTools(workspace, {}).fileTools.map((tool) => tool.name)).toEqual([
    'apply_patch',
  ])
})

test('read, write and edit work on /workspace and /inputs as commands see them', async () => {
  const tools = dockerTools()
  expect(await run(tools.get('read'), { path: 'notes.txt' })).toContain('second line')
  expect(await run(tools.get('read'), { path: '/inputs/upload.csv' })).toContain('a,b')
  await run(tools.get('write'), { path: '/workspace/new/deep/file.txt', content: 'made\n' })
  expect(readFileSync(join(workspace, 'new', 'deep', 'file.txt'), 'utf8')).toBe('made\n')
  await run(tools.get('edit'), {
    path: 'notes.txt',
    edits: [{ oldText: 'second line', newText: 'changed line' }],
  })
  expect(readFileSync(join(workspace, 'notes.txt'), 'utf8')).toBe('first line\nchanged line\n')
})

test('the file tools refuse read-only mounts, other paths and links that lead out', async () => {
  const tools = dockerTools()
  await expect(
    run(tools.get('write'), { path: '/workspace/memory/fact.md', content: 'x' }),
  ).rejects.toThrow(/read-only/)
  await expect(run(tools.get('write'), { path: '/inputs/new.txt', content: 'x' })).rejects.toThrow(
    /read-only/,
  )
  await expect(run(tools.get('read'), { path: '/etc/passwd' })).rejects.toThrow(
    /outside what the file tools can reach/,
  )
  await expect(run(tools.get('read'), { path: 'escape/secret.txt' })).rejects.toThrow(
    /leads outside/,
  )
  await expect(
    run(tools.get('write'), { path: 'escape/planted.txt', content: 'x' }),
  ).rejects.toThrow(/leads outside/)
  expect(existsSync(join(outside, 'planted.txt'))).toBe(false)
  // A link inside the workspace that leads into memory/ cannot be written through.
  symlinkSync(join(workspace, 'memory'), join(workspace, 'mem-link'))
  await expect(run(tools.get('write'), { path: 'mem-link/fact.md', content: 'x' })).rejects.toThrow(
    /read-only/,
  )
  expect(readFileSync(join(workspace, 'memory', 'fact.md'), 'utf8')).toBe('a fact\n')
})

test('grep, find and ls answer with container paths', async () => {
  const tools = dockerTools()
  const grep = await run(tools.get('grep'), { pattern: 'second', path: '/workspace' })
  expect(grep).toContain('notes.txt')
  expect(grep).not.toContain(root)
  const find = await run(tools.get('find'), { pattern: '*.md', path: '/workspace/memory' })
  expect(find).toContain('fact.md')
  expect(find).not.toContain(root)
  const ls = await run(tools.get('ls'), { path: '/workspace' })
  expect(ls).toContain('notes.txt')
  expect(ls).toContain('memory/')
  await expect(run(tools.get('grep'), { pattern: 'secret', path: 'escape' })).rejects.toThrow(
    /leads outside/,
  )
})

test('apply_patch in Docker mode adds, changes, moves and deletes, all or nothing', async () => {
  const tools = dockerTools()
  writeFileSync(join(workspace, 'gone.txt'), 'bye\n')
  const result = await run(tools.get('apply_patch'), {
    input: [
      '*** Begin Patch',
      '*** Add File: docs/new.md',
      '+# New',
      '*** Update File: notes.txt',
      '*** Move to: renamed.txt',
      ' first line',
      '-second line',
      '+second, patched',
      '*** Delete File: gone.txt',
      '*** End Patch',
    ].join('\n'),
  })
  expect(result).toContain('A docs/new.md')
  expect(readFileSync(join(workspace, 'docs', 'new.md'), 'utf8')).toBe('# New\n')
  expect(readFileSync(join(workspace, 'renamed.txt'), 'utf8')).toBe('first line\nsecond, patched\n')
  expect(existsSync(join(workspace, 'notes.txt'))).toBe(false)
  expect(existsSync(join(workspace, 'gone.txt'))).toBe(false)

  // A hunk that does not fit, after one that does: nothing is written.
  await expect(
    run(tools.get('apply_patch'), {
      input: [
        '*** Begin Patch',
        '*** Add File: should-not-exist.txt',
        '+x',
        '*** Update File: renamed.txt',
        '-no such line',
        '+y',
        '*** End Patch',
      ].join('\n'),
    }),
  ).rejects.toThrow(/hunk 1 does not match/)
  expect(existsSync(join(workspace, 'should-not-exist.txt'))).toBe(false)
  // Nor through a read-only mount.
  await expect(
    run(tools.get('apply_patch'), {
      input: '*** Begin Patch\n*** Delete File: /workspace/memory/fact.md\n*** End Patch',
    }),
  ).rejects.toThrow(/read-only/)
  expect(existsSync(join(workspace, 'memory', 'fact.md'))).toBe(true)
})

function memoryFiles(initial: Record<string, string>): PatchFiles & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial))
  return {
    files,
    resolve: (path) => path,
    exists: (path) => files.has(path),
    read: (path) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`missing ${path}`)
      return content
    },
    write: (path, content) => void files.set(path, content),
    remove: (path) => void files.delete(path),
  }
}

test('apply_patch places hunks by an anchor line and at the end of the file', () => {
  const store = memoryFiles({
    'a.ts': 'function one() {\n  return 1\n}\nfunction two() {\n  return 1\n}\n',
  })
  applyPatch(
    [
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@ function two() {',
      '-  return 1',
      '+  return 2',
      '@@',
      ' }',
      '+// end',
      '*** End of File',
      '*** End Patch',
    ].join('\n'),
    store,
  )
  expect(store.files.get('a.ts')).toBe(
    'function one() {\n  return 1\n}\nfunction two() {\n  return 2\n}\n// end\n',
  )
})

test('apply_patch matches lines whose spacing differs, and keeps a missing final newline', () => {
  const store = memoryFiles({ 'b.txt': 'alpha  \n  beta\ngamma' })
  applyPatch(
    '*** Begin Patch\n*** Update File: b.txt\n alpha\n-beta\n+BETA\n gamma\n*** End Patch',
    store,
  )
  expect(store.files.get('b.txt')).toBe('alpha  \nBETA\ngamma')
})

test.each([
  ['no Begin line', '*** Update File: a\n-x\n+y\n*** End Patch', /must start with/],
  ['an unknown operation', '*** Begin Patch\n*** Rename File: a\n*** End Patch', /expected/],
  [
    'an added file over an existing one',
    '*** Begin Patch\n*** Add File: a\n+x\n*** End Patch',
    /already exists/,
  ],
  [
    'a missing file',
    '*** Begin Patch\n*** Update File: nope\n-x\n+y\n*** End Patch',
    /does not exist/,
  ],
  ['a bad hunk line', '*** Begin Patch\n*** Update File: a\nx\n*** End Patch', /starts with/],
])('apply_patch refuses %s and writes nothing', (_name, input, message) => {
  const store = memoryFiles({ a: 'x\n' })
  expect(() => applyPatch(input, store)).toThrow(message)
  expect([...store.files.entries()]).toEqual([['a', 'x\n']])
})
