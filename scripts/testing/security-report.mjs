import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The gate is synchronous. Only a fully successful execution AND report validation may
// remove its report. Private unique directories also survive PID-namespace PID reuse.
export function withSecurityReport(
  check,
  { temporaryRoot = tmpdir(), reportFailure = console.error } = {},
) {
  const directory = mkdtempSync(join(temporaryRoot, 'bazilion-security-acceptance-'))
  const reportPath = join(directory, 'report.json')
  try {
    const result = check(reportPath)
    rmSync(directory, { recursive: true })
    return result
  } catch (error) {
    try {
      reportFailure(`security acceptance failed; diagnostic directory retained: ${directory}`)
    } catch {
      // Logging must not replace the original gate failure or remove its evidence.
    }
    throw error
  }
}
