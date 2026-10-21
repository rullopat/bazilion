import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import type {
  AgentResult,
  PrivateImageCaptureListResponse,
  PrivateImageDiscardResponse,
  PrivateImageRecoveryResponse,
  ResultListResponse,
} from '@bazilion/api-types'
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
const privateImages = defineCommand({
  meta: {
    name: 'private-images',
    description: 'Inventory retained private image IDs and quota, never image contents',
  },
  args: {
    team: { type: 'string', required: true },
    agent: { type: 'string' },
    limit: { type: 'string', default: '20' },
    offset: { type: 'string', default: '0' },
    json: { type: 'boolean' },
  },
  async run({ args }) {
    const query = new URLSearchParams({ teamId: args.team, limit: args.limit, offset: args.offset })
    if (args.agent) query.set('agentId', args.agent)
    const page = await createClient().get<PrivateImageCaptureListResponse>(
      `/api/results/private-images?${query}`,
    )
    if (args.json) return console.log(JSON.stringify(page, null, 2))
    for (const line of columnize([
      ['id', 'team', 'agent', 'bytes', 'captured'],
      ...page.captures.map((r) => [
        r.id,
        r.teamId,
        r.agentId,
        String(r.byteLength),
        new Date(r.createdAt).toISOString(),
      ]),
    ]))
      console.log(line)
    console.log(
      `${page.total} private captures; ${page.privateBytes} private bytes in selection; ${page.retainedBytes} retained Results bytes/home`,
    )
  },
})
const recoverImage = defineCommand({
  meta: {
    name: 'recover-image',
    description: 'Request policy-gated delivery of one retained image; never generate again',
  },
  args: { id: idArg, team: { type: 'string', required: true }, json: { type: 'boolean' } },
  async run({ args }) {
    const result = await createClient().post<PrivateImageRecoveryResponse>(
      `/api/results/private-images/${encodeURIComponent(args.id)}/recover`,
      { teamId: args.team },
    )
    if (args.json) return console.log(JSON.stringify(result, null, 2))
    if (result.status === 'blocked')
      throw new Error(
        `Image recovery blocked: ${result.reason}${result.approvalStatus ? ` (${result.approvalStatus})` : ''}`,
      )
    if (result.status === 'approval_required')
      return console.log(`Image remains private; approval required: ${result.approvalId}`)
    console.log(`Saved image available in Results: ${result.resultId} (${result.status})`)
  },
})
const discardImage = defineCommand({
  meta: {
    name: 'discard-image',
    description: 'Permanently discard one private orphan image without disclosing it',
  },
  args: { id: idArg, team: { type: 'string', required: true }, yes: { type: 'boolean' } },
  async run({ args }) {
    if (!args.yes) throw new Error('Pass --yes to permanently discard the private image bytes')
    await createClient().post<PrivateImageDiscardResponse>(
      `/api/results/private-images/${encodeURIComponent(args.id)}/discard`,
      { teamId: args.team, confirm: true },
    )
    console.log('Private image discarded; its deletion receipt prevents regeneration.')
  },
})
export const resultCommand = defineCommand({
  meta: { name: 'result', description: 'Find, download and delete saved Agent results' },
  subCommands: {
    list,
    show,
    download,
    rm,
    'private-images': privateImages,
    'recover-image': recoverImage,
    'discard-image': discardImage,
  },
})
