// The learning reviewer's only tool and its system prompt. A review worker reads a redacted
// digest of recent turns and answers with zero to five lesson proposals in one `propose_lesson`
// call; the operator then approves or rejects each one.

import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { ReviewWorkerProposal } from '../worker/runtime.ts'

export const REVIEW_SYSTEM_PROMPT = `You are a restricted learning reviewer. Analyze only the supplied
transcript digest and approved-lesson index. You cannot act on the world. Call propose_lesson once
with zero to five proposals, then stop.

If propose_lesson rejects malformed output, correct the schema exactly once. If that repair is also
rejected, stop; the review will fail.

Classify before proposing:
1. Stable human preference or biography belongs to USER.md: do not propose it.
2. Agent-specific verified behavior or strategy is private.
3. Reusable verified Team project knowledge, decisions, or procedures are shared.
4. Everything else produces no proposal.

Zero proposals is a successful result. Never save transient or environment-dependent failures,
unresolved attempts, guesses, contradicted claims, one-off narratives, status updates, secrets,
credentials, sensitive personal data, raw logs, copied text, or duplicates. Each proposal must cite
at least one supplied evidence entry and one observation may appear in only one proposal.`

export interface LessonReview {
  tool: ToolDefinition
  /** Count one finished `propose_lesson` call; true once the review must stop. */
  recordCall(isError: boolean): boolean
  /** The accepted proposals; throws when the reviewer produced no valid batch. */
  result(): ReviewWorkerProposal[]
}

/** One review's `propose_lesson` tool, which may cite only the evidence the digest showed. */
export function createLessonReview(
  evidence: ReadonlyArray<{ sessionId: string; entryOrdinal: number }>,
): LessonReview {
  const allowed = new Set(evidence.map((item) => `${item.sessionId}:${item.entryOrdinal}`))
  let accepted: ReviewWorkerProposal[] | undefined
  let rejections = 0
  const tool: ToolDefinition = {
    name: 'propose_lesson',
    label: 'propose_lesson',
    description:
      'Submit zero to five evidence-backed lesson proposals in one final batch. This is the only available action.',
    parameters: Type.Object({
      proposals: Type.Array(
        Type.Object({
          scope: Type.Union([Type.Literal('private'), Type.Literal('shared')]),
          text: Type.String({ minLength: 1, maxLength: 500 }),
          evidenceEntryIds: Type.Array(
            Type.Object({ sessionId: Type.String(), entryOrdinal: Type.Integer({ minimum: 0 }) }),
            { minItems: 1 },
          ),
        }),
        { maxItems: 5 },
      ),
    }),
    async execute(_toolCallId, params) {
      if (accepted) throw new Error('propose_lesson may be called only once')
      const proposals: ReviewWorkerProposal[] = []
      for (const candidate of (params as { proposals: ReviewWorkerProposal[] }).proposals) {
        const text = candidate.text.trim()
        if (!text || text.length > 500) throw new Error('proposal text must be 1-500 characters')
        for (const item of candidate.evidenceEntryIds) {
          if (!allowed.has(`${item.sessionId}:${item.entryOrdinal}`)) {
            throw new Error('proposal cites evidence outside the supplied digest')
          }
        }
        proposals.push({ ...candidate, text })
      }
      accepted = proposals
      return {
        content: [{ type: 'text', text: `accepted ${proposals.length} proposals` }],
        details: {},
        terminate: true,
      }
    },
  }
  return {
    tool,
    recordCall(isError) {
      if (isError) rejections += 1
      return rejections >= 2
    },
    result() {
      if (rejections >= 2) {
        throw new Error('review output remained invalid after one schema-repair attempt')
      }
      if (!accepted) throw new Error('review output did not submit a proposal batch')
      return accepted
    },
  }
}
