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
