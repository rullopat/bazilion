import type { VerificationCheckState } from '@bazilion/api-types'
import type { ToolHandler } from './types.ts'

// BAZ-044: the specialist's entire execution capability.
//
// Two tools, and no way to widen them:
//
//   `verification_request`  — read the captured request: the change, the frozen environment, and
//                             each declared check.
//   `verification_check`    — invoke exactly one declared check, once.
//
// There is deliberately **no** command, cwd, environment or shell argument anywhere in this file. A
// specialist cannot run arbitrary text, cannot substitute a different command, and cannot retry a
// check that already reported. The daemon host is authoritative for all three: it owns the declared
// ordinals, the once-only rule and the receipt written for each outcome. The checks here are
// defence in depth and produce a clear refusal rather than a silently different run.
//
// The other half of the loop lives here too: `request_verification`, the tool a *coding* turn uses to
// hand its current change to a specialist. It is the reason a requester can be an Agent at all, which
// is what makes the result delivery reachable. That tool is never part of a restricted turn's list —
// the capability and the requester are different turns with different surfaces.

/**
 * What a coding turn asks for: one existing same-Team specialist, and the checks to run against the
 * change as it stands now. No snapshot id — the daemon captures the change at this moment, because a
 * turn cannot name a capture it has no way to make.
 */
export interface VerificationRequestIntent {
  specialist: string
  checks: Array<{ command: string; purpose: string; cwd?: string; timeoutSeconds?: number }>
  summary?: string
  writablePaths?: string[]
}

/** What the requester gets back: the request it must now wait on, not the result. */
export interface VerificationRequestReceipt {
  requestId: string
  snapshotId: string
  specialist: string
  checks: Array<{ ordinal: number; command: string; cwd: string; timeoutMs: number }>
  state: string
}

export interface VerificationRequestHost {
  capture(intent: VerificationRequestIntent): Promise<VerificationRequestReceipt>
}

/** One declared check, as the specialist sees it. */
export interface VerificationBriefCheck {
  ordinal: number
  command: string
  cwd: string
  purpose: string
  timeoutMs: number
  state: VerificationCheckState
  /** Set once the check has run: the receipt a reviewer can open. */
  commandId: string | null
  exitCode: number | null
}

export interface VerificationBrief {
  requestId: string
  summary: string | null
  snapshot: { id: string; complete: boolean; head: string | null; baseOid: string }
  environment: { image: string; sandbox: 'off' | 'docker'; cwd?: string }
  /** Named, bounded locations a check may write generated output to. */
  writablePaths: string[]
  checks: VerificationBriefCheck[]
  /** Whether the live workspace still matches the captured change. Never a pass. */
  applicability: 'identical' | 'changed' | 'unknown'
}

export interface VerificationCheckRun {
  ordinal: number
  state: VerificationCheckState
  commandId: string | null
  exitCode: number | null
  /** Bounded, redacted diagnostic tail — the same retention a coding receipt gets. */
  output: string
  truncated: boolean
}

export interface VerificationCapabilityHost {
  /** Read-only: never mutates the request or its outcomes. */
  read(): Promise<VerificationBrief>
  /**
   * Invoke one declared check. The host refuses an undeclared ordinal, a second invocation of a
   * settled check, and every request that would widen the captured command or environment.
   */
  invoke(ordinal: number, context?: { toolCallId: string }): Promise<VerificationCheckRun>
}

export class VerificationCapabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationCapabilityError'
  }
}

