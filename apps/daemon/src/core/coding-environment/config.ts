import type { TeamCodingEnvironment } from '@bazilion/api-types'
import { DomainError } from '../errors.ts'

export class CodingEnvironmentValidationError extends DomainError {
  constructor(message: string) {
    super(400, message)
  }
}

const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/

/** A Team-relative directory: '.', or plain path segments with no `..`, `.git` or backslash. */
function codingRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value === '' || Buffer.byteLength(value) > 4096)
    throw new CodingEnvironmentValidationError('Invalid coding environment cwd')
  if (value === '.') return value
  const parts = value.split('/')
  if (
    parts.length > 16 ||
    value.includes('\\') ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    parts.some((part) => !part || part === '.' || part === '..' || part === '.git')
  )
    throw new CodingEnvironmentValidationError('Invalid coding environment cwd')
  return value
}

/** A Team's Docker defaults: a local image reference (null for the installation's) and a cwd. */
export function validateCodingEnvironment(input: unknown): TeamCodingEnvironment {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new CodingEnvironmentValidationError('Invalid coding environment')
  const { image, cwd, ...extra } = input as Record<string, unknown>
  if (Object.keys(extra).length > 0)
    throw new CodingEnvironmentValidationError('Coding environment accepts only image and cwd')
  if (image !== null && (typeof image !== 'string' || image.length > 512 || !IMAGE.test(image)))
    throw new CodingEnvironmentValidationError('Invalid coding environment image')
  return { image, cwd: codingRelativePath(cwd) }
}
