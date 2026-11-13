export function inboxUpdateLabel(body: string): string {
  const header = body.split('\n').find((line) => line.startsWith('--- from '))
  if (!header) return 'Teammate update received'
  const match = /^--- from (.+?) \(message [0-9a-f-]+(?:, reply to [0-9a-f-]+)?\) ---$/.exec(header)
  if (!match) return 'Teammate update received'
  const name = match[1]?.replace(/ \([0-9a-f-]{36}\)$/, '').trim()
  if (!name || /^[0-9a-f-]{36}$/.test(name)) return 'Teammate update received'
  return `Update from ${name.slice(0, 100)}`
}
