import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export interface Paths {
  home: string
  db: string
  /**
   * Bootstrap auth file shared by the daemon and the CLI: `{token, remote?}`.
   * - `token` is the plaintext of the bootstrap web token. The daemon reads
   *   it once at startup to derive the encryption key for the `secrets`
   *   table (PBKDF2 over it) and to validate that it matches a row in
   *   `web_tokens` (so a corrupted file fails loudly). The CLI reads it as
   *   its loopback bearer.
   * - `remote` (set via `bazilion login`) is a CLI-only override pointing at
   *   a remote daemon. The local daemon ignores this field.
   *
   * One file replaces the previous `config.json` + `secrets.enc` split:
   * encrypted secrets and plaintext config now live as DB rows.
   */
  authFile: string
  profilesDir: string
  agentsDir: string
  skillsDir: string
  teamsDir: string
  logsDir: string
  profileDir(id: string): string
  agentDir(id: string): string
  skillDir(name: string): string
  teamDir(slug: string): string
}

export function resolvePaths(home?: string): Paths {
  const root = canonicalHome(
    resolve(home ?? process.env.BAZILION_HOME ?? join(homedir(), '.bazilion')),
  )
  return {
    home: root,
    db: join(root, 'bazilion.db'),
    authFile: join(root, 'auth.json'),
    profilesDir: join(root, 'profiles'),
    agentsDir: join(root, 'agents'),
    skillsDir: join(root, 'skills'),
    teamsDir: join(root, 'teams'),
    logsDir: join(root, 'logs'),
    profileDir(id) {
      return join(root, 'profiles', id)
    },
    agentDir(id) {
      return join(root, 'agents', id)
    },
    skillDir(name) {
      return join(root, 'skills', name)
    },
    teamDir(slug) {
      return join(root, 'teams', slug)
    },
  }
}

/**
 * Resolve the home root to its canonical realpath (following symlinks in every
 * existing segment; a not-yet-existing tail is kept). The daemon and the CLI
 * validate each other's absolute paths against their canonical form —
 * `realpathSync(dir) === dir` guards against symlink escapes — so a home
 * reached through a symlinked segment (macOS ships /tmp and /var as symlinks
 * to /private/…) would turn every derived path non-canonical and fail closed
 * on every worker spawn and session read (BAZ-049). Resolving once, here,
 * makes every derived path canonical for the process lifetime.
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
