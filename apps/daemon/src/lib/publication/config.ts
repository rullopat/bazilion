import type { PublicationHost } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { openConfig } from '../../core/repos/config.ts'
import { openSecrets } from '../../core/repos/secrets.ts'

// BAZ-046: where a publication goes, and with what credential.
//
// Everything here is read-only and every answer is an observable fact: a host that is not configured is
// reported as not configured, never defaulted to GitHub because that is what the code happens to know.

/** Config keys the operator sets. Plaintext, because none of them is a secret. */
export const PUBLICATION_CONFIG = {
  host: 'PUBLICATION_HOST',
  repository: 'PUBLICATION_REPOSITORY',
  baseBranch: 'PUBLICATION_BASE_BRANCH',
} as const

/** The credential key per host. Read from the encrypted store, never from the environment. */
export const PUBLICATION_CREDENTIAL_KEY = 'GITHUB_TOKEN'

const HOSTS: readonly PublicationHost[] = ['github', 'local']

export interface PublicationTarget {
  host: PublicationHost
  repository: string
  baseBranch: string
  credential: string
}

export type PublicationTargetResult =
  | { ok: true; target: PublicationTarget }
  | { ok: false; reason: 'host_not_configured' | 'credential_missing'; detail: string }

/**
 * Resolve the configured target, or say precisely what is missing.
 *
 * The credential is resolved for the host that is actually configured, so a `local` target (tests, and a
 * local bare repository standing in for a host) does not require a GitHub token to exist.
 */
export function resolvePublicationTarget(
  db: BazilionDb,
  authToken: string,
): PublicationTargetResult {
  const config = openConfig(db)
  const configured = config.get(PUBLICATION_CONFIG.host)?.trim().toLowerCase() ?? ''
  if (!configured) {
    return {
      ok: false,
      reason: 'host_not_configured',
      detail: `no publication host is configured (set ${PUBLICATION_CONFIG.host}); nothing was sent`,
    }
  }
  if (!HOSTS.includes(configured as PublicationHost)) {
    return {
      ok: false,
      reason: 'host_not_configured',
      detail: `the configured publication host is not supported by this build: ${configured}`,
    }
  }
  const repository = config.get(PUBLICATION_CONFIG.repository)?.trim() ?? ''
  if (!repository) {
    return {
      ok: false,
      reason: 'host_not_configured',
      detail: `no repository is configured (set ${PUBLICATION_CONFIG.repository}); nothing was sent`,
    }
  }
  const baseBranch = config.get(PUBLICATION_CONFIG.baseBranch)?.trim() || 'main'
  const credential = openSecrets(db, authToken).get(PUBLICATION_CREDENTIAL_KEY)?.trim() ?? ''
  if (!credential) {
    return {
      ok: false,
      reason: 'credential_missing',
      detail: `no credential is stored for ${configured} (set ${PUBLICATION_CREDENTIAL_KEY}); nothing was sent`,
    }
  }
  return {
    ok: true,
    target: { host: configured as PublicationHost, repository, baseBranch, credential },
  }
}
