import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { ContextDirectory } from '../../src/lib/repository-context/files.ts'
import {
  CONTEXT_LIMITS,
  requireCompleteRepositoryContext,
  resolveRepositoryContext,
} from '../../src/lib/repository-context/index.ts'

let parent: string
let root: string
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'bazilion-context-test-'))
  root = join(parent, 'repo')
  mkdirSync(root)
})
afterEach(() => rmSync(parent, { recursive: true, force: true }))
const inspect = (target = '.') => resolveRepositoryContext({ teamId: 'sample', root, target })
function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: parent,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}
function repo(): void {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'code.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'initial')
}

test('plain folders have complete empty instructions and no Git repository', async () => {
  const report = await inspect()
  expect(report.instructions).toEqual({ state: 'complete', files: [], issues: [] })
  expect(report.git.state).toBe('not_repository')
  expect(report.rootIdentity).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(report)).not.toContain(root)
  expect(() => requireCompleteRepositoryContext(report)).not.toThrow()
})

test('root and targeted ancestry preserve exact bytes and exclude siblings and ancestors', async () => {
  writeFileSync(join(parent, 'AGENTS.md'), 'outside')
  writeFileSync(join(root, 'AGENTS.md'), 'root guidance\n')
  mkdirSync(join(root, 'app'))
  mkdirSync(join(root, 'sibling'))
  writeFileSync(join(root, 'app', 'AGENTS.md'), 'nested override\n')
  writeFileSync(join(root, 'sibling', 'AGENTS.md'), 'sibling')
  const report = await inspect('app/new.ts')
  expect(report.instructions.files.map((f) => [f.scope, f.content, f.precedence])).toEqual([
    ['.', 'root guidance\n', 0],
    ['app', 'nested override\n', 1],
  ])
  expect((await inspect()).instructions.files).toHaveLength(1)
  expect(JSON.stringify(report)).not.toContain('outside')
  expect(JSON.stringify(report)).not.toContain('sibling')
})

test.each([
  '../secret',
  '/tmp',
  'app/../../secret',
  'app\\file',
  '.git/HEAD',
  'bad\0name',
])('rejects unsafe target %s', async (target) => {
  const report = await inspect(target)
  expect(report.instructions.state).toBe('incomplete')
  expect(() => requireCompleteRepositoryContext(report)).toThrow('instructions incomplete')
})

test('supports the registered root symlink but refuses nested directory and instruction links', async () => {
  const slot = join(parent, 'slot')
  symlinkSync(root, slot)
  writeFileSync(join(root, 'AGENTS.md'), 'contained')
  expect(
    (await resolveRepositoryContext({ teamId: 'sample', root: slot })).instructions.state,
  ).toBe('complete')
  symlinkSync(parent, join(root, 'escape'))
  expect((await inspect('escape/new.ts')).instructions.state).toBe('incomplete')
  unlinkSync(join(root, 'AGENTS.md'))
  writeFileSync(join(parent, 'outside.md'), 'private')
  symlinkSync(join(parent, 'outside.md'), join(root, 'AGENTS.md'))
  const report = await inspect()
  expect(report.instructions.state).toBe('incomplete')
  expect(JSON.stringify(report)).not.toContain('private')
})

test('rejects FIFO instruction files without blocking', async () => {
  execFileSync('mkfifo', [join(root, 'AGENTS.md')])
  expect((await inspect()).instructions.issues[0]?.code).toBe('unsafe_file')
})

test('fingerprints change on refresh and admission-bound roots cannot be retargeted', async () => {
  writeFileSync(join(root, 'AGENTS.md'), 'first')
  const before = await inspect()
  writeFileSync(join(root, 'AGENTS.md'), 'second')
  const after = await inspect()
  expect(after.fingerprint).not.toBe(before.fingerprint)
  expect(after.instructions.files[0]?.content).toBe('second')
  renameSync(root, `${root}-old`)
  mkdirSync(root)
  const changed = await resolveRepositoryContext({
    teamId: 'sample',
    root,
    expectedRootIdentity: before.rootIdentity ?? 'missing',
  })
  expect(changed.instructions.issues[0]?.code).toBe('root_changed')
})

