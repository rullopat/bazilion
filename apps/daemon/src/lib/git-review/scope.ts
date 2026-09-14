/**
 * What may be captured from a Team tree.
 *
 * Two separate decisions, deliberately not one name blocklist:
 *
 * 1. **Bazilion-owned state.** The Team-shared memory store is Bazilion's own private data, not the
 *    project's source. Only `memory/` at the Team root is excluded — *not* any directory that merely
 *    happens to be called `memory`, `dist`, `build` or similar, because hiding legitimate source on
 *    a name match is exactly the failure this rules against.
 * 2. **Credential-shaped paths.** These are never captured automatically. Tracked entries may still
 *    appear in a change list (the change is real and the operator asked for the repository), but no
 *    content is attached; untracked credential-shaped names are withheld entirely and only counted.
 */

export type ScopeReason = 'bazilion_state' | 'credential_shaped'

export type ScopeDecision = { included: true } | { included: false; reason: ScopeReason }

/** Bazilion-owned paths inside a Team tree, relative to the Team root. */
const BAZILION_STATE_PREFIXES = ['memory/']

const CREDENTIAL_SEGMENTS = new Set(['.ssh', '.gnupg', '.aws', '.docker'])

const CREDENTIAL_BASENAME_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/,
  /^\.netrc$/,
  /^_netrc$/,
  /^\.npmrc$/,
  /^\.pgpass$/,
  /^\.git-credentials$/,
  /^credentials(\..*)?$/,
  /^secrets(\..*)?$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
]

const CREDENTIAL_EXTENSIONS: readonly string[] = [
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.kdbx',
  '.ppk',
  '.asc',
]

/** Decide whether one repository-relative path may be captured. */
export function reviewScope(path: string): ScopeDecision {
  // `path` comes from Git, which reports POSIX-style separators and no leading `./`.
  const segments = path.split('/')
  const basename = segments[segments.length - 1] ?? ''

  for (const prefix of BAZILION_STATE_PREFIXES) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) {
      return { included: false, reason: 'bazilion_state' }
    }
  }
  if (segments.some((segment) => CREDENTIAL_SEGMENTS.has(segment.toLowerCase()))) {
    return { included: false, reason: 'credential_shaped' }
  }
  const lower = basename.toLowerCase()
  if (CREDENTIAL_BASENAME_PATTERNS.some((pattern) => pattern.test(lower))) {
    return { included: false, reason: 'credential_shaped' }
  }
  if (CREDENTIAL_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return { included: false, reason: 'credential_shaped' }
  }
  return { included: true }
}
