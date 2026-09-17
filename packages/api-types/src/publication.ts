// BAZ-046: publishing one reviewed revision to a code host.
//
// Publication is an operator decision about a specific revision, made after a review concluded about it.
// Nothing here is a workflow: a publication either published, was refused before anything left the
// machine, or ended in a state that says honestly what is and is not known.
//
// The types are deliberately small. There is no field for a remote URL, a credential, a force push, a
// merge or a deployment — a caller cannot ask for one because there is nowhere to put it.

/** The hosts this build can publish to. `local` exists so tests can use a real bare repository. */
export type PublicationHost = 'github' | 'local'

export type PublicationState =
  /** Decided, not yet attempted. */
  | 'pending'
  /** An attempt holds the lease. */
  | 'publishing'
  | 'published'
  /** Refused before anything was sent: no commit, no push, no pull request. */
  | 'refused'
  /** The attempt ended with a reason and nothing was published. */
  | 'failed'
  /**
   * Interrupted: whether the push landed is not known. Never replayed, because a second push could
   * duplicate work the host already accepted.
   */
  | 'uncertain'

/** Why a publication was refused. Each one means nothing was sent. */
export type PublicationRefusalReason =
  | 'packet_unknown'
  | 'packet_not_reviewed'
  | 'revision_unavailable'
  /** The working tree no longer matches the capture, so its content cannot be committed as reviewed. */
  | 'revision_not_reproducible'
  | 'host_not_configured'
  | 'origin_not_configured'
  | 'credential_missing'
  | 'branch_protected'
  | 'nothing_to_publish'
  | 'already_published'
  | 'missing_reviewer_conclusion'

export interface Publication {
  id: string
  teamId: string
  packetId: string
  snapshotId: string
  host: PublicationHost
  repository: string
  baseBranch: string
  headBranch: string
  baseOid: string
  commitMessage: string
  state: PublicationState
  /** Always false today, and stated rather than implied. */
  signed: boolean
  commitOid: string | null
  pullRequestNumber: number | null
  pullRequestUrl: string | null
  refusalReason: PublicationRefusalReason | null
  refusalDetail: string | null
  error: string | null
  createdAt: number
  finishedAt: number | null
}

/** What the operator may ask for. There is no branch to push to and no remote to choose. */
export interface PublicationRequest {
  packetId: string
  /** Branch to publish to. Defaults to `bazilion/<packet prefix>` when omitted. */
  headBranch?: string | null
  commitMessage?: string | null
}

/** Facts about a publication, kept separate from its state so a claim cannot borrow another's proof. */
export interface PublicationFacts {
  /** The reviewed revision's content was read, so the commit is the reviewed change. */
  contentFromReviewedRevision: boolean
  /** Nothing was sent. */
  nothingSent: boolean
  /** A pull request exists on the host and its URL was returned by that host. */
  pullRequestOpened: boolean
  /** The record says unsigned, and no signature is claimed anywhere. */
  unsigned: boolean
}

export interface PublicationReport {
  publication: Publication
  facts: PublicationFacts
  /** What the honest next step is, in the operator's own terms. */
  guidance: string
}

export interface PublicationListResponse {
  publications: Publication[]
}

export interface PublicationResponse {
  report: PublicationReport
}

export interface PublicationBlockedResponse {
  blocked: { reason: PublicationRefusalReason; detail: string }
}

export interface CreatePublicationRequest extends PublicationRequest {
  teamId: string
}

export const PUBLICATION_LIMITS = {
  repository: 200,
  branch: 200,
  commitMessage: 2000,
  refusalDetail: 400,
  error: 400,
  /** Branches that are never published to, whatever the host says. */
  protectedBranches: ['main', 'master', 'trunk', 'develop', 'release'],
} as const
