import type { AgentLessonProposal } from '@bazilion/api-types'
import { agentLessonProposalRepo, type BazilionDb } from '../core/index.ts'
import type { MemoryBackend } from '../runtime/memory/types.ts'

export class LessonProposalConflictError extends Error {}

function conflict(): never {
  throw new LessonProposalConflictError('proposal changed or is no longer eligible')
}

export async function approveLessonProposal(
  db: BazilionDb,
  memory: MemoryBackend,
  id: string,
  version: number,
): Promise<AgentLessonProposal> {
  const current = agentLessonProposalRepo.get(db, id)
  if (!current || current.version !== version || current.status !== 'pending') return conflict()
  if (current.scope === 'private') {
    return agentLessonProposalRepo.approve(db, id, version, null) ?? conflict()
  }

  const key = `lessons/${current.id}.md`
  await memory.init()
  await memory.write(
    key,
    `# Reviewed lesson\n\n${current.text}\n\nSource: agent ${current.agentId}, review ${current.reviewId}.\n`,
  )
  const approved = agentLessonProposalRepo.approve(db, id, version, key)
  if (approved) return approved
  await memory.remove(key)
  return conflict()
}

export function rejectLessonProposal(
  db: BazilionDb,
  id: string,
  version: number,
): AgentLessonProposal {
  return agentLessonProposalRepo.reject(db, id, version) ?? conflict()
}

export async function revokeLessonProposal(
  db: BazilionDb,
  memory: MemoryBackend,
  id: string,
  version: number,
): Promise<AgentLessonProposal> {
  const current = agentLessonProposalRepo.get(db, id)
  if (!current || current.version !== version || current.status !== 'approved') return conflict()
  if (current.appliedKey) {
    await memory.init()
    await memory.remove(current.appliedKey)
  }
  return agentLessonProposalRepo.revoke(db, id, version) ?? conflict()
}
