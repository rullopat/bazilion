const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function validateSlug(s: string): void {
  if (!SLUG.test(s)) {
    throw new Error(
      `invalid slug "${s}": must match /^[a-z0-9][a-z0-9-]*$/ (lowercase letters, digits, hyphens; must start with letter or digit)`,
    )
  }
}
