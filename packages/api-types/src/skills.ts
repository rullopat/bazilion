export type SkillScanSeverity = 'warning' | 'danger'

export interface SkillScanFinding {
  code: string
  severity: SkillScanSeverity
  message: string
  line?: number
}

export interface SkillInfo {
  name: string
  description: string
  source: string | null
  importedAt: number | null
  parseError?: string
  scanFindings?: SkillScanFinding[]
}

/** `GET /api/agents/:id/skills`. */
export interface ResolvedSkillsResponse {
  resolved: SkillInfo[]
  missing: { name: string; reason: string }[]
}

export interface AttachSkillRequest {
  skill: string
  /** Required when attaching a skill whose static scan has findings. */
  allowFindings?: boolean
}

export interface ImportSkillsRequest {
  source: string
  /** Overwrite existing skills and confirm static-scan warnings. */
  force?: boolean
}

export interface ImportSkillsResponse {
  imported: string[]
  skipped: { name: string; reason: string; findings?: SkillScanFinding[] }[]
  findings?: Record<string, SkillScanFinding[]>
}
