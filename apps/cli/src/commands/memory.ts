import type { MemoryEntry, MemoryHit } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, positional, teamArg } from '../command-helpers.ts'

const keyArg = positional('Memory key (path under memory/, ending in .md)')

/** A key's slashes stay path separators. */
const entryPath = (team: string, key: string) => apiPath('teams', team, 'memory', ...key.split('/'))

const writeCmd = defineCommand({
  meta: { name: 'write', description: "Write an entry into a team's shared memory" },
  args: { team: teamArg, key: keyArg, content: positional('Content to write') },
  async run({ args }) {
    const entry = await createClient().put<MemoryEntry>(entryPath(args.team, args.key), {
      content: args.content,
    })
    console.log(`wrote ${entry.key} (${entry.content.length} bytes)`)
  },
})

const readCmd = defineCommand({
  meta: { name: 'read', description: "Read an entry from a team's shared memory" },
  args: { team: teamArg, key: keyArg },
  async run({ args }) {
    const entry = await createClient().get<MemoryEntry>(entryPath(args.team, args.key))
    console.log(entry.content)
  },
})

const searchCmd = defineCommand({
  meta: { name: 'search', description: "Search a team's shared memory" },
  args: {
    team: teamArg,
    query: positional('Search terms'),
    limit: { type: 'string', description: 'Max results (default 10)' },
  },
  async run({ args }) {
    const limit = args.limit ? Number.parseInt(args.limit, 10) : 10
    const params = new URLSearchParams({ q: args.query, limit: String(limit) })
    const hits = await createClient().get<MemoryHit[]>(
      `${apiPath('teams', args.team, 'memory', 'search')}?${params}`,
    )
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
  meta: { name: 'list', description: "List all entries in a team's shared memory" },
  args: { team: teamArg },
  async run({ args }) {
    const all = await createClient().get<MemoryEntry[]>(apiPath('teams', args.team, 'memory'))
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
  meta: { name: 'rm', description: "Remove an entry from a team's shared memory" },
  args: { team: teamArg, key: keyArg },
  async run({ args }) {
    await createClient().del(entryPath(args.team, args.key))
    console.log(`removed ${args.key}`)
  },
})

export const memoryCommand = defineCommand({
  meta: {
    name: 'memory',
    description: "Manage a team's shared memory (BM25-indexed markdown notes)",
  },
  subCommands: {
    write: writeCmd,
    read: readCmd,
    search: searchCmd,
    list: listCmd,
    rm: rmCmd,
  },
})
