import { ApiClientError } from './client.ts'
import { findingLines } from './command-helpers.ts'

/** A mistake in the command line itself: it exits 2, like a request the daemon finds invalid. */
export class UsageError extends Error {}

/**
 * Rethrow a blocked skill scan as one error listing the findings and the flag that confirms them;
 * any other failure is rethrown as it is.
 */
export function explainScanBlock(confirmFlag: string): (err: unknown) => never {
  return (err) => {
    if (!(err instanceof ApiClientError) || err.body.code !== 'skill_scan_blocked') throw err
    const findings = findingLines(err.body.findings ?? []).map((line) => `  ${line}`)
    throw new Error(
      [
        err.body.error,
        ...(findings.length > 0 ? ['scan findings:', ...findings] : []),
        `  hint: inspect the skill, then rerun with ${confirmFlag} to confirm`,
      ].join('\n'),
    )
  }
}

/** Print a failed command's error, with a hint for the common setup mistakes. */
export function printError(err: unknown): void {
  if (err instanceof ApiClientError) {
    console.error(`error: ${err.body.error}`)
    if (err.status === 401) {
      console.error('  hint: token mismatch. Check ~/.bazilion/auth.json "token"')
      console.error('        or re-run "bazilion login" for a remote server.')
    } else if (err.status === 403 && !err.body.code) {
      // A gateway origin/CSRF refusal; domain refusals (a Team Policy denial) carry a code.
      console.error('  hint: the server refused the request. Check that BAZILION_SERVER matches')
      console.error('        the server origin exactly (scheme + host + port).')
    }
    return
  }
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`error: ${msg}`)
  // node's fetch wraps the syscall error, so its code is on `cause`.
  const code = err instanceof Error ? (err as { cause?: { code?: string } }).cause?.code : undefined
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    console.error('  hint: the bazilion server is not running. Start it with "bazilion serve"')
    console.error('        or point BAZILION_SERVER at a running instance.')
  } else if (code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) {
    console.error('  hint: host not found. Check BAZILION_SERVER / ~/.bazilion/auth.json.')
  }
}

/** 2: invalid (a usage error, or rejected by the daemon); 3: conflict; 4: not authorized; 1: the rest. */
export function exitCodeForError(err: unknown): number {
  if (err instanceof UsageError) return 2
  if (!(err instanceof ApiClientError)) return 1
  if (err.status === 401 || err.status === 403) return 4
  if (err.status === 409) return 3
  return err.status === 400 || err.status === 422 ? 2 : 1
}
