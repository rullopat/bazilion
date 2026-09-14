import type { CodingLogReference } from '@bazilion/api-types'

/**
 * Lift the opaque `{commandId, teamId}` pointer out of a raw coding tool result.
 *
 * A masked history projection has already replaced the tool result text, but the
 * projection runs while pi's transcript still holds the executor's original
 * content. Reading the ids there is what lets a reloaded chat offer the retained
 * output without turning history into a second publication path.
 *
 * This reads ids only — never captured bytes — and a malformed payload yields
 * `null` rather than a partial pointer. `coding_log` pages carry a `commandId`
 * but no `teamId`, so they intentionally yield nothing and degrade to the plain
 * placeholder.
 */
export function codingLogReference(content: unknown): CodingLogReference | null {
  const parsed = objectFrom(textContent(content))
  if (!parsed) return null
  return referenceFrom(parsed) ?? referenceFrom(objectFrom(parsed.receipt))
}

function referenceFrom(value: Record<string, unknown> | null): CodingLogReference | null {
  if (!value) return null
  const commandId = value.id
  const teamId = value.teamId
  if (typeof commandId !== 'string' || commandId.length === 0) return null
  if (typeof teamId !== 'string' || teamId.length === 0) return null
  return { commandId, teamId }
}

/** Stringify a pi tool-result content value the same way the wire projection does. */
function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content as { type?: unknown; text?: unknown }[]) {
    if (block && block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

function objectFrom(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return objectFrom(JSON.parse(value) as unknown)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
