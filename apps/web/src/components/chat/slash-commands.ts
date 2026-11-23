import type { ChatCompactResponse, ChatContextResponse } from '@bazilion/api-types'
import { api, errorMessage } from '../../lib/api'

export const SLASH_HELP = [
  'slash commands:',
  '  /context           — context breakdown (system prompt, tools, skills, history)',
  '  /compact [N]       — summarize the head; keep the last N messages verbatim (default 10)',
  '  /new               — open the list of conversations to start a new one',
  '  /help              — show this list',
].join('\n')

export function parseSlashCommand(text: string): { command: string; rest: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const [command = '', ...rest] = trimmed.split(/\s+/)
  return { command: command.toLowerCase(), rest: rest.join(' ') }
}

/** `/compact N`: the number of trailing messages to keep, or undefined for the daemon default. */
export function parseKeepTail(rest: string): number | undefined {
  const value = Number(rest.trim())
  return rest.trim() && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

export function formatContext(context: ChatContextResponse): string {
  const size = (chars: number, tokens: number) =>
    `${chars.toLocaleString()} chars (~${tokens.toLocaleString()} tok)`
  const lines = [
    `context for ${context.agentId}`,
    `model: ${context.model}`,
    '',
    `system prompt: ${size(context.systemPrompt.chars, context.systemPrompt.tokens)}`,
    ...context.systemPrompt.files.map((f) => `  - ${f.name}: ${f.chars.toLocaleString()} chars`),
    '',
    `tools: ${context.tools.count} (${context.tools.schemaChars.toLocaleString()} chars of schema)`,
    ...context.tools.entries
      .slice(0, 5)
      .map((t) => `  - ${t.name}: ${t.schemaChars.toLocaleString()} chars`),
  ]
  if (context.skills.count > 0) {
    lines.push('', `skills: ${context.skills.count}`)
    for (const skill of context.skills.entries.slice(0, 10)) {
      lines.push(`  - ${skill.name}: ${skill.blockChars.toLocaleString()} chars`)
    }
  }
  lines.push(
    '',
    `history: ${context.history.messageEntries} messages / ${context.history.compactionEntries} compactions`,
    `  ${size(context.history.chars, context.history.tokensEstimate)}`,
    `  bytes on disk: ${formatBytes(context.history.bytes)}`,
    '',
    `TOTAL: ${size(context.totals.chars, context.totals.tokens)}`,
  )
  return lines.join('\n')
}

export function formatCompaction(result: ChatCompactResponse): string {
  return `/compact: ${result.before} → ${result.after} entries (${result.summarized} summarized, ${result.keptTail} kept verbatim; ~${result.tokensBefore.toLocaleString()} → ~${result.tokensAfter.toLocaleString()} tok). reloading…`
}

/** What a slash command needs from the chat it runs in. */
export interface SlashCommandChat {
  /** The Agent's API path. */
  base: string
  /** Messages in the saved history: /compact needs two. */
  messageCount: number
  pushNote: (content: string) => void
  onOpenLibrary: () => void
  /** /compact holds the chat as a turn does, from its request until the answer. */
  setCompacting: (compacting: boolean) => void
}

async function compact(rest: string, chat: SlashCommandChat) {
  if (chat.messageCount < 2) {
    chat.pushNote('/compact: need ≥2 messages to compact')
    return
  }
  chat.setCompacting(true)
  try {
    const result = await api<ChatCompactResponse>(`${chat.base}/chat/compact`, {
      body: { keepTail: parseKeepTail(rest) },
    })
    chat.pushNote(formatCompaction(result))
    setTimeout(() => window.location.reload(), 400)
  } catch (error) {
    chat.pushNote(`/compact failed: ${errorMessage(error)}`)
  } finally {
    chat.setCompacting(false)
  }
}

/** True when `command` is a slash command, which then ran. */
export async function runSlashCommand(
  command: string,
  rest: string,
  chat: SlashCommandChat,
): Promise<boolean> {
  switch (command) {
    case '/help':
      chat.pushNote(SLASH_HELP)
      return true
    case '/context':
      try {
        chat.pushNote(formatContext(await api<ChatContextResponse>(`${chat.base}/chat/context`)))
      } catch (error) {
        chat.pushNote(`/context failed: ${errorMessage(error)}`)
      }
      return true
    case '/new':
      chat.onOpenLibrary()
      return true
    case '/compact':
      await compact(rest, chat)
      return true
    default:
      return false
  }
}
