import { agentRepo, type BazilionDb } from '../core/index.ts'

/**
 * Expand an agent ID prefix (from URL params) to the full UUID.
 *
 * Returns the resolved full ID when the prefix is exact or uniquely resolves;
 * returns the raw input otherwise so the caller's existing "not found" branch
 * fires with the original value in the error message.
 */
export function resolveAgentIdParam(db: BazilionDb, raw: string | undefined): string {
  if (!raw) return ''
  return agentRepo.resolveId(db, raw) ?? raw
}
