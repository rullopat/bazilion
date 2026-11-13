import type { SkillScanFinding } from './skills.ts'

/** The body of every error response; `code` is set where a client branches on it. */
export interface ApiError {
  error: string
  code?: string
  findings?: SkillScanFinding[]
}