test('pinned descriptors reject ancestry replacement and observed source changes', () => {
  mkdirSync(join(root, 'app'))
  const pinned = new ContextDirectory(root)
  try {
    const app = pinned.directory('app')
    expect(app.read('AGENTS.md', 100)).toBeNull()
    writeFileSync(join(root, 'app', 'AGENTS.md'), 'new')
    expect(() => pinned.validate()).toThrow('source_changed')
    renameSync(join(root, 'app'), join(root, 'old'))
    symlinkSync(parent, join(root, 'app'))
    expect(() => pinned.validate()).toThrow('root_changed')
    expect(app.read('AGENTS.md', 100)?.toString()).toBe('new')
  } finally {
    pinned.close()
  }
})

test('instruction limits fail explicitly without injecting truncated content', async () => {
  writeFileSync(join(root, 'AGENTS.md'), 'x'.repeat(CONTEXT_LIMITS.instructionFile + 1))
  const report = await inspect()
  expect(report.instructions.state).toBe('incomplete')
  expect(report.instructions.files).toEqual([])
  expect(report.instructions.issues[0]?.code).toBe('byte_limit')
})

test('command discovery is passive, bounded and keeps provenance and ambiguity', async () => {
  const packageText = JSON.stringify({
    scripts: { test: 'touch EXECUTED', build: 'node build.js' },
  })
  writeFileSync(join(root, 'package.json'), packageText)
  writeFileSync(join(root, 'README.md'), '```sh\npnpm test\n```\n')
  const report = await inspect()
  expect(report.commands.candidates.map((c) => c.command)).toEqual([
    'touch EXECUTED',
    'node build.js',
    'pnpm test',
  ])
  expect(report.commands.candidates[0]).toMatchObject({
    cwd: '.',
    source: 'package.json',
    location: 'scripts.test',
    packageManager: null,
  })
  expect(report.commands.sources[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(existsSync(join(root, 'EXECUTED'))).toBe(false)
  expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageText)
  writeFileSync(join(root, 'package.json'), '{malformed')
  expect((await inspect()).commands.state).toBe('incomplete')
  expect((await inspect()).instructions.state).toBe('complete')
})

test('excluded command folders still honor applicable instructions', async () => {
  mkdirSync(join(root, 'dist'))
  writeFileSync(join(root, 'dist', 'AGENTS.md'), 'scoped')
  writeFileSync(join(root, 'dist', 'package.json'), '{malformed')
  const report = await inspect('dist')
  expect(report.instructions.files[0]?.content).toBe('scoped')
  expect(report.commands.state).toBe('complete')
})

test('reports staged, unstaged and untracked counts without mutating the original index', async () => {
  repo()
  writeFileSync(join(root, 'code.txt'), 'two\n')
  git('add', 'code.txt')
  writeFileSync(join(root, 'code.txt'), 'three\n')
  writeFileSync(join(root, 'new.txt'), 'new\n')
  const before = readFileSync(join(root, '.git', 'index'))
  const report = await inspect()
  expect(report.git).toMatchObject({
    state: 'available',
    branch: 'main',
    head: git('rev-parse', 'HEAD'),
    headState: 'branch',
    staged: 1,
    unstaged: 1,
    untracked: 1,
    conflicted: 0,
  })
  expect(readFileSync(join(root, '.git', 'index'))).toEqual(before)
})

test('unborn and detached heads are distinguished', async () => {
  git('init', '-q', '-b', 'main')
  expect((await inspect()).git).toMatchObject({
    state: 'available',
    headState: 'unborn',
    branch: 'main',
    head: null,
  })
  writeFileSync(join(root, 'x'), 'x')
  git('add', '.')
  git('commit', '-qm', 'initial')
  git('checkout', '--detach', '-q')
  expect((await inspect()).git).toMatchObject({
    state: 'available',
    headState: 'detached',
    branch: null,
  })
})

test('repository config and executable helpers never enter Git inspection', async () => {
  repo()
  const marker = join(parent, 'HELPER_EXECUTED')
  const helper = join(parent, 'helper')
  writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 })
  git('config', 'core.fsmonitor', helper)
  git('config', 'diff.external', helper)
  writeFileSync(join(root, '.gitattributes'), '* filter=evil diff=evil\n')
  writeFileSync(join(root, 'code.txt'), 'changed')
  expect((await inspect()).git.state).toBe('available')
  expect(existsSync(marker)).toBe(false)
})

