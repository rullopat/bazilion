// Exchanges between Agents going on now (see agent-loop-guard.ts for what an exchange is): which
// ones, what the turns they woke have used, stopping one, and the exchange so far as a woken
// Agent reads it.

import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ActiveExchange, ConversationUsage, Message } from '@bazilion/api-types'
import { agentRepo, type BazilionDb, messageRepo, type Paths } from '../core/index.ts'
import { cancelAgent } from './agent-cancel.ts'
import { isStoppedExchange, recordExchangeStop } from './agent-loop-guard.ts'
import { signalLiveChange } from './live-signal.ts'
import { addRecord, emptyTotals, usageOfLine } from './usage.ts'

/** The exchange each Agent's running turn was woken by. */
const exchangeTurns = new Map<string, string>()

export function noteExchangeTurn(agentId: string, chainId: string): void {
  exchangeTurns.set(agentId, chainId)
  signalLiveChange()
}

export function endExchangeTurn(agentId: string): void {
  if (exchangeTurns.delete(agentId)) signalLiveChange()
}

/** How much older than an exchange a transcript may look and still be read for its use. */
const UNTOUCHED_MARGIN_MS = 60_000

/** The marker every inbox wake starts with; its prompt names each message as `(message <id>`. */
const INBOX_WAKE = '[[bazilion:inbox-wake]]'
const MESSAGE_ID = /\(message ([0-9a-f-]{36})/g

function userText(entry: unknown): string | null {
  const message = (entry as { message?: { role?: unknown; content?: unknown } } | null)?.message
  if (message?.role !== 'user') return null
  const { content } = message
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
    .join('')
}

function readText(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const { size } = statSync(path)
    const bytes = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const n = readSync(fd, bytes, read, size - read, read)
      if (n === 0) break
      read += n
    }
    return bytes.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * What the turns an exchange woke have used, as Usage counts it: the replies after each inbox
 * wake whose latest message belongs to the exchange, in the transcripts of its Agents.
 */
function exchangeUsage(
  db: BazilionDb,
  paths: Paths,
  messages: readonly Message[],
): ConversationUsage {
  const totals = emptyTotals()
  const chainId = messages[0]?.causalChainId
  const known = new Map(messages.map((message) => [message.id, message]))
  const lookup = (id: string) => known.get(id) ?? messageRepo.get(db, id)
  const since = Math.min(...messages.map((message) => message.createdAt))
  const agents = new Set(messages.map((message) => message.toAgentId))
  for (const agentId of agents) {
    const directory = join(paths.agentDir(agentId), 'sessions')
    let names: string[]
    try {
      names = readdirSync(directory).filter((name) => name.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(directory, name)
      try {
        // A transcript untouched since well before the exchange began has nothing of it. File
        // times can lag the clock by some milliseconds, hence the margin.
        if (statSync(path).mtimeMs < since - UNTOUCHED_MARGIN_MS) continue
        const file: Parameters<typeof usageOfLine>[1] = { lastModel: null }
        let woken = false
        for (const line of readText(path).split('\n')) {
          if (line.includes('"role":"user"')) {
            const text = userText(JSON.parse(line))
            if (text !== null) {
              // A turn belongs to the exchange of its latest message, as its replies do.
              woken = text.startsWith(INBOX_WAKE) && wokenBy(text, lookup) === chainId
              continue
            }
          }
          const record = usageOfLine(line, file)
          if (woken && record) addRecord(totals, record)
        }
      } catch {
        // An unreadable transcript counts nothing; Usage says so on its own page.
      }
    }
  }
  return {
    calls: totals.calls,
    totalTokens: totals.totalTokens,
    cost: totals.cost,
    estimated: totals.estimated,
    planTokens: totals.planTokens,
    localTokens: totals.localTokens,
  }
}

/** The exchange a wake's turn continues: that of its message furthest along, as sending does. */
function wokenBy(text: string, lookup: (id: string) => Message | null | undefined): string | null {
  let latest: Message | null = null
  for (const [, id] of text.matchAll(MESSAGE_ID)) {
    const message = id ? lookup(id) : null
    if (message && (!latest || message.causalHop > latest.causalHop)) latest = message
  }
  return latest?.causalChainId ?? null
}

/** The exchanges a Team's Agents are in now: a message waiting to wake one, or a turn it woke. */
export function activeExchanges(db: BazilionDb, paths: Paths, teamId: string): ActiveExchange[] {
  const chains = new Set([...messageRepo.exchangesWithUnread(db), ...exchangeTurns.values()])
  const exchanges: ActiveExchange[] = []
  for (const chainId of chains) {
    if (isStoppedExchange(db, chainId)) continue
    const messages = messageRepo.listExchange(db, chainId)
    if (messages.length === 0) continue
    const agentIds: string[] = []
    for (const message of messages) {
      for (const id of [message.fromAgentId, message.toAgentId]) {
        if (!agentIds.includes(id)) agentIds.push(id)
      }
    }
    if (!agentIds.some((id) => agentRepo.get(db, id)?.teamId === teamId)) continue
    exchanges.push({
      id: chainId,
      agentIds,
      messages: messages.length,
      startedAt: messages[0]?.createdAt ?? 0,
      lastAt: Math.max(...messages.map((message) => message.createdAt)),
      runningAgentIds: [...exchangeTurns]
        .filter(([, chain]) => chain === chainId)
        .map(([agentId]) => agentId),
      used: exchangeUsage(db, paths, messages),
    })
  }
  return exchanges.sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * Stop an exchange: its unread messages wake no one, the turns it woke are stopped, and any
 * further message in it is refused. False when it has no message or was stopped already.
 */
export function stopExchange(
  db: BazilionDb,
  chainId: string,
): { stopped: boolean; cancelled: string[]; unread: number } {
  if (!recordExchangeStop(db, chainId)) return { stopped: false, cancelled: [], unread: 0 }
  const unread = messageRepo.markExchangeRead(db, chainId)
  const cancelled = [...exchangeTurns]
    .filter(([, chain]) => chain === chainId)
    .map(([agentId]) => agentId)
    .filter((agentId) => cancelAgent(agentId))
  signalLiveChange()
  return { stopped: true, cancelled, unread }
}

/** The messages a woken Agent's history shows in full and, past this many, only the latest. */
const SHOWN_FIRST = 1
const SHOWN_LATEST = 8
const SHOWN_CHARACTERS = 160

/**
 * The exchange so far, for a woken Agent: who wrote to whom and how it began, before the messages
 * that woke it. Null when those messages open their exchange.
 */
export function exchangeSoFar(
  db: BazilionDb,
  woke: readonly Message[],
  causalParentId: string | null,
): string | null {
  const parent = woke.find((message) => message.id === causalParentId)
  if (!parent) return null
  const wokeIds = new Set(woke.map((message) => message.id))
  const before = messageRepo
    .listExchange(db, parent.causalChainId)
    .filter((message) => !wokeIds.has(message.id))
  if (before.length === 0) return null
  const name = (id: string) => agentRepo.get(db, id)?.name ?? id
  const line = (message: Message) => {
    const text = messageRepo.messageText(message.payload).replace(/\s+/g, ' ').trim()
    const shown = text.length > SHOWN_CHARACTERS ? `${text.slice(0, SHOWN_CHARACTERS - 1)}…` : text
    return `- ${name(message.fromAgentId)} → ${name(message.toAgentId)}: ${shown}`
  }
  const first = before.slice(0, SHOWN_FIRST)
  const latest = before.slice(Math.max(SHOWN_FIRST, before.length - SHOWN_LATEST))
  const skipped = before.length - first.length - latest.length
  const opener = before[0]
  return [
    `These messages continue an exchange between Agents that began with ${opener ? name(opener.fromAgentId) : 'an Agent'}'s message to ${opener ? name(opener.toAgentId) : 'another'}. Before them:`,
    ...first.map(line),
    ...(skipped > 0 ? [`- (${skipped} more message${skipped === 1 ? '' : 's'})`] : []),
    ...latest.map(line),
    '',
    'Keep this exchange going only while it moves that first request forward. If it is going in circles, or you are each waiting on the other, send no more messages about it, not even a reply: tell the user in a few lines where it stands and what is missing.',
  ].join('\n')
}
