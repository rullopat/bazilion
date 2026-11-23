// What models were used for: tokens and cost per day, Agent, Team, model and conversation, read
// from the Agents' Pi session files. Pi records the usage of every reply (and of conversation
// summaries and cache warm-ups) in the transcript; nothing else stores it. A transcript only grows,
// so each file is read from where the last read stopped and its records are kept in memory; a file
// that shrank or was replaced is read again from the start.

import { closeSync, constants, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ConversationUsage,
  UsageBilling,
  UsageByAgent,
  UsageByModel,
  UsageByTeam,
  UsageDay,
  UsageReport,
  UsageTotals,
} from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import type { Paths } from '../core/paths.ts'
import { PROVIDERS, type ProviderDef } from '../core/providers.ts'

/** One model call, as the transcript records it. */
export interface UsageRecord {
  at: number
  provider: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  cost: number
  /** `cost` is what the provider reported it billed. */
  billed: boolean
}

interface ScannedFile {
  dev: number
  ino: number
  /** Where the next read starts: just after the last complete line. */
  offset: number
  records: UsageRecord[]
  /** The provider and model of the latest reply, for summaries that do not name theirs. */
  lastModel: { provider: string; model: string } | null
}

const CONVERSATION_FILE = /^([0-9a-f-]{36})\.jsonl$/i
const READ_CHUNK = 1024 * 1024
const CACHE_KEY = Symbol.for('bazilion.usage.files')

function cache(): Map<string, ScannedFile> {
  const holder = globalThis as unknown as Record<symbol, Map<string, ScannedFile> | undefined>
  holder[CACHE_KEY] ??= new Map()
  return holder[CACHE_KEY]
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

interface RawUsage {
  input?: unknown
  output?: unknown
  cacheRead?: unknown
  cacheWrite?: unknown
  totalTokens?: unknown
  cost?: { total?: unknown; totalFromProvider?: unknown }
}

function toRecord(
  usage: RawUsage | undefined,
  at: number,
  provider: string,
  model: string,
): UsageRecord | null {
  if (!usage || typeof usage !== 'object') return null
  const input = count(usage.input)
  const output = count(usage.output)
  const cacheRead = count(usage.cacheRead)
  const cacheWrite = count(usage.cacheWrite)
  const total = count(usage.totalTokens) || input + output + cacheRead + cacheWrite
  const cost = count(usage.cost?.total)
  if (total === 0 && cost === 0) return null
  return {
    at,
    provider,
    model,
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    cost,
    billed: usage.cost?.totalFromProvider === true,
  }
}

/** The usage a transcript line records, if any; `file` keeps the latest reply's model. */
export function usageOfLine(
  line: string,
  file: Pick<ScannedFile, 'lastModel'>,
): UsageRecord | null {
  let entry: {
    type?: unknown
    timestamp?: unknown
    provider?: unknown
    model?: unknown
    usage?: RawUsage
    message?: {
      role?: unknown
      provider?: unknown
      model?: unknown
      usage?: RawUsage
      timestamp?: unknown
    }
  }
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }
  if (!entry || typeof entry !== 'object') return null
  const at =
    (typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN) ||
    (typeof entry.message?.timestamp === 'number' ? entry.message.timestamp : 0)
  if (!Number.isFinite(at) || at <= 0) return null
  if (entry.type === 'message' && entry.message?.role === 'assistant') {
    const provider = typeof entry.message.provider === 'string' ? entry.message.provider : ''
    const model = typeof entry.message.model === 'string' ? entry.message.model : ''
    if (provider && model) file.lastModel = { provider, model }
    return toRecord(entry.message.usage, at, provider || 'unknown', model || 'unknown')
  }
  if (entry.type === 'usage') {
    const provider = typeof entry.provider === 'string' ? entry.provider : 'unknown'
    const model = typeof entry.model === 'string' ? entry.model : 'unknown'
    return toRecord(entry.usage, at, provider, model)
  }
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    // A summary is made with the conversation's model, which its entry does not name.
    const last = file.lastModel ?? { provider: 'unknown', model: 'unknown' }
    return toRecord(entry.usage, at, last.provider, last.model)
  }
  return null
}

