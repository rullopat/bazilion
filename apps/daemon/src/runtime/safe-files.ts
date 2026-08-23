import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** Resolve a real directory and reject a symlink at the selected root itself. */
export function resolveRealDirectory(path: string): string {
  const requested = resolve(path)
  const entry = lstatSync(requested)
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error('expected a real directory')
  }
  return realpathSync(requested)
}

/**
 * Create or validate a direct/nested directory below a registered root.
 * The root itself may be a deliberate Team symlink; the selected directory
 * may not be a symlink and its canonical target must stay below that root.
 */
export function ensureContainedRealDirectory(
  path: string,
  root: string,
  options: { create?: boolean } = {},
): string {
  const requestedRoot = resolve(root)
  const requested = resolve(path)
  if (!isContained(requestedRoot, requested)) throw new Error('directory escapes its root')
  const canonicalRoot = realpathSync(requestedRoot)
  try {
    const entry = lstatSync(requested)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error('expected a real directory')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.create) throw error
    const canonicalParent = realpathSync(dirname(requested))
    if (!isContained(canonicalRoot, canonicalParent)) throw new Error('directory escapes its root')
    mkdirSync(requested, { recursive: true, mode: 0o700 })
    const entry = lstatSync(requested)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error('expected a real directory')
    }
  }
  const canonical = realpathSync(requested)
  if (!isContained(canonicalRoot, canonical)) throw new Error('directory escapes its root')
  return canonical
}

/** Read one regular file while refusing a final-component symbolic link. */
export function readRegularFileNoFollow(path: string): string {
  const entry = lstatSync(path)
  if (entry.isSymbolicLink()) throw new Error('symbolic links are not allowed')
  if (!entry.isFile()) throw new Error('target is not a regular file')
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | noFollowFlag())
    if (!fstatSync(fd).isFile()) throw new Error('target is not a regular file')
    return readFileSync(fd, 'utf8')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
