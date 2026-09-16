import type {
  VerificationAttempt,
  VerificationCheckInput,
  VerificationCheckState,
  VerificationReport,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { collectFlagValues } from '../repeatable-args.ts'

// `bazilion team verify` — specialist verification of a captured code change (BAZ-044).
//
// Creating a request does not run anything: the verification state machine claims it, revalidates
// the change, and executes only the checks captured here. This command never widens a request, and a
// blocked capture prints the reason it could not be honoured.

const slug = {
  id: { type: 'positional', required: true, description: 'Team slug' },
} as const

const OUTCOME_GLYPH: Record<VerificationCheckState, string> = {
  not_executed: 'not run',
  succeeded: 'ok',
  failed: 'FAIL',
  skipped: 'skipped',
  blocked: 'blocked',
  timed_out: 'timeout',
  cancelled: 'cancelled',
  unknown: 'unknown',
}

function latestAttempt(report: VerificationReport): VerificationAttempt | undefined {
  return [...report.attempts].sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
}

function printReport(report: VerificationReport): void {
  const { request } = report
  const requester =
    request.requester.kind === 'agent' ? `agent ${request.requester.agentId}` : 'operator'
  console.log(`${request.id}  ${request.state}`)
  console.log(
    `  change:    snapshot ${request.snapshot.id} (base ${request.snapshot.baseOid.slice(0, 12)}${
      request.snapshot.complete ? '' : ', INCOMPLETE COVERAGE'
    })`,
  )
  console.log(`  specialist: ${request.recipientAgentId}   requested by: ${requester}`)
  console.log(`  environment: ${request.environment.image} (shell ${request.environment.sandbox})`)
  console.log(
    `  applicability: ${
      report.applicability.comparison === 'identical'
        ? 'unchanged since capture'
        : `${report.applicability.comparison} (never a pass)`
    }`,
  )
  if (request.summary) console.log(`  requested: ${request.summary}`)

  const attempt = latestAttempt(report)
  const outcomes = new Map((attempt?.outcomes ?? []).map((outcome) => [outcome.ordinal, outcome]))
  console.log('  checks:')
  for (const check of report.checks) {
    const outcome = outcomes.get(check.ordinal)
    const state = outcome?.state ?? 'not_executed'
    const receipt = outcome?.commandId
      ? `  receipt ${outcome.commandId}`
      : outcome?.receiptUnavailable
        ? '  receipt no longer available'
        : ''
    const exit =
      outcome?.exitCode === null || outcome?.exitCode === undefined
        ? ''
        : ` exit ${outcome.exitCode}`
    console.log(
      `    [${check.ordinal}] ${OUTCOME_GLYPH[state]}${exit}${receipt}  ${check.command} (${check.purpose})`,
    )
  }
  if (attempt?.error) console.log(`  note: ${attempt.error}`)
  if (!attempt) console.log('  note: no attempt has run yet')
}

const createCmd = defineCommand({
  meta: {
    name: 'create',
    description: 'Capture a verification request against a snapshot (does not run checks)',
  },
  args: {
    ...slug,
    agent: { type: 'string', required: true, description: 'Team member who will verify' },
    snapshot: { type: 'string', required: true, description: 'BAZ-042 snapshot id to verify' },
    check: {
      type: 'string',
      required: true,
      description:
        'A check as "<command> :: <purpose> [:: <cwd>] [:: <timeoutSeconds>]". Repeat up to eight times.',
    },
    summary: { type: 'string', description: 'Optional acceptance summary for the specialist' },
    writable: {
      type: 'string',
      description: 'Declared writable output path for checks. Repeat for each path.',
    },
    json: { type: 'boolean', description: 'Emit the request as JSON' },
  },
  async run({ args }) {
    const raw = collectFlagValues(process.argv, 'check')
    if (raw.length === 0) {
      console.error('at least one --check is required')
      process.exit(1)
    }
    const checks: VerificationCheckInput[] = raw.map((value) => {
      const [command, purpose, cwd, timeoutSeconds] = value.split('::').map((part) => part.trim())
      if (!command || !purpose) {
        console.error(`a check needs a command and a purpose: ${value}`)
        process.exit(1)
      }
      const seconds = timeoutSeconds ? Number(timeoutSeconds) : 120
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) {
        console.error(`a check timeout must be 1-300 seconds: ${value}`)
        process.exit(1)
      }
      return {
        command,
        purpose,
        cwd: cwd || '.',
        timeoutMs: Math.round(seconds * 1000),
      }
    })
    const writablePaths = collectFlagValues(process.argv, 'writable')

    const client = createClient()
    try {
      const response = await client.verifications(args.id).create({
        recipientAgentId: args.agent,
        snapshotId: args.snapshot,
        checks,
        summary: args.summary ?? null,
        ...(writablePaths.length > 0 ? { writablePaths } : {}),
      })
      if ('blocked' in response) {
        // A blocked capture is a result with a reason, not a crash.
        console.error(`blocked (${response.blocked.reason}): ${response.blocked.detail}`)
        process.exit(1)
      }
      if (args.json) {
        console.log(JSON.stringify(response.request, null, 2))
        return
      }
      console.log(
        `captured ${response.request.request.id} (state ${response.request.request.state})`,
      )
      console.log('the specialist is admitted by the verification scheduler; nothing has run yet')
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List verification requests for a Team' },
  args: {
    ...slug,
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const client = createClient()
    const response = await client.verifications(args.id).list()
    if (args.json) {
      console.log(JSON.stringify(response, null, 2))
      return
    }
    if (response.requests.length === 0) {
      console.log('no verification requests')
      return
    }
    const rows = [
      ['ID', 'STATE', 'SPECIALIST', 'CHANGE'],
      ...response.requests.map((entry) => [
        entry.request.id,
        entry.request.state,
        entry.request.recipientAgentId,
        entry.request.snapshot.id.slice(0, 12),
      ]),
    ]
    for (const line of columnize(rows)) console.log(line)
    // Applicability is established per request, not per list: `show` compares the live tree.
    console.log("run `bazilion team verify show <slug> <id>` for a request's current applicability")
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show one verification request and its evidence' },
  args: {
    ...slug,
    requestId: { type: 'positional', required: true, description: 'Verification request id' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const client = createClient()
    try {
      const response = await client.verifications(args.id).show(args.requestId)
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      printReport(response.request)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const cancelCmd = defineCommand({
  meta: { name: 'cancel', description: 'Cancel a pending or running verification request' },
  args: {
    ...slug,
    requestId: { type: 'positional', required: true, description: 'Verification request id' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const client = createClient()
    try {
      const response = await client.verifications(args.id).cancel(args.requestId)
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      console.log(`cancelled or cancelled-pending: ${response.request.request.id}`)
      printReport(response.request)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

export const verifyCommand = defineCommand({
  meta: {
    name: 'verify',
    description: 'Specialist verification of a captured code change (BAZ-044)',
  },
  subCommands: {
    create: createCmd,
    list: listCmd,
    show: showCmd,
    cancel: cancelCmd,
  },
})
