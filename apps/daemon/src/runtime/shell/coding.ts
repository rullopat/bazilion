import type { CodingEnvironmentValues } from '@bazilion/api-types'
import { codingRelativePath } from '../../core/coding-environment/config.ts'

/** Closed, serializable addition to preflighted Docker facts; never contains host paths. */
export interface DockerCodingSelection {
  revision: number
  cwd: string
  env: CodingEnvironmentValues
}

export function validateDockerCodingSelection(input: unknown): DockerCodingSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid Docker coding selection')
  const value = input as Record<string, unknown>
  if (
    Object.keys(value).some((key) => !['revision', 'cwd', 'env'].includes(key)) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    throw new Error('Invalid Docker coding revision')
  const cwd = codingRelativePath(value.cwd)
  if (!value.env || typeof value.env !== 'object' || Array.isArray(value.env))
    throw new Error('Invalid Docker coding environment')
  const env: CodingEnvironmentValues = {}
  for (const [key, entry] of Object.entries(value.env)) {
    if (key === 'CI' && (entry === 'true' || entry === 'false')) env.CI = entry
    else if (key === 'NO_COLOR' && (entry === '0' || entry === '1')) env.NO_COLOR = entry
    else if (key === 'TZ' && entry === 'UTC') env.TZ = entry
    else throw new Error('Invalid Docker coding environment')
  }
  return { revision: value.revision as number, cwd, env }
}

export function codingContainerCwd(cwd: string): string {
  return cwd === '.' ? '/workspace' : `/workspace/${codingRelativePath(cwd)}`
}