/** Bring one transcript's records up to date; throws when it cannot be read. */
function scanFile(path: string): ScannedFile {
  const files = cache()
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('not a regular file')
    let file = files.get(path)
    if (!file || file.dev !== stat.dev || file.ino !== stat.ino || stat.size < file.offset) {
      file = { dev: stat.dev, ino: stat.ino, offset: 0, records: [], lastModel: null }
      files.set(path, file)
    }
    // Lines are cut at the byte level, so a character split between two reads stays whole.
    let pending: Buffer = Buffer.alloc(0)
    let position = file.offset
    const chunk = Buffer.alloc(READ_CHUNK)
    while (position < stat.size) {
      const n = readSync(fd, chunk, 0, Math.min(READ_CHUNK, stat.size - position), position)
      if (n === 0) break
      position += n
      const bytes = pending.length ? Buffer.concat([pending, chunk.subarray(0, n)]) : chunk
      const length = pending.length ? bytes.length : n
      const end = bytes.lastIndexOf(0x0a, length - 1)
      if (end < 0) {
        pending = Buffer.from(bytes.subarray(0, length))
        continue
      }
      for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) {
        if (!line.trim()) continue
        const record = usageOfLine(line, file)
        if (record) file.records.push(record)
      }
      // A line still being appended is read again next time.
      pending = Buffer.from(bytes.subarray(end + 1, length))
      file.offset = position - pending.length
    }
    return file
  } finally {
    closeSync(fd)
  }
}

export interface ScannedConversation {
  agentId: string
  conversationId: string
  records: readonly UsageRecord[]
}

/** Every Agent's transcripts, brought up to date; `unreadable` counts those that failed. */
export function scanUsage(
  paths: Paths,
  agentIds: readonly string[],
  options: { everyAgent?: boolean } = {},
): { conversations: ScannedConversation[]; unreadable: number } {
  const conversations: ScannedConversation[] = []
  let unreadable = 0
  const seen = new Set<string>()
  for (const agentId of agentIds) {
    const directory = join(paths.agentDir(agentId), 'sessions')
    let names: string[]
    try {
      names = readdirSync(directory)
    } catch {
      continue
    }
    for (const name of names) {
      const id = CONVERSATION_FILE.exec(name)?.[1]
      if (!id) continue
      const path = join(directory, name)
      seen.add(path)
      try {
        conversations.push({ agentId, conversationId: id, records: scanFile(path).records })
      } catch {
        unreadable++
      }
    }
  }
  // Forget transcripts that are gone: a deleted conversation of a listed Agent, or anything of an
  // Agent that no longer exists when every Agent was listed.
  const listed = agentIds.map((id) => `${join(paths.agentDir(id), 'sessions')}/`)
  for (const path of cache().keys()) {
    if (seen.has(path)) continue
    if (options.everyAgent || listed.some((prefix) => path.startsWith(prefix))) cache().delete(path)
  }
  return { conversations, unreadable }
}

const BY_PI_NAME = new Map<string, ProviderDef>(
  PROVIDERS.map((provider) => [provider.piName ?? provider.id, provider]),
)

export function billingOf(provider: string): UsageBilling {
  const def = BY_PI_NAME.get(provider)
  if (def?.local) return 'local'
  if (def?.plan) return 'plan'
  return 'paid'
}

export const emptyTotals = (): UsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: 0,
  estimated: false,
  planTokens: 0,
  localTokens: 0,
})

