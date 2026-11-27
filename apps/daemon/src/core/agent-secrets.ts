// Secrets an Agent uses (BAZ-090), kept encrypted in the `secrets` table like Bazilion's own keys,
// each under a key of its Agent's (`agent-secret/<agent id>/<NAME>`). The stored value is JSON
// with the secret, why it was asked for and the hosts web_fetch may send it to. They stay out of
// the settings every turn merges (`mergeSecretsIntoEnv`): only their own Agent's turns get them.

import type { AgentSecret } from '@bazilion/api-types'
import type { BazilionDb } from './db/client.ts'
import { DomainError } from './errors.ts'
import { providersUsingField } from './providers.ts'
import { openSecrets } from './repos/secrets.ts'
import { findFieldByEnvVar } from './services.ts'

const PREFIX = 'agent-secret/'
const NAME = /^[A-Z_][A-Z0-9_]*$/
const NAME_CHARS = 64
const REASON_CHARS = 2000
const HOST_CHARS = 253

/**
 * Names a command's process depends on, or that change what programs load: an Agent's secret
 * under one of them would break or take over its commands.
 */
const PROCESS_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PWD',
  'OLDPWD',
  'TMPDIR',
  'TERM',
  'LANG',
  'LC_ALL',
  'TZ',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'BASH_ENV',
  'ENV',
  'IFS',
  'PS4',
  'SHELLOPTS',
  'PROMPT_COMMAND',
])

export function isAgentSecretKey(key: string): boolean {
  return key.startsWith(PREFIX)
}

function keyOf(agentId: string, name: string): string {
  return `${PREFIX}${agentId}/${name}`
}

/** An environment-variable name that is not one of Bazilion's settings or a process's own. */
export function checkSecretName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!NAME.test(name) || name.length > NAME_CHARS)
    throw new DomainError(
      400,
      `a secret's name is an environment variable name in capitals, such as GITHUB_TOKEN (at most ${NAME_CHARS} characters)`,
    )
  if (
    name.startsWith('BAZILION_') ||
    name.startsWith('DYLD_') ||
    name.startsWith('MCP_') ||
    PROCESS_NAMES.has(name) ||
    findFieldByEnvVar(name) ||
    providersUsingField(name).length > 0
  )
    throw new DomainError(
      400,
      `${name} is a name Bazilion or your commands already use; give the secret another name`,
    )
  return name
}

/** Host names as web_fetch compares them: lower case, no scheme, port or path. */
export function checkSecretHosts(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new DomainError(400, 'hosts is a list of host names')
  const hosts = raw.map((entry) => {
    const host = typeof entry === 'string' ? entry.trim().toLowerCase().replace(/\.$/, '') : ''
    if (
      !host ||
      host.length > HOST_CHARS ||
      !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)
    )
      throw new DomainError(400, `"${String(entry)}" is not a host name, such as api.github.com`)
    return host
  })
  return [...new Set(hosts)]
}

export function checkSecretReason(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw new DomainError(400, 'reason is text')
  const reason = raw.trim()
  if (reason.length > REASON_CHARS)
    throw new DomainError(400, `reason is longer than ${REASON_CHARS} characters`)
  return reason || null
}

interface Stored {
  value: string
  reason: string | null
  hosts: string[]
  storedAt: number
}

/** A secret with its value, for the Agent's turn. */
export interface AgentSecretValue extends AgentSecret {
  value: string
}

function read(json: string, name: string): AgentSecretValue | null {
  try {
    const stored = JSON.parse(json) as Partial<Stored>
    if (typeof stored.value !== 'string') return null
    return {
      name,
      value: stored.value,
      reason: typeof stored.reason === 'string' ? stored.reason : null,
      hosts: Array.isArray(stored.hosts) ? stored.hosts.filter((h) => typeof h === 'string') : [],
      storedAt: typeof stored.storedAt === 'number' ? stored.storedAt : 0,
    }
  } catch {
    return null
  }
}

/** The Agent's secrets with their values, by name. One that does not decrypt is left out. */
export function agentSecretValues(
  db: BazilionDb,
  password: string,
  agentId: string,
): AgentSecretValue[] {
  const prefix = `${PREFIX}${agentId}/`
  return Object.entries(openSecrets(db, password).getAll())
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, json]) => read(json, key.slice(prefix.length)))
    .filter((secret): secret is AgentSecretValue => secret !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The Agent's secrets without their values. */
export function listAgentSecrets(db: BazilionDb, password: string, agentId: string): AgentSecret[] {
  return agentSecretValues(db, password, agentId).map(({ value: _value, ...secret }) => secret)
}

/**
 * Store or replace one of the Agent's secrets. Omitted reason and hosts keep the ones it had.
 * The value is kept as given (a JSON key file keeps its newlines); only an empty one is refused.
 */
export function setAgentSecret(
  db: BazilionDb,
  password: string,
  agentId: string,
  input: { name: string; value: unknown; reason?: unknown; hosts?: unknown },
): AgentSecret {
  const name = checkSecretName(input.name)
  if (typeof input.value !== 'string' || !input.value.trim())
    throw new DomainError(400, 'the secret is empty')
  const store = openSecrets(db, password)
  const before = (() => {
    const json = store.get(keyOf(agentId, name))
    return json ? read(json, name) : null
  })()
  const stored: Stored = {
    value: input.value,
    reason: input.reason === undefined ? (before?.reason ?? null) : checkSecretReason(input.reason),
    hosts: input.hosts === undefined ? (before?.hosts ?? []) : checkSecretHosts(input.hosts),
    storedAt: Date.now(),
  }
  store.set(keyOf(agentId, name), JSON.stringify(stored))
  return { name, reason: stored.reason, hosts: stored.hosts, storedAt: stored.storedAt }
}

/** False when the Agent has no secret of that name. */
export function removeAgentSecret(
  db: BazilionDb,
  password: string,
  agentId: string,
  name: string,
): boolean {
  const store = openSecrets(db, password)
  const key = keyOf(agentId, name)
  if (!store.has(key)) return false
  store.remove(key)
  return true
}

/** Every secret of the Agent, without the password: for deleting the Agent. */
export function removeAllAgentSecrets(db: BazilionDb, agentId: string): void {
  db.raw.run('DELETE FROM secrets WHERE substr(key, 1, ?) = ?', [
    `${PREFIX}${agentId}/`.length,
    `${PREFIX}${agentId}/`,
  ])
}
