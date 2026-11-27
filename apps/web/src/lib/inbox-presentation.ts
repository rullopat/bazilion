export function inboxUpdateLabel(body: string): string {
  const header = body.split('\n').find((line) => line.startsWith('--- from '))
  if (!header) return 'Teammate update received'
  const match = /^--- from (.+?) \(message [0-9a-f-]+(?:, reply to [0-9a-f-]+)?\) ---$/.exec(header)
  if (!match) return 'Teammate update received'
  const name = match[1]?.replace(/ \([0-9a-f-]{36}\)$/, '').trim()
  if (!name || /^[0-9a-f-]{36}$/.test(name)) return 'Teammate update received'
  return `Update from ${name.slice(0, 100)}`
}

/** One teammate's message in an inbox wake. */
export interface InboxNote {
  /** The sender's name as the wake gave it (its id when the name was not known). */
  fromName: string
  /** The sender's id, when the header carried one. */
  fromId: string | null
  /** A reply to something the Agent sent, rather than a new request. */
  reply: boolean
  text: string
}

const HEADER = /^--- from (.+?) \(message [0-9a-f-]+(?:, (reply) to [0-9a-f-]+)?\) ---$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// What the daemon writes after the messages (buildInboxPrompt in apps/daemon/src/lib/scheduler.ts):
// its instructions to the Agent, the exchange so far, and the recipient.
const AFTER_MESSAGES = [
  'You MUST reply to the ',
  'The other message',
  'This message is a reply',
  'These messages are replies',
  'These messages continue an exchange',
  '(recipient: ',
]

/**
 * The teammates' messages an inbox wake carried, in order, without Bazilion's instructions to
 * the Agent; null when the wake is not in the form the daemon writes.
 */
export function parseInboxWake(body: string): InboxNote[] | null {
  const lines = body.split('\n')
  const notes: InboxNote[] = []
  const texts: string[][] = []
  for (const [index, line] of lines.entries()) {
    const header = HEADER.exec(line)
    if (header) {
      const label = header[1]?.trim() ?? ''
      const named = /^(.*) \(([0-9a-f-]{36})\)$/.exec(label)
      const fromId = named ? (named[2] ?? null) : UUID.test(label) ? label : null
      notes.push({
        fromName: named?.[1]?.trim() || label,
        fromId,
        reply: Boolean(header[2]),
        text: '',
      })
      texts.push([])
      continue
    }
    const text = texts.at(-1)
    if (!text) continue
    if (lines[index - 1] === '' && AFTER_MESSAGES.some((start) => line.startsWith(start))) break
    text.push(line)
  }
  if (notes.length === 0) return null
  return notes.map((note, index) => ({ ...note, text: (texts[index] ?? []).join('\n').trim() }))
}
