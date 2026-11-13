import { type AttentionItem, isLoopbackHost, publicOriginConfig } from '@bazilion/api-types'
import { htmlEscape } from './telegram/html.ts'

/** One line of untrusted text: control characters become spaces, at most 80 characters. */
function display(value: string): string {
  const line = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : character
  })
  return htmlEscape(line.slice(0, 80).join(''))
}

/** A link only works through a published (non-loopback) web origin. */
function publicOrigin(env: NodeJS.ProcessEnv): string | null {
  try {
    const origin = publicOriginConfig(env.BAZILION_PUBLIC_ORIGIN).origin
    if (!origin) return null
    const hostname = new URL(origin).hostname.replace(/\.$/, '')
    return isLoopbackHost(hostname) || hostname.endsWith('.localhost') || /^127\./.test(hostname)
      ? null
      : origin
  } catch {
    return null
  }
}

/** Telegram HTML for one Attention item. */
export function attentionNotificationMessage(
  item: AttentionItem,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const lines = [`<b>${display(item.title)}</b>`]
  if (item.agentName)
    lines.push(
      `Agent: ${display(item.agentName)}${item.teamName ? ` · Team: ${display(item.teamName)}` : ''}`,
    )
  const origin = publicOrigin(env)
  lines.push(
    origin && item.href.startsWith('/')
      ? `<a href="${htmlEscape(origin + item.href).replace(/"/g, '&quot;')}">Open in Bazilion</a>`
      : 'Open Bazilion → Attention to resolve it.',
  )
  return lines.join('\n')
}
