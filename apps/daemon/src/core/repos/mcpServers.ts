import { randomUUID } from 'node:crypto'
import type { McpServer, McpTransport } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawRow {
  id: string
  name: string
  transport: string
  command: string | null
  args: string
  url: string | null
  has_auth: number
  enabled: number
  created_at: number
  updated_at: number
}

function toServer(r: RawRow): McpServer {
  let args: string[] = []
  try {
    const parsed = JSON.parse(r.args)
    if (Array.isArray(parsed)) args = parsed.filter((a): a is string => typeof a === 'string')
  } catch {}
  return {
    id: r.id,
    name: r.name,
    transport: r.transport as McpTransport,
    command: r.command,
    args,
    url: r.url,
    hasAuthToken: r.has_auth === 1,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export interface InsertMcpServerInput {
  name: string
  transport: McpTransport
  command?: string | null
  args?: string[]
  url?: string | null
  hasAuth?: boolean
  enabled?: boolean
}

export function insert(db: BazilionDb, input: InsertMcpServerInput): McpServer {
  const id = randomUUID()
  const now = Date.now()
  db.raw.run(
    `INSERT INTO mcp_servers (id, name, transport, command, args, url, has_auth, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.transport,
      input.command ?? null,
      JSON.stringify(input.args ?? []),
      input.url ?? null,
      input.hasAuth ? 1 : 0,
      input.enabled === false ? 0 : 1,
      now,
      now,
    ],
  )
  const row = get(db, id)
  if (!row) throw new Error('mcp server insert failed')
  return row
}

export function get(db: BazilionDb, id: string): McpServer | null {
  const row = db.raw.query<RawRow, [string]>('SELECT * FROM mcp_servers WHERE id = ?').get(id)
  return row ? toServer(row) : null
}

export function getByName(db: BazilionDb, name: string): McpServer | null {
  const row = db.raw.query<RawRow, [string]>('SELECT * FROM mcp_servers WHERE name = ?').get(name)
  return row ? toServer(row) : null
}

export function list(db: BazilionDb): McpServer[] {
  return db.raw
    .query<RawRow, []>('SELECT * FROM mcp_servers ORDER BY created_at ASC')
    .all()
    .map(toServer)
}

export function listEnabled(db: BazilionDb): McpServer[] {
  return db.raw
    .query<RawRow, []>('SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY created_at ASC')
    .all()
    .map(toServer)
}

export interface UpdateMcpServerInput {
  name?: string
  transport?: McpTransport
  command?: string | null
  args?: string[]
  url?: string | null
  enabled?: boolean
  hasAuth?: boolean
}

export function update(db: BazilionDb, id: string, input: UpdateMcpServerInput): McpServer | null {
  const existing = get(db, id)
  if (!existing) return null
  const next = {
    name: input.name ?? existing.name,
    transport: input.transport ?? existing.transport,
    command: input.command !== undefined ? input.command : existing.command,
    args: input.args ?? existing.args,
    url: input.url !== undefined ? input.url : existing.url,
    enabled: input.enabled ?? existing.enabled,
    hasAuth: input.hasAuth ?? existing.hasAuthToken,
  }
  db.raw.run(
    `UPDATE mcp_servers
       SET name = ?, transport = ?, command = ?, args = ?, url = ?, enabled = ?, has_auth = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.name,
      next.transport,
      next.command,
      JSON.stringify(next.args),
      next.url,
      next.enabled ? 1 : 0,
      next.hasAuth ? 1 : 0,
      Date.now(),
      id,
    ],
  )
  return get(db, id)
}

export function setEnabled(db: BazilionDb, id: string, enabled: boolean): void {
  db.raw.run('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?', [
    enabled ? 1 : 0,
    Date.now(),
    id,
  ])
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM mcp_servers WHERE id = ?', [id])
}
