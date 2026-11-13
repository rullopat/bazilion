import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

interface CliPaths {
  home: string
  authFile: string
}

export function resolveCliPaths(home?: string): CliPaths {
  // The daemon's resolvePaths (apps/daemon/src/core/paths.ts) spells the home the same way.
  const root = canonicalPath(requestedHome(home))
  return { home: root, authFile: join(root, 'auth.json') }
}

/** The home as given (`--home`, BAZILION_HOME or ~/.bazilion), before symlinks are resolved. */
export function requestedHome(home?: string): string {
  return resolve(home ?? process.env.BAZILION_HOME ?? join(homedir(), '.bazilion'))
}

/** Absolute path with symlinks resolved in every existing segment; a missing tail is kept. */
export function canonicalPath(path: string): string {
  let resolved = resolve(path)
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
