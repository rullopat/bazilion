import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import type { AgentResult, ResultListResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

const idArg = { type: 'positional', required: true } as const
const list = defineCommand({
  meta: { name: 'list', description: 'List saved results released to the operator' },
  args: {
    team: { type: 'string' },
    agent: { type: 'string' },
    limit: { type: 'string', default: '50' },
    offset: { type: 'string', default: '0' },
    json: { type: 'boolean' },
  },
  async run({ args }) {
    const query = new URLSearchParams({ limit: args.limit, offset: args.offset })
    if (args.team) query.set('teamId', args.team)
    if (args.agent) query.set('agentId', args.agent)
    const body = await createClient().get<ResultListResponse>(`/api/results?${query}`)
    if (args.json) return console.log(JSON.stringify(body, null, 2))
    if (!body.results.length) return console.log('(no saved results)')
    for (const line of columnize([
      ['id', 'filename', 'bytes', 'team', 'agent', 'created'],
      ...body.results.map((r) => [
        r.id,
        r.name,
        String(r.byteLength),
        r.teamId,
        r.agentId,
        new Date(r.createdAt).toISOString(),
      ]),
    ]))
      console.log(line)
    console.log(`${body.offset + 1}–${body.offset + body.results.length} of ${body.total}`)
  },
})
const show = defineCommand({
  meta: { name: 'show', description: 'Inspect a saved result and its provenance' },
  args: { id: idArg, json: { type: 'boolean' } },
  async run({ args }) {
    const { result } = await createClient().get<{ result: AgentResult }>(
      `/api/results/${encodeURIComponent(args.id)}`,
    )
    console.log(JSON.stringify(result, null, 2))
  },
})
const download = defineCommand({
  meta: { name: 'download', description: 'Download a saved result to an explicit new file' },
  args: {
    id: idArg,
    output: {
      type: 'string',
      required: true,
      description: 'Destination path; existing files are never overwritten',
    },
  },
  async run({ args }) {
    const bytes = await createClient().binary(
      `/api/results/${encodeURIComponent(args.id)}/download`,
    )
    const fd = openSync(args.output, 'wx', 0o600)
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
    } catch (error) {
      closeSync(fd)
      unlinkSync(args.output)
      throw error
    }
    closeSync(fd)
    console.log(`Saved ${bytes.byteLength} bytes to ${args.output}`)
  },
})
const rm = defineCommand({
  meta: {
    name: 'rm',
    description: 'Delete saved bytes; retained history will report the result as deleted',
  },
  args: { id: idArg, yes: { type: 'boolean' } },
  async run({ args }) {
    if (!args.yes) throw new Error('Pass --yes to permanently delete the saved file bytes')
    await createClient().del(`/api/results/${encodeURIComponent(args.id)}`)
    console.log('Saved file deleted; historical references retain a deletion receipt.')
  },
})
export const resultCommand = defineCommand({
  meta: { name: 'result', description: 'Find, download and delete saved Agent results' },
  subCommands: { list, show, download, rm },
})
