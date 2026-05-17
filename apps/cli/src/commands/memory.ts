import type { MemoryEntry, MemoryHit } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

const writeCmd = defineCommand({
  meta: { name: 'write', description: "Write an entry into a group's shared memory" },
  args: {
    group: { type: 'positional', required: true, description: 'Group slug' },
    key: { type: 'positional', required: true, description: 'Memory key (path under memory/)' },
    content: { type: 'positional', required: true, description: 'Content to write' },
  },
  async run({ args }) {
    const client = createClient()
    const entry = await client.put<MemoryEntry>(
      `/api/groups/${args.group}/memory/${encodeKey(args.key)}`,
      { content: args.content },
    )
    console.log(`wrote ${entry.key} (${entry.content.length} bytes)`)
  },
})

const readCmd = defineCommand({
  meta: { name: 'read', description: "Read an entry from a group's shared memory" },
  args: {
    group: { type: 'positional', required: true, description: 'Group slug' },
    key: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const entry = await client.get<MemoryEntry>(
      `/api/groups/${args.group}/memory/${encodeKey(args.key)}`,
    )
    console.log(entry.content)
  },
})

const searchCmd = defineCommand({
  meta: { name: 'search', description: "Search a group's shared memory" },
  args: {
    group: { type: 'positional', required: true, description: 'Group slug' },
    query: { type: 'positional', required: true },
    limit: { type: 'string', description: 'Max results (default 10)' },
  },
  async run({ args }) {
    const client = createClient()
    const limit = args.limit ? Number.parseInt(args.limit, 10) : 10
    const params = new URLSearchParams({ q: args.query, limit: String(limit) })
    const hits = await client.get<MemoryHit[]>(`/api/groups/${args.group}/memory/search?${params}`)
    if (hits.length === 0) {
      console.log('(no matches)')
      return
    }
    for (const h of hits) {
      console.log(`${h.key}\t${h.snippet.replaceAll('\n', ' ')}`)
    }
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: "List all entries in a group's shared memory" },
  args: {
    group: { type: 'positional', required: true, description: 'Group slug' },
  },
  async run({ args }) {
    const client = createClient()
    const all = await client.get<MemoryEntry[]>(`/api/groups/${args.group}/memory`)
    if (all.length === 0) {
      console.log('(no memory entries)')
      return
    }
    for (const e of all) {
      console.log(`${e.key}\t${e.content.length}b`)
    }
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: "Remove an entry from a group's shared memory" },
  args: {
    group: { type: 'positional', required: true, description: 'Group slug' },
    key: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/groups/${args.group}/memory/${encodeKey(args.key)}`)
    console.log(`removed ${args.key}`)
  },
})

export const memoryCommand = defineCommand({
  meta: {
    name: 'memory',
    description: "Manage a group's shared memory (BM25-indexed markdown notes)",
  },
  subCommands: {
    write: writeCmd,
    read: readCmd,
    search: searchCmd,
    list: listCmd,
    rm: rmCmd,
  },
})
