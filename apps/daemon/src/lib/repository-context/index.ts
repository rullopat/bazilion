import type {
  RepositoryCommandCandidate,
  RepositoryContextIssue,
  RepositoryContextReport,
} from '@bazilion/api-types'
import { ContextDirectory, ContextReadError, hash, relativeParts } from './files.ts'
import { emptyGit, inspectGit } from './git.ts'

export const CONTEXT_LIMITS = {
  instructionFile: 64 * 1024,
  instructionTotal: 128 * 1024,
  depth: 16,
  sourceFile: 64 * 1024,
  sourceTotal: 256 * 1024,
  sourceCount: 32,
  candidates: 32,
  report: 256 * 1024,
} as const
const sourceNames = ['package.json', 'pnpm-workspace.yaml', 'README.md', 'CONTRIBUTING.md']
const discoveryExcluded = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next'])
const decode = (value: Buffer): string => new TextDecoder('utf-8', { fatal: true }).decode(value)

function issue(error: unknown, path?: string): RepositoryContextIssue {
  const code = error instanceof ContextReadError ? error.code : 'unreadable'
  return {
    code,
    ...(path ? { path } : {}),
    message: `Context unavailable: ${code.replaceAll('_', ' ')}.`,
  }
}

export interface ResolveRepositoryContextInput {
  teamId: string
  root: string
  target?: string
  /** Admission-bound identity for targeted worker refresh. */
  expectedRootIdentity?: string
  /** Actual daemon-owned Team memory path relative to its workspace. */
  memoryPath?: string
}

