import type { RepositoryContextReport } from '@bazilion/api-types'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const keys = (
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
const string = (value: unknown, limit = 4096): value is string =>
  typeof value === 'string' && value.length <= limit
const digest = (value: unknown): boolean =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const count = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0
const list = (value: unknown, limit: number, check: (entry: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length <= limit && value.every(check)
const issue = (value: unknown): boolean =>
  object(value) &&
  keys(value, ['code', 'message'], ['path']) &&
  string(value.code, 100) &&
  string(value.message, 1024) &&
  (value.path === undefined || string(value.path))

/** Validate the bounded stdin/IPC report before it can become model instructions. */
export function assertRepositoryContext(
  value: unknown,
  teamId?: string,
): asserts value is RepositoryContextReport {
  if (
    !object(value) ||
    !keys(value, [
      'version',
      'teamId',
      'rootIdentity',
      'target',
      'capturedAt',
      'fingerprint',
      'instructions',
      'commands',
      'git',
    ]) ||
    value.version !== 1 ||
    !string(value.teamId, 256) ||
    (teamId !== undefined && value.teamId !== teamId) ||
    (value.rootIdentity !== null && !digest(value.rootIdentity)) ||
    !string(value.target) ||
    !count(value.capturedAt) ||
    !digest(value.fingerprint) ||
    !object(value.instructions) ||
    !object(value.commands) ||
    !object(value.git) ||
    Buffer.byteLength(JSON.stringify(value)) > 256 * 1024
  )
    throw new Error('Invalid repository context report')
  const instructions = value.instructions
  const commands = value.commands
  const git = value.git
  if (
    !keys(instructions, ['state', 'issues', 'files']) ||
    !keys(commands, ['state', 'issues', 'sources', 'candidates']) ||
    !keys(git, [
      'state',
      'root',
      'branch',
      'head',
      'headState',
      'staged',
      'unstaged',
      'untracked',
      'conflicted',
      'issues',
    ]) ||
    !['complete', 'incomplete'].includes(String(instructions.state)) ||
    !list(instructions.issues, 128, issue) ||
    !list(
      instructions.files,
      17,
      (file) =>
        object(file) &&
        keys(file, ['path', 'scope', 'precedence', 'sha256', 'content']) &&
        string(file.path) &&
        string(file.scope) &&
        count(file.precedence) &&
        digest(file.sha256) &&
        string(file.content, 64 * 1024) &&
        Buffer.byteLength(file.content) <= 64 * 1024,
    ) ||
    !['complete', 'incomplete'].includes(String(commands.state)) ||
    !list(commands.issues, 128, issue) ||
    !list(
      commands.sources,
      32,
      (source) =>
        object(source) &&
        keys(source, ['path', 'sha256']) &&
        string(source.path) &&
        digest(source.sha256),
    ) ||
    !list(
      commands.candidates,
      32,
      (candidate) =>
        object(candidate) &&
        keys(candidate, [
          'source',
          'sha256',
          'location',
          'cwd',
          'command',
          'kind',
          'packageManager',
        ]) &&
        string(candidate.source) &&
        digest(candidate.sha256) &&
        string(candidate.location) &&
        string(candidate.cwd) &&
        string(candidate.command) &&
        ['script', 'excerpt'].includes(String(candidate.kind)) &&
        [null, 'npm', 'pnpm', 'yarn'].includes(candidate.packageManager as string | null),
    ) ||
    !['available', 'unavailable', 'not_repository'].includes(String(git.state)) ||
    ![null, 'branch', 'detached', 'unborn'].includes(git.headState as string | null) ||
    ![git.root, git.branch, git.head].every((value) => value === null || string(value)) ||
    ![git.staged, git.unstaged, git.untracked, git.conflicted].every(count) ||
    !list(git.issues, 128, issue)
  )
    throw new Error('Invalid repository context report')
  const report = value as unknown as RepositoryContextReport
  if (
    report.instructions.files.reduce((bytes, file) => bytes + Buffer.byteLength(file.content), 0) >
      128 * 1024 ||
    (report.instructions.state === 'complete' &&
      (report.rootIdentity === null || report.instructions.issues.length > 0))
  )
    throw new Error('Invalid repository instruction completeness')
}
