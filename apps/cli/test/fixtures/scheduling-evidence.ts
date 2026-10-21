import { appendFileSync } from 'node:fs'

/** Opt-in fixture facts only; never pass tokens, environment dumps or conversation payloads. */
export function schedulingEvidence(scenario: string, facts: Record<string, unknown>): void {
  if (process.env.BAZILION_TEST_SCHEDULING_EVIDENCE !== '1') return
  const line = JSON.stringify({ scenario, at: Date.now(), ...facts })
  const file = process.env.BAZILION_TEST_SCHEDULING_EVIDENCE_FILE
  if (file) appendFileSync(file, `${line}\n`, { mode: 0o600 })
  else console.info(`BAZ065_EVIDENCE ${line}`)
}
