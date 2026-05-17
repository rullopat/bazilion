import { homedir } from 'node:os'
import { join } from 'node:path'

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
  groupsDir: string
  logsDir: string
  profileDir(id: string): string
  agentDir(id: string): string
  skillDir(name: string): string
  groupDir(slug: string): string
}

export function resolvePaths(home?: string): Paths {
  const root = home ?? process.env.BAZILION_HOME ?? join(homedir(), '.bazilion')
  return {
    home: root,
    db: join(root, 'bazilion.db'),
    authFile: join(root, 'auth.json'),
    profilesDir: join(root, 'profiles'),
    agentsDir: join(root, 'agents'),
    skillsDir: join(root, 'skills'),
    groupsDir: join(root, 'groups'),
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
    groupDir(slug) {
      return join(root, 'groups', slug)
    },
  }
}
