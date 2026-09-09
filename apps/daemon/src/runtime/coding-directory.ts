import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { ContextDirectory, relativeParts } from '../lib/repository-context/files.ts'

/** Require every cwd component to exist and be a real directory, including intermediate components. */
export function resolveCodingDirectory(
  root: string,
  cwd: string,
): { path: string; identity: string } {
  const directory = new ContextDirectory(root)
  try {
    let current = directory
    for (const part of relativeParts(cwd)) current = current.directory(part)
    const path = realpathSync(join(root, cwd))
    directory.validate()
    return { path, identity: current.identity }
  } finally {
    directory.close()
  }
}
