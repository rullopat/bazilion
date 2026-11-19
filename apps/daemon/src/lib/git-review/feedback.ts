import type {
  PinnedBase,
  ReviewChange,
  ReviewFeedbackComment,
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

// Review feedback from the Changes view or `bazilion team review feedback`: each comment names a
// changed file, or one line of it, and carries the diff around it. All comments of one review are
// composed into one ordinary message and queued for a Team member.

export const FEEDBACK_NOTE_CHARS = 2000
export const FEEDBACK_COMMENTS = 20
/** Diff excerpt of a review with one comment; several comments share the room. */
const EXCERPT_CHARS = 4000
const EXCERPT_CHARS_EACH = 1600

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
    const changes = new Map<string, ReviewChange>()
    for (const { path } of request.comments) {
      if (changes.has(path)) continue
      const withPatch = await attachPatches(captured, listed, undefined, path)
      const change = withPatch.changes.find((entry) => entry.path === path)
      if (!change) throw new DomainError(400, 'That path is not changed since this baseline.')
      changes.set(path, change)
    }
    return composeFeedbackMessage(request, changes, base)
  })
  const item = await enqueueUserInput(agent.id, { message, attachments: [] }, { db, paths })
  return { message, item }
}

/** The hunk of a unified diff that holds `line` of the file as it is now; null when none does. */
export function hunkForLine(patch: string, line: number): string | null {
  const lines = patch.split('\n')
  const starts: number[] = []
  lines.forEach((text, index) => {
    if (text.startsWith('@@')) starts.push(index)
  })
  for (const [position, start] of starts.entries()) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(lines[start] ?? '')
    if (!header) continue
    const first = Number(header[1])
    const count = header[2] === undefined ? 1 : Number(header[2])
    if (line < first || line >= first + Math.max(count, 1)) continue
    return lines.slice(start, starts[position + 1] ?? lines.length).join('\n')
  }
  return null
}

function place(comment: ReviewFeedbackComment, change: ReviewChange): string {
  const file = change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path
  return comment.line === undefined ? file : `${file}, line ${comment.line}`
}

/** The note and the diff around one comment. */
function commentBody(comment: ReviewFeedbackComment, change: ReviewChange, room: number): string[] {
  const lines: string[] = []
  const note = comment.note?.trim()
  if (note) lines.push('', note.slice(0, FEEDBACK_NOTE_CHARS))
  if (change.patch === null) {
    lines.push('', `No diff text (${change.contentOmitted ?? 'unavailable'}).`)
    return lines
  }
  const source =
    comment.line === undefined
      ? change.patch
      : (hunkForLine(change.patch, comment.line) ?? change.patch)
  const excerpt = source.slice(0, room)
  // A fence longer than any backtick run inside the diff keeps it one block.
  const fence = '`'.repeat(
    Math.max(3, ...(excerpt.match(/`+/g) ?? []).map((run) => run.length + 1)),
  )
  lines.push('', `${fence}diff`, excerpt.trimEnd(), fence)
  if (source.length > room) lines.push('(diff excerpt truncated)')
  return lines
}

function composeFeedbackMessage(
  request: ReviewFeedbackRequest,
  changes: ReadonlyMap<string, ReviewChange>,
  base: PinnedBase,
): string {
  const since = `since ${base.requestedRef}, ${base.resolvedOid.slice(0, 12)}`
  const overall = request.note?.trim()
  const [only] = request.comments
  if (request.comments.length === 1 && only && !overall) {
    const change = changes.get(only.path) as ReviewChange
    return [
      `Review feedback on ${place(only, change)} (${change.status} ${since}).`,
      ...commentBody(only, change, EXCERPT_CHARS),
    ].join('\n')
  }
  const lines = [`Review feedback: ${request.comments.length} comments (${since}).`]
  if (overall) lines.push('', overall.slice(0, FEEDBACK_NOTE_CHARS))
  request.comments.forEach((comment, index) => {
    const change = changes.get(comment.path) as ReviewChange
    lines.push(
      '',
      `${index + 1}. ${place(comment, change)} (${change.status})`,
      ...commentBody(comment, change, EXCERPT_CHARS_EACH),
    )
  })
  return lines.join('\n')
}
