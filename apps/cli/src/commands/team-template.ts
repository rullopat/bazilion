import { readFileSync } from 'node:fs'
import type {
  PutTeamTemplateDefinitionRequest,
  TeamTemplateDetail,
  TeamTemplateWithCount,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { ApiClientError, createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import {
  edgeDiff,
  exportTeamDocument,
  parseTeamDocument,
  teamImportBody,
} from '../team-interchange.ts'

function jsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`invalid JSON: ${(error as Error).message}`)
  }
}

function printTeam(detail: TeamTemplateDetail): void {
  console.log(`# ${detail.template.id} — ${detail.template.name}`)
  console.log(`revision: ${detail.template.currentRevision}`)
  console.log(`slots:    ${detail.slots.length}`)
  console.log(`edges:    ${detail.edges.length}`)
  if (detail.slots.length) {
    console.log('')
    for (const line of columnize([
      ['slot', 'profile', 'Agent name', 'model', 'reasoning'],
      ...detail.slots.map((slot, index) => [
        String(index + 1),
        slot.profileId,
        slot.agentName,
        slot.modelOverride ?? '-',
        slot.reasoningLevel ?? '-',
      ]),
    ]))
      console.log(line)
  }
}

const list = defineCommand({
  meta: { name: 'list', description: 'List canonical Team templates' },
  args: { json: { type: 'boolean', description: 'Emit stable JSON' } },
  async run({ args }) {
    const rows = await createClient().get<TeamTemplateWithCount[]>('/api/team-templates')
    if (args.json) return console.log(JSON.stringify(rows, null, 2))
    if (!rows.length) return console.log('(no Team templates)')
    for (const line of columnize([
      ['id', 'revision', 'slots', 'name'],
      ...rows.map((row) => [row.id, String(row.currentRevision), String(row.slotCount), row.name]),
    ]))
      console.log(line)
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Show a canonical Team template' },
  args: {
    id: { type: 'positional', required: true },
    json: { type: 'boolean', description: 'Emit the canonical API aggregate' },
  },
  async run({ args }) {
    const detail = await createClient().get<TeamTemplateDetail>(
      `/api/team-templates/${encodeURIComponent(args.id)}`,
    )
    if (args.json) console.log(JSON.stringify(detail, null, 2))
    else printTeam(detail)
  },
})

const exportCommand = defineCommand({
  meta: {
    name: 'export',
    description: 'Export a portable versioned Team-template document to stdout',
  },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const detail = await createClient().get<TeamTemplateDetail>(
      `/api/team-templates/${encodeURIComponent(args.id)}`,
    )
    console.log(JSON.stringify(exportTeamDocument(detail), null, 2))
  },
})

function printImportDiff(
  current: TeamTemplateDetail | null,
  document: ReturnType<typeof parseTeamDocument>,
): void {
  const before = current ? exportTeamDocument(current) : null
  console.log(`Team: ${current ? current.template.id : '(new)'} -> ${document.template.id}`)
  console.log(`Roster: ${current?.slots.length ?? 0} -> ${document.slots.length}`)
  const previousSlots = new Map(before?.slots.map((slot) => [slot.key, slot]) ?? [])
  const nextSlots = new Map(document.slots.map((slot) => [slot.key, slot]))
  for (const [key, slot] of nextSlots) {
    const previous = previousSlots.get(key)
    if (!previous) console.log(`  + ${key}: ${slot.profileId} / ${slot.agentName}`)
    else if (JSON.stringify(previous) !== JSON.stringify(slot))
      console.log(
        `  ~ ${key}: ${previous.profileId} / ${previous.agentName} -> ${slot.profileId} / ${slot.agentName}`,
      )
  }
  for (const [key, slot] of previousSlots)
    if (!nextSlots.has(key)) console.log(`  - ${key}: ${slot.profileId} / ${slot.agentName}`)
  const toEdge = (edge: (typeof document.edges)[number]) => ({
    sourceKind: edge.sourceKind,
    sourceId: edge.sourceKey,
    targetKind: edge.targetKind,
    targetId: edge.targetKey,
  })
  const diff = edgeDiff(before?.edges.map(toEdge) ?? [], document.edges.map(toEdge))
  console.log(`Edges: +${diff.added.length} -${diff.removed.length}`)
  for (const value of diff.added) console.log(`  + ${value}`)
  for (const value of diff.removed) console.log(`  - ${value}`)
}

const importCommand = defineCommand({
  meta: {
    name: 'import',
    description: 'Validate, diff, and explicitly apply a portable Team-template document',
  },
  args: {
    file: { type: 'positional', required: true, description: 'JSON document path' },
    'dry-run': { type: 'boolean', description: 'Validate and print the resolved diff only' },
    apply: { type: 'boolean', description: 'Apply non-interactively after printing the diff' },
    'expected-revision': {
      type: 'string',
      description: 'Required current revision when replacing an existing Team',
    },
    force: {
      type: 'boolean',
      description: 'Refetch current revision; requires --apply and still uses optimistic locking',
    },
    'confirm-current-revision': {
      type: 'string',
      description: 'Second force confirmation: the freshly displayed current revision',
    },
  },
  async run({ args }) {
    if (args.force && !args.apply)
      throw new Error('--force requires --apply (interactive force is intentionally unsupported)')
    const document = parseTeamDocument(jsonFile(args.file))
    const client = createClient()
    let current: TeamTemplateDetail | null = null
    try {
      current = await client.get<TeamTemplateDetail>(
        `/api/team-templates/${encodeURIComponent(document.template.id)}`,
      )
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.status !== 404) throw error
    }
    printImportDiff(current, document)
    if (args['dry-run']) {
      console.log('valid: no changes applied')
      return
    }
    if (!args.apply) throw new Error('refusing mutation: review the diff, then pass --apply')
    if (!current) {
      const body = teamImportBody(document)
      const created = await client.post<TeamTemplateDetail>('/api/team-templates/import', {
        id: document.template.id,
        name: document.template.name,
        userMd: document.template.userMd,
        slots: document.slots.map((slot, index) => ({
          ...body.slots[index],
          clientKey: slot.key,
        })),
        edges: body.edges,
      })
      console.log(
        `created Team ${created.template.id} at revision ${created.template.currentRevision}`,
      )
      return
    }
    if (
      document.template.name !== current.template.name ||
      document.template.userMd !== current.template.userMd
    )
      throw new Error(
        'replacement document metadata differs; update Team name/USER.md separately before import',
      )
    const supplied = Number.parseInt(args['expected-revision'] ?? '', 10)
    const expectedRevision = args.force ? current.template.currentRevision : supplied
    if (
      args.force &&
      Number.parseInt(args['confirm-current-revision'] ?? '', 10) !==
        current.template.currentRevision
    )
      throw new Error(
        `--force requires --confirm-current-revision ${current.template.currentRevision} after reviewing the fresh diff`,
      )
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('--expected-revision is required when replacing an existing Team')
    const definition = teamImportBody(document, current)
    const body: PutTeamTemplateDefinitionRequest = { expectedRevision, ...definition }
    const updated = await client.put<TeamTemplateDetail>(
      `/api/team-templates/${encodeURIComponent(document.template.id)}/definition`,
      body,
    )
    console.log(
      `updated Team ${updated.template.id} to revision ${updated.template.currentRevision}`,
    )
  },
})

export const teamTemplateCommand = defineCommand({
  meta: {
    name: 'team-template',
    description: 'Inspect and exchange canonical Team templates',
  },
  subCommands: { list, show, export: exportCommand, import: importCommand },
})
