import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ContextDirectory, ContextReadError } from '../repository-context/files.ts'

// Hardened, read-only Git capture shared by repository context (BAZ-039) and Git change review
// (BAZ-042). There is deliberately ONE implementation of these protections.
//
// Git here reads a bounded private copy of metadata with a Bazilion-authored config. No repository
// config, hooks, alternates, includes, credential helpers, filters or external metadata links enter
// it. The worktree stays read-only and is reached through the caller's fd-pinned directory, never a
// path. Scratch is discarded by `cleanup()`.

/** Whole-inspection budget shared by capture and every subsequent read-only invocation. */
const INSPECTION_BUDGET_MS = 5000
/** Metadata copy sub-budget, so a huge tree cannot consume the whole inspection. */
const METADATA_BUDGET_MS = 2500
const METADATA_BYTES = 64 * 1024 * 1024
const METADATA_ENTRIES = 16_384
const METADATA_DEPTH = 32
const METADATA_READ = 64 * 1024
const METADATA_READ_LARGE = 16 * 1024 * 1024
const RUN_MAX_BUFFER = 1024 * 1024

/**
 * A captured repository whose metadata lives in private scratch. Callers may run further
 * **read-only** Git commands through `runGit` and must call `cleanup()` when finished.
 */
export interface CapturedGit {
  /** The fd-pinned worktree directory the capture was validated against. */
  root: ContextDirectory
  /**
   * Run one read-only Git command against the captured metadata. The private git-dir, the
   * fd-pinned worktree and every hardening flag are applied for you, so a caller cannot forget
   * them. Append further `-c` settings to override one of the defaults (later flags win).
   */
  runGit(args: string[]): Promise<string>
  /** Re-assert that the worktree and metadata still match the capture. */
  validate(): void
  /** Remove scratch. Safe to call more than once. */
  cleanup(): void
}

/** The furthest-ancestor directory containing `.git`, or null when this is not a repository. */
export function findRepositoryRoot(ancestry: ContextDirectory[]): ContextDirectory | null {
  return [...ancestry].reverse().find((dir) => dir.entry('.git') !== null) ?? null
}

/**
 * Capture a repository's Git metadata for read-only inspection.
 *
 * Throws `ContextReadError` for unsupported or unstable layouts; callers map that to their own
 * truthful unavailable state.
 */
export async function captureRepositoryGit(
  root: ContextDirectory,
  budgetMs: number = INSPECTION_BUDGET_MS,
): Promise<CapturedGit> {
  const start = Date.now()
  let bytes = 0
  let count = 0
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
  const scratch = mkdtempSync(join(tmpdir(), 'bazilion-context-git-'))
  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    rmSync(scratch, { recursive: true, force: true })
  }
  try {
    const rawGit = (args: string[]): Promise<string> =>
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
            timeout: Math.max(1, budgetMs - (Date.now() - start)),
            maxBuffer: RUN_MAX_BUFFER,
            encoding: 'utf8',
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        )
      })
    // Fixed read-only prefix: private metadata, the caller's fd-pinned worktree (never a path),
    // no optional locks, and no repository-configured executable behavior.
    const inspectionArgs = (args: string[]): string[] => [
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
      ...args,
    ]
    const runGit = (args: string[]): Promise<string> => rawGit(inspectionArgs(args))
    // Let Git parse only a bounded captured config, without resolving includes. Carry only
    // non-executable index/worktree interpretation options into the neutral inspection config.
    const capturedConfig = git.read('config', METADATA_READ)
    const configLines = ['[core]', 'repositoryformatversion = 0', 'bare = false', 'filemode = true']
    if (capturedConfig) {
      bytes += capturedConfig.length
      count++
      const configPath = join(scratch, 'captured-config')
      writeFileSync(configPath, capturedConfig, { mode: 0o600 })
      // Parsed before a git-dir exists, so this is a bare invocation, not an inspection one.
      const config = await rawGit([
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
      const exclude = git.directory('info').read('exclude', METADATA_READ)
      if (exclude) {
        bytes += exclude.length
        mkdirSync(join(scratch, 'info'), { mode: 0o700 })
        writeFileSync(join(scratch, 'info', 'exclude'), exclude, { mode: 0o600 })
      }
    }
    const copy = (source: ContextDirectory, destination: string, depth: number): void => {
      if (depth > METADATA_DEPTH) throw new ContextReadError('git_metadata_limit')
      for (const name of source.list()) {
        if (++count > METADATA_ENTRIES || Date.now() - start > METADATA_BUDGET_MS)
          throw new ContextReadError('git_metadata_limit')
        const entry = source.entry(name)
        if (!entry || entry.isSymbolicLink()) throw new ContextReadError('unsupported_git_metadata')
        if (name === 'alternates' || name === 'http-alternates')
          throw new ContextReadError('unsupported_git_metadata')
        if (entry.isDirectory()) {
          mkdirSync(join(destination, name), { mode: 0o700 })
          copy(source.directory(name), join(destination, name), depth + 1)
        } else {
          const content = source.read(name, METADATA_BYTES - bytes)
          if (!content) throw new ContextReadError('source_changed')
          bytes += content.length
          writeFileSync(join(destination, name), content, { mode: 0o600 })
        }
      }
    }
    for (const name of ['HEAD', 'index', 'packed-refs', 'shallow']) {
      const content = git.read(name, Math.min(METADATA_READ_LARGE, METADATA_BYTES - bytes))
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
    const validate = (): void => git.validate()
    validate()
    return { root, runGit, validate, cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}
