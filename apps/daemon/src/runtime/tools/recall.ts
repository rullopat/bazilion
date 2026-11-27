// `recall`: the older messages of this conversation that a compaction summarized. The model reads
// the summary in their place, but the session file keeps them, so the Agent can search them and
// read them in full when the summary leaves a detail out.

import type { ProviderMessage } from '@bazilion/api-types'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { piMessagesToProviderView } from '../pi/events.ts'
import { conversationHistory } from '../pi/history.ts'
import { redactExactValues } from '../worker/runtime.ts'
import type { ToolHandler } from './types.ts'

export interface RecallSource {
  /** The conversation's branch as it stands: a compaction made during the turn is in it. */
  branch(): readonly SessionEntry[]
  /** Values never shown: the turn's credentials. */
  secrets: readonly string[]
  /** The Agent's other conversations, searched and read by the daemon (`everywhere`). */
  elsewhere?: {
    search(query: string): Promise<string>
    read(conversationId: string, from: number, count?: number): Promise<string>
  }
}

const MAX_WORDS = 8
const MAX_HITS = 12
const READ_COUNT = 5
const MAX_READ = 20
/** The most one read returns, in characters (about 5,000 tokens), shared by its messages. */
const BUDGET = 20_000
const MIN_SHARE = 2_000
const BEFORE = 60
const AFTER = 200

export interface Recalled {
  /** The message's number: its position in the conversation, from 1. */
  number: number
  heading: string
  text: string
}

const NOTHING_SUMMARIZED =
  'Nothing in this conversation has been summarized: every message is still in your context.'

export function recallTool(source: RecallSource): ToolHandler {
  return {
    def: {
      name: 'recall',
      description:
        "Search or read this conversation's older messages that were summarized to make room. When a conversation fills your context, its older messages are replaced by a summary, but they stay saved. When the summary leaves out something you need (an exact value, a link, a file name, the user's own words, what a tool returned), find it here rather than guessing or asking again. Give `query` to list the summarized messages that hold every word, with their numbers; give `from` (a number from a search, or 1 for the start) to read messages in full. With `everywhere: true`, `query` also searches every message of your other conversations, and `conversation` with `from` reads one of them.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'words that must all appear in a message (case is ignored)',
          },
          everywhere: {
            type: 'boolean',
            description:
              'search your other conversations too, every message of them: for something you or the user said or found in an earlier conversation',
          },
          conversation: {
            type: 'string',
            description:
              'with `from`: read messages of another of your conversations, by the id a search with `everywhere` gave',
          },
          from: {
            type: 'integer',
            minimum: 1,
            description: 'the number of the first message to read',
          },
          count: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_READ,
            description: `how many messages to read from \`from\` (default ${READ_COUNT}); long messages are cut, less so when you read fewer`,
          },
        },
      },
    },
    async invoke(args) {
      const elsewhere = source.elsewhere
      if (typeof args.conversation === 'string' && args.conversation) {
        if (!elsewhere) throw new Error('recall: other conversations cannot be read in this turn')
        if (args.from === undefined) throw new Error('recall: give `from` with `conversation`')
        return elsewhere.read(
          args.conversation,
          Number(args.from),
          args.count === undefined ? undefined : Number(args.count),
        )
      }
      if (args.everywhere === true) {
        if (!elsewhere)
          throw new Error('recall: other conversations cannot be searched in this turn')
        if (typeof args.query !== 'string')
          throw new Error('recall: give `query` with `everywhere`')
        const here = summarizedMessages(source)
        const there = await elsewhere.search(args.query)
        return here.length > 0
          ? `In this conversation's summarized part:\n${search(here, args.query)}\n\nIn your other conversations:\n${there}`
          : there
      }
      const summarized = summarizedMessages(source)
      if (summarized.length === 0) return NOTHING_SUMMARIZED
      if (args.from !== undefined) return read(summarized, Number(args.from), args.count)
      if (typeof args.query === 'string') return search(summarized, args.query)
      throw new Error('recall: give `query` to search or `from` to read')
    },
  }
}

/** The messages before the latest compaction's kept part, each as the model once read it. */
function summarizedMessages(source: RecallSource): Recalled[] {
  const { compactions } = conversationHistory(source.branch())
  const end = compactions.at(-1)?.index ?? 0
  return numberedMessages(source.branch(), source.secrets, end)
}

/** A conversation's messages, numbered from 1 and as the model read them; `end` stops early. */
export function numberedMessages(
  branch: readonly SessionEntry[],
  secrets: readonly string[],
  end?: number,
): Recalled[] {
  const { messages } = conversationHistory(branch)
  return messages.slice(0, end ?? messages.length).flatMap((message, index) => {
    const [shown] = piMessagesToProviderView([message], secrets)
    if (!shown) return []
    const at = (message as { timestamp?: unknown }).timestamp
    const when =
      typeof at === 'number' && Number.isFinite(at)
        ? ` · ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`
        : ''
    return [
      {
        number: index + 1,
        heading: `#${index + 1} · ${speaker(shown)}${when}`,
        text: redactExactValues(textOf(shown), secrets),
      },
    ]
  })
}

