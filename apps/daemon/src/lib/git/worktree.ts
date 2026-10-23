import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContextDirectory, ContextReadError } from '../repository-context/files.ts'

const MAX_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 16_384
const MAX_DIRECTORIES = 256
const MAX_DEPTH = 16

/** Git operations supplied by the single hardened inspector, never a second executable path. */
export interface WorktreeInventory {
  trackedPaths(): Promise<string[]>
  ignoredPaths(paths: string[]): Promise<ReadonlySet<string>>
}

export interface PrivateWorktree {
  directory: ContextDirectory
  /** Revalidate the original observations, independently of reads against the private copy. */
  validate(): void
  close(): void
}

/**
 * Materialize a bounded inspection-only worktree. External Git sees only this private tree, never
 * source pathnames. The caller owns its scratch directory and removes it after closing the capture.
 * This is a guarded capture, not an atomic snapshot or containment of same-user host processes.
 */
export async function capturePrivateWorktree(
  root: ContextDirectory,
  destination: string,
  inventory: WorktreeInventory,
  checkBudget: () => void,
): Promise<PrivateWorktree> {
  // Separate observations prevent downstream source/snapshot reads from overwriting this capture's
  // freshness evidence. The registered root binding is checked through the original root as well.
  const source = new ContextDirectory(root.path)
  let directory: ContextDirectory | undefined
  try {
    if (source.identity !== root.identity) throw new ContextReadError('root_changed')
    const tracked = new Set(await inventory.trackedPaths())
    const ancestors = new Set<string>()
    for (const path of tracked) {
      // Git's NUL-delimited inventory may legitimately contain tabs/newlines. Unlike an HTTP
      // target, this is not presentation input; reject traversal/metadata components, not those
      // literal filename bytes. No inventory path is used to open a source file directly.
      const parts = path.split('/')
      if (parts.some((part) => !part || part === '.' || part === '..' || part === '.git'))
        throw new ContextReadError('unsupported_git_worktree')
      for (let i = 1; i < parts.length; i++) ancestors.add(parts.slice(0, i).join('/'))
    }
    mkdirSync(destination, { mode: 0o700 })
    let bytes = 0
    let entries = 0
    let directories = 0
    const copyFile = (from: ContextDirectory, name: string, to: string): void => {
      checkBudget()
      const before = from.entry(name)
      if (!before?.isFile() || before.nlink !== 1)
        throw new ContextReadError('unsupported_git_worktree')
      const content = from.read(name, MAX_BYTES - bytes)
      if (!content) throw new ContextReadError('source_changed')
      const entry = from.entry(name)
      if (!entry?.isFile()) throw new ContextReadError('source_changed')
      bytes += content.length
      // Preserve only Git's executable bit, never other source permissions or links.
      writeFileSync(to, content, { mode: entry.mode & 0o111 ? 0o700 : 0o600, flag: 'wx' })
      checkBudget()
    }
    const copy = async (
      from: ContextDirectory,
      to: string,
      prefix: string,
      depth: number,
    ): Promise<void> => {
      checkBudget()
      if (depth > MAX_DEPTH || ++directories > MAX_DIRECTORIES)
        throw new ContextReadError('git_worktree_limit')
      const names = from.list().filter((name) => prefix !== '' || name !== '.git')
      entries += names.length
      if (entries > MAX_ENTRIES) throw new ContextReadError('git_worktree_limit')
      // Git must see this directory's rules before deciding which children can be skipped.
      // Even an ignored .gitignore influences traversal, just as it does in the source tree.
      if (names.includes('.gitignore')) copyFile(from, '.gitignore', join(to, '.gitignore'))
      const candidates = names.map((name) => {
        const entry = from.entry(name)
        if (!entry) throw new ContextReadError('source_changed')
        const path = `${prefix}${name}`
        return { name, entry, path, query: entry.isDirectory() ? `${path}/` : path }
      })
      const ignored = await inventory.ignoredPaths(candidates.map(({ query }) => query))
      for (const { name, entry, path, query } of candidates) {
        checkBudget()
        if (ignored.has(query) && !tracked.has(path) && !ancestors.has(path)) continue
        if (name === '.git' || entry.isSymbolicLink())
          throw new ContextReadError('unsupported_git_worktree')
        if (entry.isDirectory()) {
          mkdirSync(join(to, name), { mode: 0o700 })
          await copy(from.directory(name), join(to, name), `${path}/`, depth + 1)
        } else if (name !== '.gitignore') {
          copyFile(from, name, join(to, name))
        }
      }
    }
    await copy(source, destination, '', 0)
    const validate = (): void => {
      root.validate()
      source.validate()
    }
    validate()
    checkBudget()
    directory = new ContextDirectory(destination)
    const captured = directory
    return {
      directory: captured,
      validate,
      close: () => {
        try {
          captured.close()
        } finally {
          source.close()
        }
      },
    }
  } catch (error) {
    try {
      directory?.close()
    } finally {
      source.close()
    }
    throw error
  }
}
