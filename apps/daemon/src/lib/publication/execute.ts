import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  claimPublication,
  getPublication,
  notePublicationError,
  type PublicationRecord,
  refusePublication,
  settlePublicationFailed,
  settlePublicationPublished,
} from '../../core/repos/publications.ts'
import { getReviewPacket } from '../../core/repos/review-packets.ts'
import { sendAgentMessage } from '../communication.ts'
import { resolvePublicationTarget } from './config.ts'
import { publishRevisionCommit } from './git-publish.ts'
import type { PublicationHostAdapter, PublicationHostTarget } from './host/adapter.ts'
import { createGitHubAdapter } from './host/github.ts'
import { createLocalAdapter } from './host/local.ts'
import { readReviewedRevisionFiles } from './revision-content.ts'

// BAZ-046: the publication operation itself.
//
// There is no worker, no tool and no model in this path, and that is the security property: a publication
// is deterministic, so the strongest guarantee available is that no Agent can be involved at all rather
// than that an Agent is refused a capability.
//
// The order is chosen so every refusal happens before anything is sent: configuration and content are
// checked, the head branch is checked against the remote before the commit is built, and the commit is
// pushed without force — the only failure mode that leaves something on the host is a push the host
// accepted, which is reported as published rather than undone.

export const PUBLICATION_LEASE_MS = 2 * 60 * 1000
export const PUBLICATION_OWNER = `publication-${process.pid}`

export type PublicationExecuteResult = 'published' | 'refused' | 'failed' | 'not_claimed'

export interface PublishOptions {
  /** Test seams, in the same spirit as the worker entry override: an adapter and a scratch root. */
  adapter?: PublicationHostAdapter
  scratchParentDir?: string
  leaseMs?: number
  now?: number
}

export async function executePublication(
  db: BazilionDb,
  paths: Paths,
  authToken: string,
  publicationId: string,
  opts: PublishOptions = {},
): Promise<PublicationExecuteResult> {
  const claimed = claimPublication(db, {
    id: publicationId,
    leaseOwner: PUBLICATION_OWNER,
    leaseMs: opts.leaseMs ?? PUBLICATION_LEASE_MS,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })
  if (!claimed) return 'not_claimed'

  const refuse = (reason: string, detail: string): 'refused' => {
    refusePublication(db, {
      id: claimed.id,
      reason: reason as Parameters<typeof refusePublication>[1]['reason'],
      detail: detail.slice(0, 400),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    })
    return 'refused'
  }

  const packet = getReviewPacket(db, claimed.packetId)
  if (!packet) return refuse('packet_unknown', 'the review packet is gone')

  const files = readReviewedRevisionFiles(db, paths, packet)
  if (!files.ok) return refuse(files.reason, files.detail)

  // The target always comes from configuration: where a publication goes is never a caller's decision.
  // `opts.adapter` replaces only the transport, so a test can observe the GitHub path without a network
  // while the repository, branch and credential are still the operator's.
  const resolved = resolvePublicationTarget(db, authToken)
  if (!resolved.ok) return refuse(resolved.reason, resolved.detail)

  const adapter = opts.adapter ?? adapterFor(resolved.target.host, resolved.target.credential)
  const hostTarget: PublicationHostTarget = {
    host: resolved.target.host,
    repository: resolved.target.repository,
    baseBranch: claimed.baseBranch,
    headBranch: claimed.headBranch,
    commitMessage: claimed.commitMessage,
    title: claimed.commitMessage,
    body: publicationBody(claimed, packet.summary),
  }
  const remote = adapter.remoteUrl(hostTarget)
  if (!remote.ok) return refuse(remote.reason, remote.detail)

  const pushed = await publishRevisionCommit({
    teamDir: paths.teamDir(claimed.teamId),
    baseOid: claimed.baseOid,
    headBranch: claimed.headBranch,
    commitMessage: claimed.commitMessage,
    files: files.files,
    removed: files.removed,
    remoteUrl: remote.url,
    credential: resolved.target.credential,
    ...(opts.scratchParentDir ? { scratchParentDir: opts.scratchParentDir } : {}),
  })
  if (!pushed.ok) {
    // Every git-side refusal happened before the push, so nothing reached the host.
    return refuse(pushed.reason, pushed.detail)
  }

  // The branch is on the host from here on. A pull request that could not be opened is recorded as a
  // published branch with a reason, never as a failed publication — the branch exists.
  const opened = await adapter.openPullRequest(hostTarget)
  const settled = settlePublicationPublished(db, {
    id: claimed.id,
    commitOid: pushed.commitOid,
    pullRequestNumber: opened.ok ? opened.outcome.pullRequestNumber : null,
    pullRequestUrl: opened.ok ? opened.outcome.pullRequestUrl : null,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })
  if (!opened.ok) {
    noteBranchWithoutPullRequest(db, settled, opened.detail)
  }
  notifyOutcome(db, settled, opened.ok ? null : opened.detail)
  return 'published'
}