function speaker(message: ProviderMessage): string {
  if (message.role === 'tool') {
    return `result of ${message.toolName ?? 'a tool'}${message.isError ? ', failed' : ''}`
  }
  return message.role
}

/** What the message said: its text, the tools it called with their arguments, its images. */
function textOf(message: ProviderMessage): string {
  const parts = message.content ? [message.content] : []
  for (const call of message.toolCalls ?? []) parts.push(`[called ${call.name} ${call.arguments}]`)
  const images = message.images?.length ?? 0
  if (images > 0) parts.push(`[${images === 1 ? 'an image' : `${images} images`}]`)
  if (message.stopped) parts.push(`[${message.stopped}]`)
  return parts.join('\n')
}

/** The words of a recall search, checked. */
export function recallWords(query: string): string[] {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
  if (words.join('').length < 2) throw new Error('recall: search for at least two characters')
  if (words.length > MAX_WORDS) throw new Error(`recall: search for at most ${MAX_WORDS} words`)
  return words
}

/** The messages that hold every word, with a snippet each. */
export function recallHits(messages: readonly Recalled[], words: readonly string[]) {
  return messages
    .filter((message) => {
      const lower = message.text.toLowerCase()
      return words.every((word) => lower.includes(word))
    })
    .map((hit) => ({ ...hit, snippet: snippetOf(hit.text, words) }))
}

function search(summarized: readonly Recalled[], query: string): string {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
  if (words.join('').length < 2) throw new Error('recall: search for at least two characters')
  if (words.length > MAX_WORDS) throw new Error(`recall: search for at most ${MAX_WORDS} words`)
  const hits = summarized.filter((message) => {
    const lower = message.text.toLowerCase()
    return words.every((word) => lower.includes(word))
  })
  const of = `of the ${summarized.length} summarized messages`
  if (hits.length === 0) {
    return `None ${of} holds every word of "${query}". Search for fewer or other words, or read from 1.`
  }
  // The latest ones, oldest first: what came last is likeliest to be what the summary stands on.
  const shown = hits.slice(-MAX_HITS)
  const lines = shown.map((hit) => `${hit.heading}: ${snippetOf(hit.text, words)}`)
  const earlier = hits.length - shown.length
  return [
    `${hits.length} ${of} ${hits.length === 1 ? 'holds' : 'hold'} every word of "${query}"${earlier > 0 ? `; the latest ${shown.length}` : ''}:`,
    ...lines,
    ...(earlier > 0
      ? [`${earlier} earlier ones are not listed: add a word to narrow the search.`]
      : []),
    'Read one in full with `from` and its number.',
  ].join('\n')
}

/** The text around the first word found, whitespace folded, with ellipses where it is cut. */
function snippetOf(text: string, words: readonly string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const at = Math.min(...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0))
  const start = Math.max(0, at - BEFORE)
  const end = Math.min(flat.length, at + AFTER)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

export function read(
  summarized: readonly Recalled[],
  from: number,
  rawCount: unknown,
  of = 'summarized',
): string {
  const total = summarized.at(-1)?.number ?? 0
  if (!Number.isInteger(from) || from < 1) throw new Error('recall: `from` is a message number')
  if (from > total) {
    return of === 'summarized'
      ? `Only messages 1 to ${total} were summarized; the later ones are in your context.`
      : `That conversation has ${total} messages.`
  }
  const count = rawCount === undefined ? READ_COUNT : Number(rawCount)
  if (!Number.isInteger(count) || count < 1 || count > MAX_READ) {
    throw new Error(`recall: \`count\` is from 1 to ${MAX_READ}`)
  }
  const share = Math.max(MIN_SHARE, Math.floor(BUDGET / count))
  const blocks: string[] = []
  let used = 0
  let next: number | null = null
  for (const message of summarized) {
    if (message.number < from) continue
    if (blocks.length === count || (blocks.length > 0 && used >= BUDGET)) {
      next = message.number
      break
    }
    const cut = message.text.length > share
    const body = cut
      ? `${message.text.slice(0, share)}… [${(message.text.length - share).toLocaleString('en-US')} more characters cut${count > 1 ? '; read this message alone to see more' : ''}]`
      : message.text
    blocks.push(`${message.heading}\n${body}`)
    used += body.length
  }
  const last = next === null ? total : next - 1
  const head = `Messages ${from} to ${last} of the ${total} ${of}${next === null ? '' : `; read on from ${next}`}:`
  return [head, ...blocks].join('\n\n')
}
