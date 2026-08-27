import type { ReviewDigest } from './review-digest.ts'

export interface PreparedReviewInput {
  message: string
  evidence: Array<{ sessionId: string; entryOrdinal: number }>
}

const MAX_TRANSCRIPT_CHARACTERS = 42_000
const MAX_PRIVATE_LESSON_CHARACTERS = 8_000
const MAX_SHARED_KEY_CHARACTERS = 4_000

function takeBoundedLines(values: readonly string[], maxCharacters: number): string[] {
  const lines: string[] = []
  let remaining = maxCharacters
  for (const raw of values) {
    if (remaining <= 0) break
    const value = raw.trim()
    if (!value) continue
    const line = `- ${value}`.slice(0, remaining)
    if (!line) break
    lines.push(line)
    remaining -= line.length + 1
  }
  return lines
}

/** Build the exact bounded payload supplied to the restricted reviewer. */
export function prepareReviewInput(
  digest: ReviewDigest,
  privateLessons: readonly string[],
  sharedLessonKeys: readonly string[],
): PreparedReviewInput {
  const selected: string[] = []
  const evidence: PreparedReviewInput['evidence'] = []
  let remaining = MAX_TRANSCRIPT_CHARACTERS
  for (let index = digest.entries.length - 1; index >= 0; index -= 1) {
    const entry = digest.entries[index]
    if (!entry || remaining <= 0) break
    const prefix = `[${entry.sessionId}:${entry.ordinal}] ${entry.role.toUpperCase()}: `
    if (prefix.length >= remaining) break
    const block = `${prefix}${entry.text.slice(0, remaining - prefix.length)}`
    selected.push(block)
    evidence.push({ sessionId: entry.sessionId, entryOrdinal: entry.ordinal })
    remaining -= block.length + 2
  }
  selected.reverse()
  evidence.reverse()

  const privateLines = takeBoundedLines(privateLessons, MAX_PRIVATE_LESSON_CHARACTERS)
  const sharedLines = takeBoundedLines(sharedLessonKeys, MAX_SHARED_KEY_CHARACTERS)
  return {
    message: [
      '# Transcript digest',
      '',
      selected.join('\n\n') || '(none)',
      '',
      '# Existing private lessons',
      privateLines.join('\n') || '(none)',
      '',
      '# Existing shared lesson keys',
      sharedLines.join('\n') || '(none)',
    ].join('\n'),
    evidence,
  }
}
