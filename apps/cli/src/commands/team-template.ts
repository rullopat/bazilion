import { readFileSync } from 'node:fs'
import type {
  SaveTeamAsTemplateRequest,
  SpawnTeamTemplateRequest,
  SpawnTeamTemplateResponse,
  TeamTemplate,
  TeamTemplateEndpoint,
  TeamTemplateInput,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { ApiClientError, createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { apiPath, jsonFlag, positional, printJson, teamArg } from '../command-helpers.ts'

const templateArg = positional('Template id')

function endpointLabel(template: TeamTemplate, end: TeamTemplateEndpoint): string {
  return end === 'outside' ? 'outside' : `${end}:${template.slots[end]?.agentName ?? '?'}`
}

function printTemplate(template: TeamTemplate): void {
  console.log(`# ${template.id} — ${template.name}`)
  console.log(`mode:  ${template.policyMode}`)
  if (template.slots.length) {
    console.log('')
    for (const line of columnize([
      ['slot', 'profile', 'Agent name', 'model', 'reasoning'],
      ...template.slots.map((slot, index) => [
        String(index),
        slot.profileId,
        slot.agentName,
        slot.modelOverride ?? '-',
        slot.reasoningLevel ?? '-',
      ]),
    ]))
      console.log(line)
  } else console.log('slots: (none)')
  if (template.edges.length) {
    console.log('')
    for (const line of columnize([
      ['from', 'to'],
      ...template.edges.map((edge) => [
        endpointLabel(template, edge.from),
        endpointLabel(template, edge.to),
      ]),
    ]))
      console.log(line)
  }
}

/** The editable part of a template, as `export` prints and `import` reads it. */
function document(template: TeamTemplate): TeamTemplateInput {
  return {
    id: template.id,
    name: template.name,
    userMd: template.userMd,
    policyMode: template.policyMode,
    slots: template.slots,
    edges: template.edges,
  }
}

const list = defineCommand({
  meta: { name: 'list', description: 'List Team templates' },
  args: { json: jsonFlag },
  async run({ args }) {
    const rows = await createClient().get<TeamTemplate[]>('/api/team-templates')
    if (args.json) return printJson(rows)
    if (!rows.length) return console.log('(no Team templates)')
    for (const line of columnize([
      ['id', 'slots', 'mode', 'name'],
      ...rows.map((row) => [row.id, String(row.slots.length), row.policyMode, row.name]),
    ]))
      console.log(line)
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Show a Team template' },
  args: { id: templateArg, json: jsonFlag },
  async run({ args }) {
    const template = await createClient().get<TeamTemplate>(apiPath('team-templates', args.id))
    if (args.json) printJson(template)
    else printTemplate(template)
  },
})

const create = defineCommand({
  meta: { name: 'create', description: 'Create an empty Team template' },
  args: {
    id: positional('Template slug'),
    name: { type: 'string', description: 'Display name (defaults to the slug)' },
  },
  async run({ args }) {
    const body: TeamTemplateInput = { id: args.id, name: args.name ?? args.id }
    const created = await createClient().post<TeamTemplate>('/api/team-templates', body)
    console.log(`created Team template ${created.id}`)
  },
})

const exportCommand = defineCommand({
  meta: { name: 'export', description: 'Print a Team template as JSON for editing or import' },
  args: { id: templateArg },
  async run({ args }) {
    const template = await createClient().get<TeamTemplate>(apiPath('team-templates', args.id))
    printJson(document(template))
  },
})

const importCommand = defineCommand({
  meta: {
    name: 'import',
    description: 'Create a Team template from JSON, or replace the one with the same id',
  },
  args: { file: positional('JSON from export') },
  async run({ args }) {
    const body = JSON.parse(readFileSync(args.file, 'utf8')) as TeamTemplateInput
    if (typeof body.id !== 'string' || !body.id) throw new Error('the JSON needs an "id"')
    const client = createClient()
    const exists = await client.get<TeamTemplate>(apiPath('team-templates', body.id)).then(
      () => true,
      (error: unknown) => {
        if (error instanceof ApiClientError && error.status === 404) return false
        throw error
      },
    )
    const saved = exists
      ? await client.put<TeamTemplate>(apiPath('team-templates', body.id), body)
      : await client.post<TeamTemplate>('/api/team-templates', body)
    console.log(
      `${exists ? 'replaced' : 'created'} Team template ${saved.id} (${saved.slots.length} slots, ${saved.edges.length} edges)`,
    )
  },
})

const rm = defineCommand({
  meta: { name: 'rm', description: 'Delete a Team template (spawned Teams are unaffected)' },
  args: { id: templateArg },
  async run({ args }) {
    await createClient().del(apiPath('team-templates', args.id))
    console.log(`deleted Team template ${args.id}`)
  },
})

const spawn = defineCommand({
  meta: {
    name: 'spawn',
    description: 'Spawn one Agent per slot into a Team; an unknown Team slug creates the Team',
  },
  args: {
    id: templateArg,
    team: positional('Target Team slug'),
    'user-md-file': { type: 'string', description: 'USER.md for a newly created Team' },
  },
  async run({ args }) {
    const body: SpawnTeamTemplateRequest = {
      teamId: args.team,
      ...(args['user-md-file'] ? { userMd: readFileSync(args['user-md-file'], 'utf8') } : {}),
    }
    const result = await createClient().post<SpawnTeamTemplateResponse>(
      apiPath('team-templates', args.id, 'spawn'),
      body,
    )
    console.log(
      `spawned ${result.agents.length} agent(s) into Team ${result.team.teamId}: ${result.agents.map((agent) => agent.name).join(', ')}`,
    )
  },
})

const save = defineCommand({
  meta: {
    name: 'save',
    description: "Save a live Team's members, edges, mode and USER.md as a new template",
  },
  args: {
    team: teamArg,
    id: positional('New template id'),
    name: { type: 'string', description: 'Display name (defaults to the id)' },
  },
  async run({ args }) {
    const body: SaveTeamAsTemplateRequest = { id: args.id, name: args.name ?? args.id }
    const saved = await createClient().post<TeamTemplate>(
      apiPath('teams', args.team, 'policy', 'save-as-template'),
      body,
    )
    console.log(`saved Team ${args.team} as template ${saved.id} (${saved.slots.length} slots)`)
  },
})

export const teamTemplateCommand = defineCommand({
  meta: { name: 'team-template', description: 'Reusable Team rosters with their allow edges' },
  subCommands: {
    list,
    show,
    create,
    export: exportCommand,
    import: importCommand,
    rm,
    spawn,
    save,
  },
})