function adapterFor(host: PublicationRecord['host'], credential: string): PublicationHostAdapter {
  return host === 'github'
    ? createGitHubAdapter({ credential })
    : createLocalAdapter({ credentialPresent: credential.length > 0 })
}

function publicationBody(publication: PublicationRecord, summary: string | null): string {
  return [
    `Reviewed revision ${publication.snapshotId.slice(0, 12)} (base ${publication.baseOid.slice(0, 12)}).`,
    summary ? `\n${summary}` : '',
    '',
    'Published by Bazilion from a reviewed packet. The commit is unsigned.',
    'Nothing was merged or deployed.',
  ]
    .join('\n')
    .trim()
}

/** Record that the branch is on the host but no pull request came back. */
function noteBranchWithoutPullRequest(
  db: BazilionDb,
  publication: PublicationRecord,
  detail: string,
): void {
  notePublicationError(
    db,
    publication.id,
    `the branch was published, but no pull request was opened: ${detail}`,
  )
}

/**
 * Tell the requesting Agent the outcome, and only the outcome.
 *
 * Branch, commit and pull request — never the credential, the remote URL or anything about the host's API.
 * Delivery is best-effort and never fails the publication: the record is the publication's evidence, and a
 * message is a courtesy on top of it.
 */
function notifyOutcome(
  db: BazilionDb,
  publication: PublicationRecord,
  detail: string | null,
): void {
  const to = publication.notifyAgentId
  if (!to) return
  const packet = getReviewPacket(db, publication.packetId)
  const from = packet?.reviewerAgentId
  if (!from) return
  // Branch, commit and pull request only. The repository is a locator rather than an outcome — for a
  // local host it is a host filesystem path — so it stays on the operator's report and out of a peer
  // message, exactly as the credential does.
  const lines = [
    `Publication of ${publication.packetId}: ${publication.state}.`,
    `branch ${publication.headBranch}`,
    publication.commitOid ? `commit ${publication.commitOid}` : '',
    publication.pullRequestUrl
      ? `pull request ${publication.pullRequestUrl}`
      : 'no pull request was opened',
    'The commit is unsigned, and nothing was merged or deployed.',
    detail ?? '',
  ].filter((line) => line.length > 0)
  try {
    sendAgentMessage(db, {
      from,
      to,
      payload: lines.join('\n'),
      origin: 'publication_result',
      attemptKind: 'publication_result',
      attemptId: publication.id,
    })
  } catch {
    // A denied or failed notification is not a failed publication.
  }
}

/** Settle a publication the daemon cannot finish. Used by recovery, never by the happy path. */
export function failPublication(db: BazilionDb, id: string, error: string): boolean {
  const existing = getPublication(db, id)
  if (!existing || existing.state !== 'publishing') return false
  settlePublicationFailed(db, { id, error: error.slice(0, 400) })
  return true
}