export function addRecord(totals: UsageTotals, record: UsageRecord): void {
  const billing = billingOf(record.provider)
  totals.calls++
  totals.inputTokens += record.input
  totals.outputTokens += record.output
  totals.cacheReadTokens += record.cacheRead
  totals.cacheWriteTokens += record.cacheWrite
  totals.totalTokens += record.total
  if (billing === 'plan') totals.planTokens += record.total
  else if (billing === 'local') totals.localTokens += record.total
  else if (record.cost > 0) {
    totals.cost += record.cost
    if (!record.billed) totals.estimated = true
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** A time zone the runtime knows, or null. */
export function validTimeZone(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

/** `YYYY-MM-DD` of a moment in a time zone. */
export function dayOf(at: number, timeZone: string): string {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter.format(at)
}

/** The calendar day `offset` days from `day` (`YYYY-MM-DD`). */
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

interface AgentRow {
  id: string
  name: string
  status: string
  team_id: string
  team_name: string
}

function agentRows(db: BazilionDb): AgentRow[] {
  return db.raw
    .query<AgentRow, []>(
      `SELECT a.id, a.name, a.status, a.team_id, t.name team_name
       FROM agents a JOIN teams t ON t.id = a.team_id`,
    )
    .all()
}

const bySpend = <T extends UsageTotals>(a: T, b: T): number =>
  b.cost - a.cost || b.totalTokens - a.totalTokens

export interface UsageQuery {
  /** Days counted, today included; null for everything saved. */
  days: number | null
  timeZone: string
  agentId?: string
  teamId?: string
  now?: number
}

export function usageReport(db: BazilionDb, paths: Paths, query: UsageQuery): UsageReport {
  const agents = agentRows(db)
  const shown = agents.filter(
    (agent) =>
      (!query.agentId || agent.id === query.agentId) &&
      (!query.teamId || agent.team_id === query.teamId),
  )
  const { conversations, unreadable } = scanUsage(
    paths,
    shown.map((agent) => agent.id),
    { everyAgent: shown.length === agents.length },
  )
  const to = dayOf(query.now ?? Date.now(), query.timeZone)
  const from = query.days === null ? null : shiftDay(to, -(query.days - 1))
  const totals = emptyTotals()
  const days = new Map<string, UsageDay>()
  const byAgent = new Map<string, UsageByAgent>()
  const byTeam = new Map<string, UsageByTeam>()
  const byModel = new Map<string, UsageByModel>()
  if (from !== null) {
    for (let day = from; day <= to; day = shiftDay(day, 1)) days.set(day, { day, ...emptyTotals() })
  }
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  for (const conversation of conversations) {
    const agent = agentById.get(conversation.agentId)
    if (!agent) continue
    for (const record of conversation.records) {
      const day = dayOf(record.at, query.timeZone)
      if ((from !== null && day < from) || day > to) continue
      addRecord(totals, record)
      let dayTotals = days.get(day)
      if (!dayTotals) {
        dayTotals = { day, ...emptyTotals() }
        days.set(day, dayTotals)
      }
      addRecord(dayTotals, record)
      let agentTotals = byAgent.get(agent.id)
      if (!agentTotals) {
        agentTotals = {
          agentId: agent.id,
          agentName: agent.name,
          teamId: agent.team_id,
          teamName: agent.team_name,
          archived: agent.status === 'archived',
          ...emptyTotals(),
        }
        byAgent.set(agent.id, agentTotals)
      }
      addRecord(agentTotals, record)
      let teamTotals = byTeam.get(agent.team_id)
      if (!teamTotals) {
        teamTotals = { teamId: agent.team_id, teamName: agent.team_name, ...emptyTotals() }
        byTeam.set(agent.team_id, teamTotals)
      }
      addRecord(teamTotals, record)
      const modelKey = `${record.provider}\u0000${record.model}`
      let modelTotals = byModel.get(modelKey)
      if (!modelTotals) {
        modelTotals = {
          provider: record.provider,
          providerName: BY_PI_NAME.get(record.provider)?.displayName ?? record.provider,
          model: record.model,
          billing: billingOf(record.provider),
          ...emptyTotals(),
        }
        byModel.set(modelKey, modelTotals)
      }
      addRecord(modelTotals, record)
    }
  }
  return {
    days: query.days,
    timeZone: query.timeZone,
    from,
    to,
    totals,
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byAgent: [...byAgent.values()].sort(bySpend),
    byTeam: [...byTeam.values()].sort(bySpend),
    byModel: [...byModel.values()].sort(bySpend),
    unreadable,
    scope: query.agentId
      ? {
          kind: 'agent',
          id: query.agentId,
          name: agentById.get(query.agentId)?.name ?? query.agentId,
        }
      : query.teamId
        ? {
            kind: 'team',
            id: query.teamId,
            name:
              db.raw
                .query<{ name: string }, [string]>('SELECT name FROM teams WHERE id = ?')
                .get(query.teamId)?.name ?? query.teamId,
          }
        : null,
  }
}

/** Each of an Agent's conversations' use, by conversation id. */
export function conversationUsage(paths: Paths, agentId: string): Map<string, ConversationUsage> {
  const usage = new Map<string, ConversationUsage>()
  for (const conversation of scanUsage(paths, [agentId]).conversations) {
    const totals = emptyTotals()
    for (const record of conversation.records) addRecord(totals, record)
    usage.set(conversation.conversationId, {
      calls: totals.calls,
      totalTokens: totals.totalTokens,
      cost: totals.cost,
      estimated: totals.estimated,
      planTokens: totals.planTokens,
      localTokens: totals.localTokens,
    })
  }
  return usage
}
