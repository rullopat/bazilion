import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export interface CliPaths {
  home: string
  authFile: string
}

export function resolveCliPaths(home?: string): CliPaths {
  // Canonicalize exactly like the daemon's resolvePaths (apps/daemon/src/core/paths.ts):
  // the two processes hand each other absolute paths and validate them against
  // their canonical form, so they must agree on one spelling of the home.
  const root = canonicalHome(resolve(home ?? process.env.BAZILION_HOME ?? join(homedir(), '.bazilion')))
  return { home: root, authFile: join(root, 'auth.json') }
}

/**
 * Resolve the home root to its canonical realpath (following symlinks in every
 * existing segment; a not-yet-existing tail is kept). Mirrors the daemon's
 * canonicalHome — keep the two in sync.
 */
function canonicalHome(root: string): string {
  let resolved = root
  const unresolvedTail: string[] = []
  while (true) {
    try {
      resolved = realpathSync(resolved)
      break
    } catch {
      const parent = dirname(resolved)
      if (parent === resolved) break // reached the filesystem root
      unresolvedTail.unshift(basename(resolved))
      resolved = parent
    }
  }
  return join(resolved, ...unresolvedTail)
}
