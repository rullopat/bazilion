import type {
  ReviewConclusion,
  ReviewConclusionInput,
  ReviewFindingInput,
  ReviewPacketBrief,
  ReviewPathContent,
} from '@bazilion/api-types'
import type { ToolHandler } from './types.ts'

// BAZ-043: the reviewer Agent's entire capability.
//
// Four tools, and no way to widen them:
//
//   `review_packet`      — read the captured revision: its changed paths, whether its content is still
//                          reproducible, the findings so far and any conclusion already recorded.
//   `review_path`        — read one changed path's patch, when that patch can still be reproduced.
//   `review_finding`     — record one finding against a path in the captured revision.
//   `review_conclusion`  — record the reviewer's conclusion: the end of the review.
//
// There is deliberately **no** command, no file write, no environment and no publication here. A static
// review reads a captured revision and says what it thinks; it never runs anything and never changes the
// checkout. The daemon host is authoritative for all of it: it owns which paths exist in the revision,
// whether content is reproducible, and what a conclusion is allowed to be.

/**
 * What a coding turn asks for: one existing same-Team member to review the change as it stands now.
 *
 * No snapshot id and no checks — the daemon captures the revision at this moment, and a review has no
 * commands to run. It is a request for a *reading*, not for execution.
 */
export interface ReviewRequestIntent {
  reviewer: string
  summary?: string
}

export interface ReviewRequestReceipt {
  packetId: string
  snapshotId: string
  reviewer: string
  state: string
}

export interface ReviewRequestHost {
  capture(intent: ReviewRequestIntent): Promise<ReviewRequestReceipt>
}

export interface ReviewCapabilityHost {
  read(): Promise<ReviewPacketBrief>
  path(path: string): Promise<ReviewPathContent>
  addFinding(input: ReviewFindingInput): Promise<{ findingId: string; ordinal: number }>
  conclude(input: ReviewConclusionInput): Promise<{ conclusion: ReviewConclusion }>
}

export class ReviewCapabilityError extends Error {}

const SEVERITIES = ['blocker', 'major', 'minor', 'info'] as const
const CONCLUSIONS = ['changes_requested', 'commented', 'recommended'] as const

