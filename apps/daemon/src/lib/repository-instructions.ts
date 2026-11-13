import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
  ContainedFileError,
  type ContainedFileRefusal,
  readContainedFile,
} from '../runtime/safe-files.ts'
import type { RepositoryInstructions } from '../runtime/worker/runtime.ts'

const MAX_FILE_BYTES = 128 * 1024

const SKIPPED: Record<ContainedFileRefusal, string> = {
  outside: 'it resolves outside the Team workspace',
  not_file: 'it is not a regular file',
  changed: 'it changed while it was being read',
  too_large: `it is larger than ${MAX_FILE_BYTES} bytes`,
}

/**
 * Read `AGENTS.md` in the Team root and in each directory down to `cwd` (relative to the root).
 * Only regular files whose real path stays inside the root are used, read through a pinned,
 * size-capped descriptor. A file that cannot be used is logged and skipped: repository
 * instructions never fail a turn.
 */
export function loadRepositoryInstructions(root: string, cwd = '.'): RepositoryInstructions {
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    return []
  }
  const parts = cwd.split('/').filter((part) => part !== '' && part !== '.')
  const instructions: Array<{ path: string; content: string }> = []
  for (let depth = 0; depth <= parts.length; depth++) {
    const path = [...parts.slice(0, depth), 'AGENTS.md'].join('/')
    try {
      const content = readContainedFile(join(realRoot, path), realRoot, MAX_FILE_BYTES)
      instructions.push({ path, content: content.toString('utf8') })
    } catch (error) {
      if (error instanceof ContainedFileError) {
        skip(path, SKIPPED[error.reason])
        continue
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') skip(path, code ?? 'it could not be read')
    }
  }
  return instructions
}

function skip(path: string, reason: string): void {
  console.warn(`[repository-instructions] skipped ${path}: ${reason}`)
}