test('ancestor repositories and linked metadata are unavailable without leaking instructions', async () => {
  repo()
  const folder = join(root, 'folder')
  mkdirSync(folder)
  expect((await resolveRepositoryContext({ teamId: 'subfolder', root: folder })).git.state).toBe(
    'not_repository',
  )
  writeFileSync(join(folder, '.git'), `gitdir: ${join(root, '.git')}\n`)
  expect((await resolveRepositoryContext({ teamId: 'subfolder', root: folder })).git.state).toBe(
    'unavailable',
  )
})

test('external object links and alternates are rejected', async () => {
  repo()
  writeFileSync(join(root, '.git', 'objects', 'info', 'alternates'), '/private/objects\n')
  expect((await inspect()).git.state).toBe('unavailable')
  unlinkSync(join(root, '.git', 'objects', 'info', 'alternates'))
  symlinkSync(parent, join(root, '.git', 'objects', 'escape'))
  expect((await inspect()).git.state).toBe('unavailable')
})

test('the actual Bazilion instructions fit the configured bound', async () => {
  copyFileSync(resolve('AGENTS.md'), join(root, 'AGENTS.md'))
  const report = await inspect()
  expect(report.instructions.state).toBe('complete')
  expect(report.instructions.files[0]?.content).toBe(readFileSync(resolve('AGENTS.md'), 'utf8'))
})

test('safe local filemode and excludes preserve ordinary Git status semantics', async () => {
  repo()
  git('config', 'core.filemode', 'false')
  const { chmodSync } = await import('node:fs')
  chmodSync(join(root, 'code.txt'), 0o755)
  writeFileSync(join(root, '.git', 'info', 'exclude'), 'local-ignored\n')
  writeFileSync(join(root, 'local-ignored'), 'local data')
  expect(git('status', '--porcelain')).toBe('')
  expect((await inspect()).git).toMatchObject({
    state: 'available',
    staged: 0,
    unstaged: 0,
    untracked: 0,
  })
})

test.each([
  'include.path',
  'filter.external.clean',
  'core.excludesFile',
])('unsupported configuration %s is explicit, never executed or followed', async (key) => {
  repo()
  git('config', key, '/private/unavailable')
  const report = await inspect()
  expect(report.instructions.state).toBe('complete')
  expect(report.git.state).toBe('unavailable')
  expect(report.git.issues[0]?.code).toBe('unsupported_git_configuration')
})

test('conflicted paths are counted separately', async () => {
  repo()
  git('checkout', '-qb', 'side')
  writeFileSync(join(root, 'code.txt'), 'side\n')
  git('commit', '-qam', 'side')
  git('checkout', '-q', 'main')
  writeFileSync(join(root, 'code.txt'), 'main\n')
  git('commit', '-qam', 'main')
  expect(() => git('merge', 'side')).toThrow()
  expect((await inspect()).git).toMatchObject({ state: 'available', conflicted: 1 })
})

test('aggregate and depth bounds report incomplete instruction context', async () => {
  let directory = root
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(directory, 'AGENTS.md'), 'x'.repeat(48 * 1024))
    mkdirSync(join(directory, 'nested'))
    directory = join(directory, 'nested')
  }
  const aggregate = await inspect('nested/nested')
  expect(aggregate.instructions.state).toBe('incomplete')
  expect(
    aggregate.instructions.issues.some((issue) => issue.code === 'instruction_total_limit'),
  ).toBe(true)
  expect((await inspect(Array(18).fill('nested').join('/'))).instructions.issues[0]?.code).toBe(
    'depth_limit',
  )
})

