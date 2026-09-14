/** Presentation only: excerpts are never used for authorization or receipt validity. */
export function codingFailureSummary(diagnostic: string): string | null {
  const lines = diagnostic.split('\n').map(line => line.trim())
  const error = lines.find(line => /^(?:[A-Za-z]*Error(?: \[[A-Z_]+\])?:|ERR_[A-Z_]+\b)/.test(line))
  if (!error) return null
  return error.length > 240 ? `${error.slice(0, 237)}…` : error
}

export const PRIVATE_CODING_HISTORY =
  'Coding context or command evidence retained privately. Captured transport output follows its communication approval; ask the Agent for the relevant result.'

export function inboxUpdateLabel(body: string): string {
  const header = body.split('\n').find(line => line.startsWith('--- from '))
  if (!header) return 'Teammate update received'
  const match = /^--- from (.+?) \(message [0-9a-f-]+(?:, reply to [0-9a-f-]+)?\) ---$/.exec(header)
  if (!match) return 'Teammate update received'
  const name = match[1]?.replace(/ \([0-9a-f-]{36}\)$/, '').trim()
  if (!name || /^[0-9a-f-]{36}$/.test(name)) return 'Teammate update received'
  return `Update from ${name.slice(0, 100)}`
}
