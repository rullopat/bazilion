// Default heartbeat prompt. Users paste this constant as a trigger's
// `message` (or call `resolveHeartbeatPrompt` with a custom one) to wire
// HEARTBEAT.md into a scheduled wake-up without reinventing the framing.
export const HEARTBEAT_PROMPT =
  'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.'

export const DEFAULT_HEARTBEAT_EVERY_SEC = 30 * 60

/**
 * A HEARTBEAT.md is "effectively empty" when it has no actionable task lines.
 * Whitespace, ATX headers, and stub checklist items (`- [ ]`) all count as
 * empty so we can skip a turn when the file has been left as a placeholder.
 * Missing content (undefined/null/non-string) returns false — the LLM should
 * still get a chance to act.
 */
export function isHeartbeatContentEffectivelyEmpty(content: string | undefined | null): boolean {
  if (typeof content !== 'string') return false
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#+(\s|$)/.test(trimmed)) continue
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue
    return false
  }
  return true
}

export function resolveHeartbeatPrompt(raw?: string | null): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || HEARTBEAT_PROMPT
}
