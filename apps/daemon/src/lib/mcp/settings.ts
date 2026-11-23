// What a configured MCP server has besides its command or address: environment variables for a
// stdio server (its token, its client id), kept encrypted and given to that server only, and which
// of its tools ask the operator before they run. Both live in the encrypted secrets store, under
// names no Agent environment receives (`toolEnvironment` drops `MCP_ENV_*` and `MCP_ASK_*`).

import type { BazilionDb } from '../../core/db/client.ts'
import { openSecrets } from '../../core/index.ts'

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

const keyOf = (serverId: string) => serverId.replace(/-/g, '').toUpperCase()
const envPrefix = (serverId: string) => `MCP_ENV_${keyOf(serverId)}__`
const askKey = (serverId: string) => `MCP_ASK_${keyOf(serverId)}`

/** A name an environment variable can have. */
export function validEnvName(name: string): boolean {
  return ENV_NAME.test(name)
}

/** The server's own environment variables, values included: for opening it only. */
export function serverEnv(
  db: BazilionDb,
  authToken: string,
  serverId: string,
): Record<string, string> {
  const prefix = envPrefix(serverId)
  return Object.fromEntries(
    Object.entries(openSecrets(db, authToken).getAll())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  )
}

/** The names of the server's environment variables; their values are never shown. */
export function serverEnvNames(db: BazilionDb, authToken: string, serverId: string): string[] {
  return Object.keys(serverEnv(db, authToken, serverId)).sort()
}

/** Set (a string) or remove (null) some of the server's environment variables. */
export function setServerEnv(
  db: BazilionDb,
  authToken: string,
  serverId: string,
  env: Record<string, string | null>,
): void {
  const secrets = openSecrets(db, authToken)
  for (const [name, value] of Object.entries(env)) {
    const key = `${envPrefix(serverId)}${name}`
    if (value === null || value === '') secrets.remove(key)
    else secrets.set(key, value)
  }
}

/**
 * The operator's choices for single tools: true asks before each call, false never does. A tool
 * without a choice follows the default rule (`looksOutward`), so a tool the server adds later is
 * judged by its name too.
 */
export function askChoices(
  db: BazilionDb,
  authToken: string,
  serverId: string,
): Record<string, boolean> {
  const raw = openSecrets(db, authToken).get(askKey(serverId))
  if (raw === undefined) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    )
  } catch {
    return {}
  }
}

/** Replace the choices; null or none goes back to the default rule for every tool. */
export function setAskChoices(
  db: BazilionDb,
  authToken: string,
  serverId: string,
  choices: Record<string, boolean> | null,
): void {
  const secrets = openSecrets(db, authToken)
  if (!choices || Object.keys(choices).length === 0) secrets.remove(askKey(serverId))
  else secrets.set(askKey(serverId), JSON.stringify(choices))
}

/** Forget everything a removed server had. */
export function removeServerSettings(db: BazilionDb, authToken: string, serverId: string): void {
  const secrets = openSecrets(db, authToken)
  for (const name of serverEnvNames(db, authToken, serverId)) {
    secrets.remove(`${envPrefix(serverId)}${name}`)
  }
  secrets.remove(askKey(serverId))
}

// The words of a tool name that send or change something outside. A tool name is split into words
// at `-`, `_`, `.` and lower-to-upper case: `send-mail`, `conversations_add_message`, `createEvent`.
const OUTWARD = new Set([
  'send',
  'post',
  'publish',
  'reply',
  'forward',
  'share',
  'invite',
  'create',
  'update',
  'edit',
  'modify',
  'manage',
  'patch',
  'put',
  'insert',
  'upsert',
  'import',
  'append',
  'copy',
  'rename',
  'move',
  'merge',
  'transfer',
  'assign',
  'schedule',
  'draft',
  'format',
  'sort',
  'mark',
  'delete',
  'remove',
  'archive',
  'trash',
  'upload',
  'write',
  'add',
  'set',
  'cancel',
  'accept',
  'decline',
])

// HTTP methods some servers put in tool names (`API-post-search` reads; `API-patch-page` writes).
const METHOD = new Set(['post', 'put', 'patch'])
const READ = new Set(['search', 'query', 'get', 'list', 'read', 'fetch', 'find', 'retrieve'])

/** Whether a tool's name says it sends or changes something outside. */
export function looksOutward(toolName: string): boolean {
  const words = toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[-_.\s]+/)
  const outward = words.filter((word) => OUTWARD.has(word))
  if (outward.length === 0) return false
  // A search or a query sent as a POST changes nothing.
  return !(outward.every((word) => METHOD.has(word)) && words.some((word) => READ.has(word)))
}

/** Whether this tool of the server asks first: the operator's choice, or else the default rule. */
export function toolAsks(choices: Record<string, boolean>, toolName: string): boolean {
  return choices[toolName] ?? looksOutward(toolName)
}