export function reviewTools(host: ReviewCapabilityHost): ToolHandler[] {
  const packetTool: ToolHandler = {
    def: {
      name: 'review_packet',
      description:
        'Read the captured revision you are reviewing: its changed paths, whether that revision’s content can still be reproduced from the working tree, the findings recorded so far, and any conclusion already recorded. This is a static review of one captured revision — it is not the current repository, and nothing here runs code or changes files.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async invoke() {
      return renderBrief(await host.read())
    },
  }

  const pathTool: ToolHandler = {
    def: {
      name: 'review_path',
      description:
        'Read one changed path’s patch from the reviewed revision. Only paths listed by review_packet exist in it. If the working tree has moved since the capture, the patch cannot be reproduced and this says so — a diff of different code is never returned as the reviewed change.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Repository-relative path, exactly as review_packet listed it.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      if (path === '') throw new ReviewCapabilityError('review_path needs a path')
      return renderContent(await host.path(path))
    },
  }

  const findingTool: ToolHandler = {
    def: {
      name: 'review_finding',
      description:
        'Record one finding against the reviewed revision: a path that appears in review_packet, a severity, and what is wrong. The line range is context for a reader, not identity — do not attach a finding to a line you have not read. A finding is a statement with evidence, never an approval, and a finding that cannot be correlated to this revision is recorded as unverified rather than guessed at.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Changed path in the reviewed revision.' },
          severity: {
            type: 'string',
            enum: [...SEVERITIES],
            description: 'blocker | major | minor | info',
          },
          note: {
            type: 'string',
            description: 'What is wrong and what it would take to be satisfied. Be specific.',
          },
          lineStart: {
            type: 'integer',
            minimum: 1,
            description: 'Optional first line of context.',
          },
          lineEnd: { type: 'integer', minimum: 1, description: 'Optional last line of context.' },
        },
        required: ['path', 'severity', 'note'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      const note = typeof args.note === 'string' ? args.note.trim() : ''
      const severity = args.severity
      if (path === '') throw new ReviewCapabilityError('review_finding needs a path')
      if (note === '') throw new ReviewCapabilityError('review_finding needs a note')
      if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
        throw new ReviewCapabilityError(`severity must be one of: ${SEVERITIES.join(', ')}`)
      }
      const result = await host.addFinding({
        path,
        severity: severity as (typeof SEVERITIES)[number],
        note,
        lineStart: readLine(args.lineStart),
        lineEnd: readLine(args.lineEnd),
      })
      return `Finding ${result.findingId} recorded as [${String(severity)}] on ${path} (finding ${result.ordinal}). Nothing was executed and nothing was changed.`
    },
  }

  const conclusionTool: ToolHandler = {
    def: {
      name: 'review_conclusion',
      description:
        'Record your conclusion for this revision and finish. changes_requested | commented | recommended. A conclusion is your statement about this revision: it is not operator acceptance, not a passing test, and not permission to publish, merge or deploy. Unresolved findings stay visible whatever you conclude, so conclude on the evidence you actually have.',
      parameters: {
        type: 'object',
        properties: {
          conclusion: {
            type: 'string',
            enum: [...CONCLUSIONS],
            description: 'changes_requested | commented | recommended',
          },
          note: { type: 'string', description: 'A short justification, in evidence terms.' },
        },
        required: ['conclusion'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const conclusion = args.conclusion
      if (!CONCLUSIONS.includes(conclusion as (typeof CONCLUSIONS)[number])) {
        throw new ReviewCapabilityError(`conclusion must be one of: ${CONCLUSIONS.join(', ')}`)
      }
      const result = await host.conclude({
        conclusion: conclusion as (typeof CONCLUSIONS)[number],
        note: typeof args.note === 'string' ? args.note : null,
      })
      return `Conclusion recorded: ${result.conclusion}. The review is complete; the requester learns the outcome.`
    },
  }

  return [packetTool, pathTool, findingTool, conclusionTool]
}

/**
 * The requester-side tool, available in an ordinary coding turn and nowhere else.
 *
 * It asks for a review, not for a verdict: the receipt names the packet to wait on. Whether the reviewer is
 * allowed and whether policy holds the request are decided by the daemon at dispatch — this tool cannot
 * grant anything or run anything.
 */
export function reviewRequestTool(host: ReviewRequestHost): ToolHandler {
  return {
    def: {
      name: 'request_review',
      description:
        'Ask one existing member of this Team to read the change as it is right now and say what they think of it. The daemon captures the change, so later edits are not covered. Use it when a second pair of eyes is worth more than your own summary; then end your turn and wait — you will be told what they found. This is a static reading: the reviewer runs nothing and changes nothing, and this is not an approval to publish, merge or deploy.',
      parameters: {
        type: 'object',
        properties: {
          reviewer: {
            type: 'string',
            description:
              'The same-Team member who should review — their name or their agent id. A name that matches nobody comes back with the members you can ask.',
          },
          summary: {
            type: 'string',
            description:
              'What the change is for and what to look at, in your words. It is commentary; it is not evidence.',
          },
        },
        required: ['reviewer'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const reviewer = typeof args.reviewer === 'string' ? args.reviewer.trim() : ''
      if (reviewer === '') throw new ReviewCapabilityError('request_review needs a reviewer')
      const receipt = await host.capture({
        reviewer,
        ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
      })
      return [
        `Review packet ${receipt.packetId} is ${receipt.state}, against revision ${receipt.snapshotId}.`,
        `Reviewer: ${receipt.reviewer}.`,
        '',
        'The change is captured as it was at this moment; editing it now does not change what will be',
        'reviewed. End your turn and wait — the findings are delivered back to you. A reviewer’s conclusion',
        'is their statement about this revision, not an approval and not a test result.',
      ].join('\n')
    },
  }
}

function readLine(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null
}

function renderBrief(brief: ReviewPacketBrief): string {
  const lines = [
    `Review packet ${brief.packetId}`,
    `Change: revision ${brief.snapshot.id} (base ${brief.snapshot.baseOid.slice(0, 12)}${
      brief.snapshot.complete ? '' : ', INCOMPLETE COVERAGE'
    })`,
  ]
  if (brief.summary) lines.push(`Requested by the requester: ${brief.summary}`)
  lines.push(
    '',
    `Changed paths (${brief.changes.length}):`,
    ...brief.changes.map(
      (change) =>
        `  ${change.status.padEnd(9)} ${change.path}${
          change.previousPath ? ` (was ${change.previousPath})` : ''
        }`,
    ),
  )
  lines.push(
    '',
    brief.contentAvailable
      ? 'Content: the working tree still matches this revision, so review_path can show a patch.'
      : `Content: NOT reproducible — ${brief.contentUnavailableReason ?? 'the reviewed revision has moved'}. Review from the change list, the requester’s summary and your own reading of the paths; do not describe lines you could not read.`,
  )
  if (brief.findings.length > 0) {
    lines.push('', 'Findings so far:')
    for (const finding of brief.findings) {
      lines.push(
        `  [${finding.severity}] ${finding.path} (${finding.authorKind}) — ${finding.note}`,
      )
    }
  } else {
    lines.push('', 'Findings so far: none.')
  }
  if (brief.conclusion) lines.push('', `A conclusion is already recorded: ${brief.conclusion}.`)
  lines.push(
    '',
    'You cannot run commands, change files or publish anything. Record findings with review_finding and finish with review_conclusion.',
  )
  return lines.join('\n')
}

function renderContent(content: ReviewPathContent): string {
  if (content.reason) return `No patch for ${content.path}: ${content.reason}`
  if (!content.patch) return `No patch for ${content.path}: the change recorded no content.`
  return `Patch for ${content.path}${content.truncated ? ' (truncated)' : ''}:\n\n${content.patch}`
}