export function verificationTools(host: VerificationCapabilityHost): ToolHandler[] {
  // Fail fast, with a clear reason, before the host is asked to do anything. The host remains the
  // authority; this only avoids a pointless round trip for a request that cannot be honoured.
  const attempted = new Set<number>()

  const request: ToolHandler = {
    def: {
      name: 'verification_request',
      description:
        'Read the captured verification request: the exact change under verification, the environment the checks were admitted into, and every declared check with its timeout and any outcome so far. A check you were not asked to run cannot be added here — a different or additional command needs a new request.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async invoke() {
      return renderBrief(await host.read())
    },
  }

  const check: ToolHandler = {
    def: {
      name: 'verification_check',
      description:
        'Invoke exactly one declared check, identified by its ordinal from verification_request. Each check runs at most once: a check that already reported its outcome cannot be run again, and you cannot change its command, cwd, timeout or environment. Report what actually happened, including failures, skips and blockers. A successful exit is evidence about the commands that ran, never proof about later code.',
      parameters: {
        type: 'object',
        properties: {
          ordinal: {
            type: 'integer',
            minimum: 0,
            description: 'Ordinal of a declared check, as listed by verification_request.',
          },
        },
        required: ['ordinal'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      const ordinal = readOrdinal(args)
      const brief = await host.read()
      const declared = brief.checks.find((entry) => entry.ordinal === ordinal)
      if (!declared) {
        throw new VerificationCapabilityError(
          `check ${ordinal} was not captured with this request; only ${brief.checks
            .map((entry) => entry.ordinal)
            .join(', ')} exist`,
        )
      }
      if (declared.state !== 'not_executed') {
        throw new VerificationCapabilityError(
          `check ${ordinal} already reported '${declared.state}' and cannot be run again`,
        )
      }
      if (attempted.has(ordinal)) {
        throw new VerificationCapabilityError(`check ${ordinal} is already running`)
      }
      attempted.add(ordinal)
      try {
        const run = await host.invoke(ordinal, { toolCallId: context?.toolCallId ?? '' })
        return renderRun(run)
      } catch (error) {
        // A refused invocation must remain runnable only if nothing executed. The host reports
        // whether it settled the check; conservatively, keep the guard until it reports success.
        attempted.delete(ordinal)
        throw error
      }
    },
  }

  return [request, check]
}

function readOrdinal(args: Record<string, unknown>): number {
  const keys = Object.keys(args).sort()
  if (keys.length !== 1 || keys[0] !== 'ordinal') {
    throw new VerificationCapabilityError('verification_check takes only a declared ordinal')
  }
  const ordinal = args.ordinal
  if (!Number.isInteger(ordinal) || (ordinal as number) < 0) {
    throw new VerificationCapabilityError('ordinal must be a non-negative integer')
  }
  return ordinal as number
}

/**
 * The requester-side tool. Available in an ordinary protected coding turn and nowhere else.
 *
 * It asks for a *verification*, not for a verdict: the receipt names the request to wait on. Whether
 * the specialist is allowed to run it, and whether policy holds it, are decided by the daemon when the
 * request is dispatched — this tool cannot grant anything.
 */
export function verificationRequestTool(host: VerificationRequestHost): ToolHandler {
  return {
    def: {
      name: 'request_verification',
      description:
        'Hand the current change to one existing member of this Team and ask them to run specific checks against it. The daemon captures the change as it is right now — you do not capture one yourself — so later edits are not covered. Use it when a task is finished and an independent check is worth more than your own report; then end your turn and wait. You will be told the outcome. This asks for verification — it never approves, publishes, merges or deploys anything.',
      parameters: {
        type: 'object',
        properties: {
          specialist: {
            type: 'string',
            description:
              'Agent id of the same-Team member who should verify. They must already exist.',
          },
          checks: {
            type: 'array',
            maxItems: 8,
            description:
              'The exact commands to run against the captured change. Each runs once, as written.',
            items: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'Shell command, run in the captured tree.',
                },
                purpose: { type: 'string', description: 'What this command establishes.' },
                cwd: {
                  type: 'string',
                  description: 'Team-relative directory. Defaults to the root.',
                },
                timeoutSeconds: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 300,
                  description: 'Timeout. Defaults to 120 seconds.',
                },
              },
              required: ['command', 'purpose'],
              additionalProperties: false,
            },
          },
          summary: {
            type: 'string',
            description:
              'Short acceptance summary: what the change should do, and what to look for.',
          },
          writablePaths: {
            type: 'array',
            maxItems: 16,
            items: { type: 'string' },
            description:
              'Team-relative paths where checks are expected to write generated output. Advisory: it is recorded and reported, but it does not confine writes.',
          },
        },
        required: ['specialist', 'checks'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const intent = readIntent(args)
      const receipt = await host.capture(intent)
      return renderRequestReceipt(receipt)
    },
  }
}

