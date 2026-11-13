import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import type { AgentResult, ResultListResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { apiPath, jsonFlag, positional, printJson } from '../command-helpers.ts'

const idArg = positional('Result id')

const list = defineCommand({
  meta: { name: 'list', description: 'List saved results' },
  args: {
    team: { type: 'string', description: 'Only results of this Team' },
    agent: { type: 'string', description: 'Only results of this Agent' },
    limit: { type: 'string', default: '50', description: 'Page size' },
    offset: { type: 'string', default: '0', description: 'Results to skip' },
    json: jsonFlag,
  },
  async run({ args }) {
    const query = new URLSearchParams({ limit: args.limit, offset: args.offset })
    if (args.team) query.set('teamId', args.team)
    if (args.agent) query.set('agentId', args.agent)
    const body = await createClient().get<ResultListResponse>(`/api/results?${query}`)
    if (args.json) return printJson(body)
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
  meta: { name: 'show', description: 'Show a saved result: who saved it, where and when' },
  args: { id: idArg },
  async run({ args }) {
    const { result } = await createClient().get<{ result: AgentResult }>(
      apiPath('results', args.id),
    )
    printJson(result)
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
    const bytes = await createClient().binary(apiPath('results', args.id, 'download'))
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
  meta: { name: 'rm', description: 'Delete a saved result' },
  args: { id: idArg, yes: { type: 'boolean', description: 'Required confirmation' } },
  async run({ args }) {
    if (!args.yes) throw new Error('Pass --yes to permanently delete the saved file')
    await createClient().del(apiPath('results', args.id))
    console.log('Saved file deleted.')
  },
})

export const resultCommand = defineCommand({
  meta: { name: 'result', description: 'Find, download and delete saved Agent results' },
  subCommands: {
    list,
    show,
    download,
    rm,
  },
})
