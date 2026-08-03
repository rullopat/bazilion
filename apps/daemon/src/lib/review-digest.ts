export interface ReviewTranscriptEntry {
  sessionId: string
  ordinal: number
  role: 'user' | 'assistant' | 'tool'
  text: string
  toolName?: string
  sensitive?: boolean
}

export interface ReviewDigest {
  sessionId: string
  startOrdinal: number
  endOrdinal: number
  inputCharacters: number
  turnsReviewed: number
  entries: Array<ReviewTranscriptEntry & { text: string }>
}

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:api[_-]?key|token|password)\s*[:=]\s*[^\s,;]+/gi,
]

export function redactReviewText(text: string): string {
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, '[REDACTED]'), text)
}

/**
 * Bound and redact already-normalized canonical session entries. The pi-specific reader stays at
 * the adapter edge; this pure function is deterministic and never receives image or attachment
 * bodies. Tool results become a name-only completion marker so logs and arguments are not replayed.
 */
export function buildReviewDigest(
  input: ReviewTranscriptEntry[],
  options: { maxUserTurns?: number; maxCharacters?: number } = {},
): ReviewDigest | null {
  const maxUserTurns = options.maxUserTurns ?? 8
  const maxCharacters = options.maxCharacters ?? 40_000
  const normalized = input
    .filter((entry) => !entry.sensitive && entry.ordinal >= 0 && entry.text.trim())
    .map((entry) => ({
      ...entry,
      text:
        entry.role === 'tool'
          ? `[tool:${entry.toolName?.trim() || 'unknown'}] completed`
          : redactReviewText(entry.text.trim()),
    }))
  if (normalized.length === 0) return null

  const selected: typeof normalized = []
  let userTurns = 0
  let characters = 0
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const entry = normalized[index]
    if (!entry) continue
    if (entry.role === 'user' && userTurns >= maxUserTurns) break
    const remaining = maxCharacters - characters
    if (remaining <= 0) break
    const text = entry.text.slice(Math.max(0, entry.text.length - remaining))
    if (!text) break
    selected.push({ ...entry, text })
    characters += text.length
    if (entry.role === 'user') userTurns += 1
  }
  selected.reverse()
  const firstUserIndex = selected.findIndex((entry) => entry.role === 'user')
  const bounded = firstUserIndex >= 0 ? selected.slice(firstUserIndex) : selected
  characters = bounded.reduce((total, entry) => total + entry.text.length, 0)
  const first = bounded[0]
  const last = bounded.at(-1)
  if (!first || !last) return null
  return {
    sessionId: last.sessionId,
    startOrdinal: first.ordinal,
    endOrdinal: last.ordinal,
    inputCharacters: characters,
    turnsReviewed: userTurns,
    entries: bounded,
  }
}
