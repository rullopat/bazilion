import type { CodingEnvironmentConfig } from '@bazilion/api-types'

export class CodingEnvironmentValidationError extends Error {
  readonly status = 400
}

function invalid(field: string): never {
  // Never echo configuration values: rejected values could contain credentials.
  throw new CodingEnvironmentValidationError(`Invalid coding environment ${field}`)
}

function object(value: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !keys.includes(key))) invalid(field)
  return record
}

function text(value: unknown, max: number, field: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value) > max ||
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0)
      return code === 127 || (code < 32 && code !== 9 && code !== 10)
    })
  )
    invalid(field)
  return value
}

/** Lexical validation only; admission separately pins existing non-symlinked directories. */
export function codingRelativePath(value: unknown, field = 'cwd'): string {
  const path = text(value, 4096, field)
  if (path === '.') return path
  const parts = path.split('/')
  if (
    parts.length > 16 ||
    path.includes('\\') ||
    Array.from(path).some((char) => char.charCodeAt(0) < 32) ||
    parts.some((part) => !part || part === '.' || part === '..' || part === '.git')
  )
    invalid(field)
  return path
}

export function validateCodingEnvironmentConfig(input: unknown): CodingEnvironmentConfig {
  const config = object(input, ['image', 'cwd', 'env'], 'configuration')
  const image = text(config.image, 512, 'image')
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(image)) invalid('image')
  const cwd = codingRelativePath(config.cwd)
  const env = object(config.env, ['CI', 'NO_COLOR', 'TZ'], 'environment values')
  for (const [key, value] of Object.entries(env)) {
    const allowed = key === 'CI' ? ['true', 'false'] : key === 'NO_COLOR' ? ['0', '1'] : ['UTC']
    if (typeof value !== 'string' || !allowed.includes(value)) invalid('environment values')
  }
  return { image, cwd, env } as CodingEnvironmentConfig
}
export function validateCodingCommand(
  input: unknown,
): import('@bazilion/api-types').CodingCommandInput {
  const value = object(input, ['command', 'cwd', 'purpose', 'timeoutSeconds'], 'command')
  const command = text(value.command, 4096, 'command')
  if (command.includes('\0')) invalid('command')
  const cwd = codingRelativePath(value.cwd)
  if (!['runtime', 'dependency', 'prepare', 'build', 'test'].includes(String(value.purpose)))
    invalid('purpose')
  if (
    !Number.isInteger(value.timeoutSeconds) ||
    Number(value.timeoutSeconds) < 1 ||
    Number(value.timeoutSeconds) > 300
  )
    invalid('timeout')
  return {
    command,
    cwd,
    purpose: value.purpose,
    timeoutSeconds: value.timeoutSeconds,
  } as import('@bazilion/api-types').CodingCommandInput
}
