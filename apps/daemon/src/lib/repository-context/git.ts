import type { RepositoryContextReport } from '@bazilion/api-types'
import { type CapturedGit, captureRepositoryGit, findRepositoryRoot } from '../git/capture.ts'
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
 * Read repository status through the shared hardened capture (`lib/git/capture.ts`), which reads a
 * bounded private copy of metadata with a Bazilion-authored config. No repository config, hooks,
 * alternates, includes, credential helpers, filters or external metadata links enter it. The
 * worktree remains read-only to this fixed status invocation. Scratch is discarded.
 */
export async function inspectGit(ancestry: ContextDirectory[]): Promise<GitReport> {
  const report = emptyGit()
  let capture: CapturedGit | null = null
  try {
    const root = findRepositoryRoot(ancestry)
    if (!root) return report
    report.root = root.label
    report.state = 'unavailable'
    capture = await captureRepositoryGit(root)
    const output = await capture.runGit([
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
      '--ignore-submodules=all',
      '-z',
    ])
    capture.validate()
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
    capture?.cleanup()
  }
  return report
}
