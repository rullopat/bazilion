import { DomainError } from '../errors.ts'

const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function validateSlug(s: string): void {
  if (!SLUG.test(s)) {
    throw new DomainError(
      400,
      `invalid slug "${s}": must match /^[a-z0-9][a-z0-9-]*$/ (lowercase letters, digits, hyphens; must start with letter or digit)`,
    )
  }
}

/** A template's name, trimmed; a blank one is refused (leaving the name out gives the id). */
export function templateName(value: string): string {
  const name = value.trim()
  if (!name) throw new DomainError(400, 'A template needs a name')
  return name
}
