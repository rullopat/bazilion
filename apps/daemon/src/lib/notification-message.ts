import type { AttentionItem, AttentionKind } from '@bazilion/api-types'
import { isLoopbackHost, resolvePublicOrigin } from './public-origin.ts'

const labels: Record<AttentionKind, { title: string; action: string }> = {
  communication_approval: { title: 'Communication approval required', action: 'Review approvals' },
  lesson_proposal: { title: 'Lesson proposal ready', action: 'Review learning proposals' },
  review_failure: { title: 'Agent review stopped', action: 'Inspect Agent learning' },
  trigger_failure: { title: 'Scheduled trigger failed', action: 'Inspect Agent triggers' },
  agent_loop_break: { title: 'Agent message loop stopped', action: 'Inspect Agent inbox' },
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function display(value: string): string {
  return escapeHtml(
    Array.from(value)
      .slice(0, 80)
      .map((character) => {
        const code = character.codePointAt(0) ?? 0
        return code < 32 || (code >= 127 && code <= 159) ? ' ' : character
      })
      .join(''),
  )
}

/** Resolution paths come from fixed kinds and canonical identifiers, never source-provided URLs. */
function resolutionPath(item: AttentionItem): string | null {
  if (item.kind === 'communication_approval') return '/approvals'
  if (!item.agentId || !/^[a-f0-9-]{36}$/.test(item.agentId)) return null
  const base = `/agents/${item.agentId}`
  switch (item.kind) {
    case 'lesson_proposal':
    case 'review_failure':
      return `${base}/learning`
    case 'agent_loop_break':
      return `${base}/inbox`
    case 'trigger_failure':
      return base
  }
}

/** Input must have passed source/egress authorization immediately before dispatch. */
export function attentionNotificationMessage(
  item: AttentionItem,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const label = labels[item.kind]
  const lines = [
    `<b>${label.title}</b>`,
    `Agent: ${display(item.agentName || item.agentId || 'Unavailable')}`,
    `Team: ${display(item.teamName || item.teamId || 'Unavailable')}`,
    `Source: ${display(item.kind)} / ${display(item.sourceId)}`,
  ]
  let origin: string | null = null
  try {
    origin = resolvePublicOrigin(env).origin
    if (origin) {
      const hostname = new URL(origin).hostname.replace(/\.$/, '')
      if (
        isLoopbackHost(hostname) ||
        hostname.endsWith('.localhost') ||
        hostname.startsWith('127.') ||
        hostname === '0.0.0.0' ||
        hostname === '[::]'
      )
        origin = null
    }
  } catch {
    // A malformed or credential-bearing URL is never a notification link.
  }
  const path = resolutionPath(item)
  lines.push(
    origin && path
      ? `<a href="${escapeHtml(origin + path)}">${label.action}</a> (browser login required)`
      : `Open Bazilion web → Attention → ${label.action}.`,
  )
  lines.push('Receiving or opening this notice does not resolve the item.')
  return lines.join('\n')
}