/** Validate the shape here too, so a malformed call is a clear refusal rather than a daemon error. */
function readIntent(args: Record<string, unknown>): VerificationRequestIntent {
  const specialist = args.specialist
  if (typeof specialist !== 'string' || specialist.trim() === '') {
    throw new Error('request_verification needs the id of an existing same-Team specialist')
  }
  if (!Array.isArray(args.checks) || args.checks.length === 0) {
    throw new Error('request_verification needs at least one check')
  }
  if (args.checks.length > 8) {
    throw new Error('request_verification accepts at most eight checks')
  }
  const checks = args.checks.map((entry, index) => {
    const check = entry as Record<string, unknown>
    if (typeof check?.command !== 'string' || check.command.trim() === '') {
      throw new Error(`check ${index} has no command`)
    }
    if (typeof check?.purpose !== 'string' || check.purpose.trim() === '') {
      throw new Error(`check ${index} has no purpose`)
    }
    return {
      command: check.command,
      purpose: check.purpose,
      ...(typeof check.cwd === 'string' ? { cwd: check.cwd } : {}),
      ...(typeof check.timeoutSeconds === 'number' ? { timeoutSeconds: check.timeoutSeconds } : {}),
    }
  })
  return {
    specialist: specialist.trim(),
    checks,
    ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
    ...(Array.isArray(args.writablePaths)
      ? {
          writablePaths: args.writablePaths.filter(
            (path): path is string => typeof path === 'string',
          ),
        }
      : {}),
  }
}

function renderRequestReceipt(receipt: VerificationRequestReceipt): string {
  const lines = [
    `Verification request ${receipt.requestId} is ${receipt.state}, against snapshot ${receipt.snapshotId}.`,
    `Specialist: ${receipt.specialist}.`,
    '',
    'Captured checks:',
  ]
  for (const check of receipt.checks) {
    lines.push(`  [${check.ordinal}] ${check.command} (cwd ${check.cwd}, ${check.timeoutMs} ms)`)
  }
  lines.push(
    '',
    'The change is captured as it was at this moment; editing it now does not change what will be',
    'verified. End your turn and wait — the outcome is delivered back to you. This request is not an',
    'approval to publish, merge or deploy, and a passing check is evidence about these commands only.',
  )
  return lines.join('\n')
}

function renderBrief(brief: VerificationBrief): string {
  const lines = [
    `Verification request ${brief.requestId}`,
    `Change: snapshot ${brief.snapshot.id} (base ${brief.snapshot.baseOid.slice(0, 12)}${
      brief.snapshot.complete ? '' : ', INCOMPLETE COVERAGE'
    })`,
    `Environment: image ${brief.environment.image}, shell ${brief.environment.sandbox}${
      brief.environment.cwd ? `, cwd ${brief.environment.cwd}` : ''
    }`,
    `Applicability: ${brief.applicability === 'identical' ? 'unchanged since capture' : brief.applicability}`,
  ]
  if (brief.summary) lines.push(`Requested by the requester: ${brief.summary}`)
  if (brief.writablePaths.length > 0) {
    lines.push(
      `Declared generated-output paths (where a check is expected to write; this does not confine ` +
        `writes): ${brief.writablePaths.join(', ')}`,
    )
  }
  lines.push('', 'Captured checks:')
  for (const entry of brief.checks) {
    const outcome =
      entry.state === 'not_executed'
        ? 'not run yet'
        : `${entry.state}${entry.exitCode === null ? '' : ` (exit ${entry.exitCode})`}${
            entry.commandId ? ` receipt ${entry.commandId}` : ''
          }`
    lines.push(
      `  [${entry.ordinal}] ${entry.command} (cwd ${entry.cwd}, ${entry.timeoutMs} ms, ${entry.purpose}) — ${outcome}`,
    )
  }
  lines.push('', 'Run each captured check with verification_check. Report failures as failures.')
  return lines.join('\n')
}

function renderRun(run: VerificationCheckRun): string {
  const head = `Check ${run.ordinal}: ${run.state}${
    run.exitCode === null ? '' : ` (exit ${run.exitCode})`
  }${run.commandId ? ` — receipt ${run.commandId}` : ''}${run.truncated ? ' [output truncated]' : ''}`
  return run.output.trim() ? `${head}\n${run.output}` : head
}
