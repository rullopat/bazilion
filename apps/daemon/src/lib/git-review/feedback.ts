import type {
  PinnedBase,
  ReviewChange,
  ReviewFeedbackRequest,
  ReviewFeedbackResponse,
} from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { DomainError } from '../../core/errors.ts'
import type { Paths } from '../../core/paths.ts'
import * as agentRepo from '../../core/repos/agents.ts'
import { enqueueUserInput } from '../user-queue.ts'
import { attachPatches, listChanges } from './changes.ts'
import { readRepositoryIdentity, resolveComparisonBase } from './identity.ts'
import { requireTeam, withRepository } from './service.ts'

// File feedback from the Team Review page or `bazilion team review feedback`: the file, its change
// and a diff excerpt are composed into an ordinary message and queued for a Team member.

export const FEEDBACK_NOTE_CHARS = 2000
const EXCERPT_CHARS = 4000

export async function queueReviewFeedback(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  request: ReviewFeedbackRequest,
): Promise<ReviewFeedbackResponse> {
  const team = requireTeam(db, paths, teamId)
  const agent = agentRepo.get(db, request.agentId)
  if (!agent || agent.teamId !== team.id)
    throw new DomainError(400, 'That Agent is not a member of this Team.')
  const message = await withRepository(team.path, async (captured) => {
    const base = await resolveComparisonBase(captured, request.base ?? 'HEAD')
    const listed = await listChanges(captured, base, await readRepositoryIdentity(captured))
    const withPatch = await attachPatches(captured, listed, undefined, request.path)
    const change = withPatch.changes.find((entry) => entry.path === request.path)
    if (!change) throw new DomainError(400, 'That path is not changed since this baseline.')
    return composeFeedbackMessage(change, base, request.note)
  })
  const item = await enqueueUserInput(agent.id, { message, attachments: [] }, { db, paths })
  return { message, item }
}

function composeFeedbackMessage(change: ReviewChange, base: PinnedBase, note?: string): string {
  const file = change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path
  const lines = [
    `Review feedback on ${file} (${change.status} since ${base.requestedRef}, ${base.resolvedOid.slice(0, 12)}).`,
  ]
  const trimmed = note?.trim()
  if (trimmed) lines.push('', trimmed.slice(0, FEEDBACK_NOTE_CHARS))
  if (change.patch === null) {
    lines.push('', `No diff text (${change.contentOmitted ?? 'unavailable'}).`)
  } else {
    const excerpt = change.patch.slice(0, EXCERPT_CHARS)
    // A fence longer than any backtick run inside the diff keeps it one block.
    const fence = '`'.repeat(
      Math.max(3, ...(excerpt.match(/`+/g) ?? []).map((run) => run.length + 1)),
    )
    lines.push('', `${fence}diff`, excerpt.trimEnd(), fence)
    if (change.patch.length > EXCERPT_CHARS) lines.push('(diff excerpt truncated)')
  }
  return lines.join('\n')
}
