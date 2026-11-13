/**
 * Every value of a repeatable flag (`--image a --image b`), read from the raw arguments: citty
 * parses a repeated flag last-wins. Values are taken as given, never split on commas, so paths may
 * contain them. An option value that is itself the flag name would be misread.
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
