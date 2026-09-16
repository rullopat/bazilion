/**
 * Read every value of a flag documented as repeatable.
 *
 * citty has no array argument type: a repeated `--flag value` pair is parsed last-wins, so a flag
 * declared as `type: 'string'` and described as "repeatable" silently keeps only the final value.
 * `asPaths(args.image as string | string[])` therefore looks like it collects several attachments and
 * in fact receives one.
 *
 * Reading the raw argument list is the only way to honour the documented behaviour. It also avoids
 * comma-splitting, which would corrupt any path that legitimately contains a comma.
 *
 * Known limit: this scans text, so an occurrence of the flag name *inside another option's value*
 * would be misread. The flags using this helper are not free-form message text, so that is not
 * reachable in practice; a caller passing user prose through such a flag should not use it.
 */
export function collectFlagValues(rawArgs: readonly string[], name: string): string[] {
  const values: string[] = []
  const long = `--${name}`
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (arg === undefined) continue
    // Everything after `--` is positional by convention, never a flag.
    if (arg === '--') break
    if (arg === long) {
      const next = rawArgs[i + 1]
      if (next !== undefined && next !== '--') {
        values.push(next)
        i++
      }
      continue
    }
    if (arg.startsWith(`${long}=`)) {
      const value = arg.slice(long.length + 1)
      if (value.length > 0) values.push(value)
    }
  }
  return values
}