test('source, candidate and serialized report limits stay explicit', async () => {
  writeFileSync(join(root, 'README.md'), 'x'.repeat(64 * 1024 + 1))
  const source = await inspect()
  expect(source.commands.state).toBe('incomplete')
  expect(source.instructions.state).toBe('complete')
  unlinkSync(join(root, 'README.md'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      scripts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`check${i}`, 'echo safe'])),
    }),
  )
  const candidates = await inspect()
  expect(candidates.commands.candidates).toHaveLength(32)
  expect(candidates.commands.issues[0]?.code).toBe('candidate_limit')
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'AGENTS.md'), '\\'.repeat(64 * 1024))
  writeFileSync(join(root, 'nested', 'AGENTS.md'), '\\'.repeat(64 * 1024))
  const limited = await inspect('nested')
  expect(limited.instructions.issues[0]?.code).toBe('report_limit')
  expect(limited.instructions.files).toEqual([])
  expect(Buffer.byteLength(JSON.stringify(limited))).toBeLessThan(256 * 1024)
})

test('oversized Git metadata does not prevent complete repository instructions', async () => {
  repo()
  const { truncateSync } = await import('node:fs')
  writeFileSync(join(root, '.git', 'objects', 'too-large'), '')
  truncateSync(join(root, '.git', 'objects', 'too-large'), 64 * 1024 * 1024 + 1)
  const report = await inspect()
  expect(report.git.state).toBe('unavailable')
  expect(report.instructions.state).toBe('complete')
})

test('command-source edits during capture do not invalidate unchanged instructions', async () => {
  writeFileSync(join(root, 'AGENTS.md'), 'stable guidance')
  writeFileSync(join(root, 'package.json'), '{"scripts":{"test":"first"}}')
  const pending = inspect()
  writeFileSync(join(root, 'package.json'), '{"scripts":{"test":"second"}}')
  const report = await pending
  expect(report.instructions.state).toBe('complete')
  expect(report.commands.state).toBe('incomplete')
  expect(report.commands.candidates).toEqual([])
})

test('instruction edits and root retargeting during capture are rejected before use', async () => {
  writeFileSync(join(root, 'AGENTS.md'), 'first')
  const pending = inspect()
  writeFileSync(join(root, 'AGENTS.md'), 'changed instructions')
  expect((await pending).instructions.state).toBe('incomplete')
  const slot = join(parent, 'slot')
  symlinkSync(root, slot)
  const next = resolveRepositoryContext({ teamId: 'sample', root: slot })
  unlinkSync(slot)
  symlinkSync(parent, slot)
  const report = await next
  expect(report.instructions.state).toBe('incomplete')
  expect(report.instructions.files).toEqual([])
  expect(report.instructions.issues[0]?.code).toBe('root_changed')
})

test('source-count and aggregate source-byte limits are independent of instruction completeness', async () => {
  let directory = root
  const target: string[] = []
  for (let i = 0; i < 9; i++) {
    for (const name of ['package.json', 'pnpm-workspace.yaml', 'README.md', 'CONTRIBUTING.md'])
      writeFileSync(join(directory, name), name === 'package.json' ? '{}' : '# source')
    mkdirSync(join(directory, 'child'))
    directory = join(directory, 'child')
    target.push('child')
  }
  let report = await inspect(target.join('/'))
  expect(report.instructions.state).toBe('complete')
  expect(report.commands.sources).toHaveLength(32)
  expect(report.commands.issues.some((issue) => issue.code === 'source_count_limit')).toBe(true)
  directory = root
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(directory, 'README.md'), 'x'.repeat(60 * 1024))
    directory = join(directory, 'child')
  }
  report = await inspect(target.slice(0, 5).join('/'))
  expect(report.commands.issues.some((issue) => issue.code === 'source_total_limit')).toBe(true)
  expect(report.instructions.state).toBe('complete')
})

test('malformed UTF-8 instructions never silently substitute replacement bytes', async () => {
  writeFileSync(join(root, 'AGENTS.md'), Buffer.from([0xff, 0xfe]))
  const report = await inspect()
  expect(report.instructions.state).toBe('incomplete')
  expect(report.instructions.files).toEqual([])
})
