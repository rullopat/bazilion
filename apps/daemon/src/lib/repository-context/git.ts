import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RepositoryContextReport } from '@bazilion/api-types'
import { type ContextDirectory, ContextReadError } from './files.ts'

type GitReport = RepositoryContextReport['git']
export const emptyGit = (): GitReport => ({
  state: 'not_repository',
  root: null,
  branch: null,
  head: null,
  headState: null,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  issues: [],
})

/**
 * Git reads a bounded private copy of metadata with a Bazilion-authored config. No repository
 * config, hooks, alternates, includes, credential helpers, filters or external metadata links
 * enter it. The worktree remains read-only to this fixed status invocation. Scratch is discarded.
 */
export async function inspectGit(ancestry: ContextDirectory[]): Promise<GitReport> {
  const report = emptyGit()
  let scratch: string | undefined
  try {
    const root = [...ancestry].reverse().find((dir) => dir.entry('.git') !== null)
    if (!root) return report
    report.root = root.label
    report.state = 'unavailable'
    const marker = root.entry('.git')
    if (!marker?.isDirectory() || marker.isSymbolicLink())
      throw new ContextReadError('unsupported_git_metadata')
    const git = root.directory('.git')
    if (git.entry('commondir') || git.entry('gitdir')) {
      throw new ContextReadError('unsupported_git_metadata')
    }
    const info = git.entry('info')
    if (info) {
      const dir = git.directory('info')
      if (dir.entry('sparse-checkout')) throw new ContextReadError('unsupported_git_metadata')
    }
    const start = Date.now()
    let bytes = 0
    let count = 0
    scratch = mkdtempSync(join(tmpdir(), 'bazilion-context-git-'))
    const runGit = (args: string[]): Promise<string> =>
      new Promise((resolve, reject) => {
        execFile(
          'git',
          args,
          {
            cwd: scratch,
            env: {
              PATH: '/usr/bin:/bin',
              HOME: scratch,
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: '/dev/null',
              GIT_ATTR_NOSYSTEM: '1',
              GIT_TERMINAL_PROMPT: '0',
              GIT_NO_LAZY_FETCH: '1',
              GIT_OPTIONAL_LOCKS: '0',
              LC_ALL: 'C',
            },
            timeout: Math.max(1, 5000 - (Date.now() - start)),
            maxBuffer: 1024 * 1024,
            encoding: 'utf8',
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        )
      })
    // Let Git parse only a bounded captured config, without resolving includes. Carry only
    // non-executable index/worktree interpretation options into the neutral inspection config.
    const capturedConfig = git.read('config', 64 * 1024)
    const configLines = ['[core]', 'repositoryformatversion = 0', 'bare = false', 'filemode = true']
    if (capturedConfig) {
      bytes += capturedConfig.length
      count++
      const configPath = join(scratch, 'captured-config')
      writeFileSync(configPath, capturedConfig, { mode: 0o600 })
      const config = await runGit([
        'config',
        '--no-includes',
        '--file',
        configPath,
        '--null',
        '--list',
      ])
      for (const record of config.split('\0').filter(Boolean)) {
        const separator = record.indexOf('\n')
        const key = (separator < 0 ? record : record.slice(0, separator)).toLowerCase()
        const value = (separator < 0 ? 'true' : record.slice(separator + 1)).toLowerCase()
        if (
          key.startsWith('include.') ||
          key.startsWith('includeif.') ||
          key.startsWith('filter.') ||
          key === 'core.worktree' ||
          key === 'core.attributesfile' ||
          key === 'core.excludesfile' ||
          (key.startsWith('extensions.') && key !== 'extensions.objectformat')
        ) {
          throw new ContextReadError('unsupported_git_configuration')
        }
        if (
          [
            'core.filemode',
            'core.ignorecase',
            'core.symlinks',
            'core.precomposeunicode',
            'core.autocrlf',
          ].includes(key)
        ) {
          const allowed = key === 'core.autocrlf' ? ['true', 'false', 'input'] : ['true', 'false']
          const normalized = ['yes', 'on', '1', ''].includes(value)
            ? 'true'
            : ['no', 'off', '0'].includes(value)
              ? 'false'
              : value
          if (!allowed.includes(normalized))
            throw new ContextReadError('unsupported_git_configuration')
          configLines.push(`[core]\n${key.slice(5)} = ${normalized}`)
        }
        if (key === 'core.eol') {
          if (!['lf', 'crlf', 'native'].includes(value))
            throw new ContextReadError('unsupported_git_configuration')
          configLines.push(`[core]\neol = ${value}`)
        }
        if (key === 'extensions.objectformat') {
          if (!['sha1', 'sha256'].includes(value))
            throw new ContextReadError('unsupported_git_configuration')
          configLines.push(
            `[core]\nrepositoryformatversion = 1\n[extensions]\nobjectformat = ${value}`,
          )
        }
      }
    }
    if (info) {
      const exclude = git.directory('info').read('exclude', 64 * 1024)
      if (exclude) {
        bytes += exclude.length
        mkdirSync(join(scratch, 'info'), { mode: 0o700 })
        writeFileSync(join(scratch, 'info', 'exclude'), exclude, { mode: 0o600 })
      }
    }
    const copy = (source: ContextDirectory, destination: string, depth: number): void => {
      if (depth > 32) throw new ContextReadError('git_metadata_limit')
      for (const name of source.list()) {
        if (++count > 16_384 || Date.now() - start > 2500)
          throw new ContextReadError('git_metadata_limit')
        const entry = source.entry(name)
        if (!entry || entry.isSymbolicLink()) throw new ContextReadError('unsupported_git_metadata')
        if (name === 'alternates' || name === 'http-alternates')
          throw new ContextReadError('unsupported_git_metadata')
        if (entry.isDirectory()) {
          mkdirSync(join(destination, name), { mode: 0o700 })
          copy(source.directory(name), join(destination, name), depth + 1)
        } else {
          const content = source.read(name, 64 * 1024 * 1024 - bytes)
          if (!content) throw new ContextReadError('source_changed')
          bytes += content.length
          writeFileSync(join(destination, name), content, { mode: 0o600 })
        }
      }
    }
    for (const name of ['HEAD', 'index', 'packed-refs', 'shallow']) {
      const content = git.read(name, Math.min(16 * 1024 * 1024, 64 * 1024 * 1024 - bytes))
      if (content) {
        count++
        bytes += content.length
        writeFileSync(join(scratch, name), content, { mode: 0o600 })
      }
    }
    for (const name of ['refs', 'objects']) {
      mkdirSync(join(scratch, name), { mode: 0o700 })
      if (git.entry(name)) copy(git.directory(name), join(scratch, name), 0)
    }
    // Reject split-index layouts instead of following an un-captured shared index.
    if (git.list().some((name) => name.startsWith('sharedindex.')))
      throw new ContextReadError('unsupported_git_metadata')
    writeFileSync(join(scratch, 'config'), `${configLines.join('\n')}\n`, { mode: 0o600 })
    git.validate()
    const output = await runGit([
      '--no-optional-locks',
      `--git-dir=${scratch}`,
      `--work-tree=/proc/${process.pid}/fd/${root.fd}`,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.excludesFile=/dev/null',
      '-c',
      'diff.renames=false',
      '-c',
      'submodule.recurse=false',
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
      '--ignore-submodules=all',
      '-z',
    ])
    git.validate()
    const records = output.split('\0')
    for (let i = 0; i < records.length; i++) {
      const line = records[i] ?? ''
      if (line.startsWith('# branch.oid ')) {
        const oid = line.slice(13)
        report.head = /^[0-9a-f]{40,64}$/.test(oid) ? oid : null
      } else if (line.startsWith('# branch.head ')) {
        const branch = line.slice(14)
        if (branch.length > 4096) throw new ContextReadError('git_output_limit')
        report.branch = branch === '(detached)' ? null : branch
      } else if (line.startsWith('? ')) report.untracked++
      else if (line.startsWith('u ')) report.conflicted++
      else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        if (line[2] !== '.') report.staged++
        if (line[3] !== '.') report.unstaged++
        if (line.startsWith('2 ')) i++
      }
    }
    report.headState = report.head ? (report.branch ? 'branch' : 'detached') : 'unborn'
    report.state = 'available'
  } catch (error) {
    report.state = 'unavailable'
    const code =
      error instanceof ContextReadError
        ? error.code
        : (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'git_missing'
          : (error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? 'git_output_limit'
            : (error as { killed?: boolean }).killed ||
                (error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
              ? 'git_timeout'
              : 'git_inspection_failed'
    report.issues.push({
      code,
      message: `Git inspection is unavailable (${code.replaceAll('_', ' ')}); repository instructions are evaluated separately.`,
    })
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
  return report
}
