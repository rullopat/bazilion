import type {
  PublicationHostAdapter,
  PublicationHostResult,
  PublicationHostTarget,
  PublicationRemoteResult,
} from './adapter.ts'

// BAZ-046: a local host, for observation rather than convenience.
//
// The point of this adapter is that a publication can be exercised against a **real bare repository**: the
// commit, the branch and the ref are genuine Git objects on disk, checked with `git` itself, with no
// network and no credential. What it cannot do is open a pull request, and it says so instead of inventing
// a URL — "a pull request exists" is a claim about a host, and this host has none.

export function createLocalAdapter(input: { credentialPresent: boolean }): PublicationHostAdapter {
  return {
    remoteUrl(target: PublicationHostTarget): PublicationRemoteResult {
      if (!target.repository.startsWith('/')) {
        return {
          ok: false,
          reason: 'origin_not_configured',
          detail: `a local publication needs an absolute repository path, got: ${target.repository}`,
        }
      }
      // A file remote and a stored credential: the credential exists so the fail-closed rule is uniform,
      // and it is deliberately not injected into a transport that cannot use it.
      void input.credentialPresent
      return { ok: true, url: target.repository }
    },

    async openPullRequest(): Promise<PublicationHostResult> {
      return {
        ok: true,
        outcome: { pullRequestNumber: null, pullRequestUrl: null },
      }
    },
  }
}
