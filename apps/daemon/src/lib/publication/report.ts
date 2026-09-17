import type { PublicationFacts, PublicationReport } from '@bazilion/api-types'
import type { PublicationRecord } from '../../core/repos/publications.ts'

// BAZ-046: what a publication report claims, and what it refuses to claim.
//
// The facts are separate fields rather than adjectives on the state, because each one has a different
// basis: content came from the reviewed revision (verified by digest before the commit existed), nothing
// was sent (the refusal), a pull request exists (the host said so), and the commit is unsigned (the
// schema will not store anything else). A client that renders "published" as "done" is wrong, and the
// guidance says why in the operator's own terms.

export function buildPublicationReport(publication: PublicationRecord): PublicationReport {
  const facts: PublicationFacts = {
    // Any non-refused row got this far only after every path's digest matched the capture.
    contentFromReviewedRevision: publication.state !== 'refused',
    nothingSent: publication.state === 'refused',
    pullRequestOpened:
      publication.pullRequestUrl !== null && publication.pullRequestNumber !== null,
    unsigned: !publication.signed,
  }
  return { publication, facts, guidance: guidanceFor(publication) }
}

function guidanceFor(publication: PublicationRecord): string {
  switch (publication.state) {
    case 'pending':
      return 'Nothing has been sent. Publishing commits the reviewed revision to a new branch and opens a pull request; it never merges or deploys.'
    case 'publishing':
      return 'An attempt is in progress. Until it settles, whether the branch reached the host is unknown.'
    case 'published':
      return publication.pullRequestUrl
        ? 'The branch is on the host and a pull request is open. Nothing was merged and nothing was deployed; those stay yours to report.'
        : 'The branch is on the host, but no pull request came back. Nothing was merged and nothing was deployed.'
    case 'refused':
      return 'Nothing was sent: no commit, no push, no pull request. Fix the reason below and publish again; the review itself is unchanged.'
    case 'failed':
      return 'The attempt ended without publishing. Nothing is known to be on the host, but check before retrying if the failure happened late.'
    case 'uncertain':
      return 'Whether the branch reached the host is unknown, so this is never retried automatically. Check the host first: a branch that is already there will make a retry refuse.'
  }
}
