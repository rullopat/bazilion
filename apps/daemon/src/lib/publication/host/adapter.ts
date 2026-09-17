import type { PublicationHost } from '@bazilion/api-types'

// BAZ-046: the code host, as a narrow interface.
//
// One operation: hand a branch to the host and say what the host answered. There is no merge, no review
// comment, no branch deletion and no settings call — a wider interface would promise hosts that do not
// exist yet, and this project's reviews keep finding that an interface with one implementation and no
// second caller is an unexercised seam.
//
// `local` is the second implementation, and it exists for a reason: it lets the push side of a publication
// be observed against a **real bare repository**, so the commit content and branch are real without a
// network or a credential.

/** Where the branch should go. The credential is not part of this: it belongs to the transport. */
export interface PublicationHostTarget {
  host: PublicationHost
  /** `owner/name` for GitHub; an absolute path for a local host. */
  repository: string
  baseBranch: string
  headBranch: string
  commitMessage: string
  /** The reviewed change, in the operator's words, for the host's own record. */
  title: string
  body: string
}

/** What the host answered. Absent means the host did not claim it, so it is not recorded. */
export interface PublicationHostOutcome {
  pullRequestNumber: number | null
  pullRequestUrl: string | null
}

export type PublicationHostResult =
  | { ok: true; outcome: PublicationHostOutcome }
  | {
      ok: false
      reason: 'origin_not_configured' | 'host_unavailable' | 'host_refused'
      detail: string
    }

/** Where a commit is pushed. A refusal here means nothing was sent anywhere. */
export type PublicationRemoteResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'origin_not_configured'; detail: string }

export interface PublicationHostAdapter {
  /**
   * The remote the commit is pushed to, or a refusal.
   *
   * A URL is derived from configuration, never from the repository's `origin`: a project's own remote is
   * the operator's business, and publishing to it because it happened to be there is exactly what must not
   * happen.
   */
  remoteUrl(target: PublicationHostTarget): PublicationRemoteResult
  /** Open the pull request, if this host has them. */
  openPullRequest(target: PublicationHostTarget): Promise<PublicationHostResult>
}