export async function resolveRepositoryContext(
  input: ResolveRepositoryContextInput,
): Promise<RepositoryContextReport> {
  const report: RepositoryContextReport = {
    version: 1,
    teamId: input.teamId,
    rootIdentity: null,
    target: '.',
    capturedAt: Date.now(),
    fingerprint: '',
    instructions: { state: 'complete', files: [], issues: [] },
    commands: { state: 'complete', sources: [], candidates: [], issues: [] },
    git: emptyGit(),
  }
  let root: ContextDirectory | undefined
  try {
    root = new ContextDirectory(input.root)
    report.rootIdentity = root.identity
    const parts = relativeParts(input.target ?? '.')
    report.target = parts.join('/') || '.'
    if (input.expectedRootIdentity && root.identity !== input.expectedRootIdentity)
      throw new ContextReadError('root_changed')
    const ancestry = [root]
    let current = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string
      const entry = current.entry(part)
      const last = i === parts.length - 1
      if (!entry && last) break // new file in an existing parent
      if (!entry || entry.isSymbolicLink()) throw new ContextReadError('unsafe_target')
      if (entry.isFile() && last) break
      if (!entry.isDirectory()) throw new ContextReadError('unsafe_target')
      if (ancestry.length > CONTEXT_LIMITS.depth) throw new ContextReadError('depth_limit')
      current = current.directory(part)
      ancestry.push(current)
    }
    let instructionBytes = 0
    let sourceBytes = 0
    let sourceCount = 0
    for (const directory of ancestry) {
      const path = directory.label === '.' ? 'AGENTS.md' : `${directory.label}/AGENTS.md`
      try {
        const bytes = directory.read('AGENTS.md', CONTEXT_LIMITS.instructionFile)
        if (bytes) {
          instructionBytes += bytes.length
          if (instructionBytes > CONTEXT_LIMITS.instructionTotal)
            throw new ContextReadError('instruction_total_limit')
          report.instructions.files.push({
            path,
            scope: directory.label,
            precedence: report.instructions.files.length,
            content: decode(bytes),
            sha256: hash(bytes),
          })
        }
      } catch (error) {
        report.instructions.state = 'incomplete'
        report.instructions.issues.push(issue(error, path))
      }
      const memory = input.memoryPath ?? 'memory'
      if (
        directory.label === memory ||
        directory.label.startsWith(`${memory}/`) ||
        directory.label.split('/').some((part) => discoveryExcluded.has(part))
      )
        continue
      for (const name of sourceNames) {
        const path = directory.label === '.' ? name : `${directory.label}/${name}`
        try {
          if (!directory.entry(name)) continue
          if (++sourceCount > CONTEXT_LIMITS.sourceCount)
            throw new ContextReadError('source_count_limit')
          const bytes = directory.read(name, CONTEXT_LIMITS.sourceFile)
          if (!bytes) throw new ContextReadError('source_changed')
          sourceBytes += bytes.length
          if (sourceBytes > CONTEXT_LIMITS.sourceTotal)
            throw new ContextReadError('source_total_limit')
          const sha256 = hash(bytes)
          report.commands.sources.push({ path, sha256 })
          const content = decode(bytes)
          const add = (
            candidate: Omit<RepositoryCommandCandidate, 'source' | 'sha256' | 'cwd'>,
          ): void => {
            if (report.commands.candidates.length >= CONTEXT_LIMITS.candidates)
              throw new ContextReadError('candidate_limit')
            if (candidate.command.length > 4096 || candidate.location.length > 4096)
              throw new ContextReadError('command_limit')
            report.commands.candidates.push({
              ...candidate,
              source: path,
              sha256,
              cwd: directory.label,
            })
          }
          if (name === 'package.json') {
            const manifest: unknown = JSON.parse(content)
            if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
              throw new ContextReadError('invalid_manifest')
            const pkg = manifest as { packageManager?: unknown; scripts?: unknown }
            const pm =
              typeof pkg.packageManager === 'string'
                ? /^(npm|pnpm|yarn)@/.exec(pkg.packageManager)?.[1]
                : null
            const packageManager = pm === 'npm' || pm === 'pnpm' || pm === 'yarn' ? pm : null
            if (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)) {
              for (const [name, value] of Object.entries(pkg.scripts)) {
                if (typeof value === 'string')
                  add({
                    kind: 'script',
                    location: `scripts.${name}`,
                    command: value,
                    packageManager,
                  })
              }
            }
          } else if (name.endsWith('.md')) {
            let shellFence = false
            for (const [index, line] of content.split('\n').entries()) {
              if (/^```(?:sh|shell|bash|console)\s*$/.test(line)) {
                shellFence = true
                continue
              }
              if (/^```/.test(line)) {
                shellFence = false
                continue
              }
              if (
                shellFence &&
                /^(?:\$ )?(?:npm|pnpm|yarn|node|make|cargo|go|bundle|ruby|python3?)\s/.test(line)
              ) {
                add({
                  kind: 'excerpt',
                  location: `line ${index + 1}`,
                  command: line.replace(/^\$ /, ''),
                  packageManager: null,
                })
              }
            }
          }
        } catch (error) {
          report.commands.state = 'incomplete'
          report.commands.issues.push(issue(error, path))
        }
      }
    }
    report.git = await inspectGit(ancestry)
    root.validate(true, new Set(['AGENTS.md']))
    try {
      root.validate(true, new Set(sourceNames))
    } catch (error) {
      report.commands = { state: 'incomplete', sources: [], candidates: [], issues: [issue(error)] }
    }
  } catch (error) {
    report.instructions.state = 'incomplete'
    report.instructions.files = []
    report.instructions.issues.push(issue(error))
    report.commands.state = 'incomplete'
    report.commands.sources = []
    report.commands.candidates = []
    report.commands.issues.push(issue(error))
    report.git = { ...emptyGit(), state: 'unavailable', issues: [issue(error)] }
  } finally {
    root?.close()
  }
  if (Buffer.byteLength(JSON.stringify(report)) > CONTEXT_LIMITS.report - 128) {
    report.instructions = {
      state: 'incomplete',
      files: [],
      issues: [issue(new ContextReadError('report_limit'))],
    }
    report.commands = {
      state: 'incomplete',
      sources: [],
      candidates: [],
      issues: [issue(new ContextReadError('report_limit'))],
    }
  }
  report.fingerprint = hash(JSON.stringify({ ...report, capturedAt: 0, fingerprint: '' }))
  return report
}

export function requireCompleteRepositoryContext(report: RepositoryContextReport): void {
  if (report.instructions.state !== 'complete') {
    throw new Error(
      `Repository instructions incomplete (${report.instructions.issues.map((i) => i.code).join(', ')}). Inspect Team repository context before coding.`,
    )
  }
}
