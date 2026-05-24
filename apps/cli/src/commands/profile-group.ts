import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CreateProfileGroupRequest,
  ProfileGroup,
  ProfileGroupDetail,
  ProfileGroupMember,
  ProfileGroupWithCount,
  PutProfileGroupMembersRequest,
  SpawnProfileGroupRequest,
  SpawnProfileGroupResponse,
  UpdateProfileGroupRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Create a new profile group (team template)' },
  args: {
    id: { type: 'positional', required: true, description: 'Profile group slug' },
    name: { type: 'string', description: 'Display name (defaults to slug)' },
    'user-md-file': {
      type: 'string',
      description: 'Path to a starter USER.md; seeded into a freshly-created target group',
    },
  },
  async run({ args }) {
    const body: CreateProfileGroupRequest = { id: args.id }
    if (args.name) body.name = args.name
    if (args['user-md-file']) body.userMd = readFileSync(args['user-md-file'], 'utf8')
    const client = createClient()
    const created = await client.post<ProfileGroup>('/api/profile-groups', body)
    console.log(`created profile group ${created.id}`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List profile groups' },
  async run() {
    const client = createClient()
    const list = await client.get<ProfileGroupWithCount[]>('/api/profile-groups')
    if (list.length === 0) {
      console.log('(no profile groups)')
      return
    }
    const rows = list.map((g) => [g.id, String(g.memberCount), g.name])
    for (const line of columnize(rows)) console.log(line)
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show profile group details + members' },
  args: {
    id: { type: 'positional', required: true },
    json: { type: 'boolean', description: 'Emit full JSON (members + basics)' },
  },
  async run({ args }) {
    const client = createClient()
    const detail = await client.get<ProfileGroupDetail>(`/api/profile-groups/${args.id}`)
    if (args.json) {
      console.log(JSON.stringify(detail, null, 2))
      return
    }
    console.log(`# ${detail.group.id}`)
    console.log(`name:    ${detail.group.name}`)
    console.log(
      `user-md: ${detail.group.userMd ? `${detail.group.userMd.length} chars` : '(none)'}`,
    )
    console.log('')
    if (detail.members.length === 0) {
      console.log('(no members)')
      return
    }
    console.log('members:')
    const rows = [
      ['#', 'profile', 'agent-name', 'model-override', 'reasoning'],
      ...detail.members.map((m) => [
        String(m.position),
        m.profileId,
        m.agentName,
        m.modelOverride ?? '-',
        m.reasoningLevel ?? '-',
      ]),
    ]
    for (const line of columnize(rows)) console.log(`  ${line}`)
  },
})

const updateCmd = defineCommand({
  meta: { name: 'update', description: 'Update profile group basics (name, user-md)' },
  args: {
    id: { type: 'positional', required: true },
    name: { type: 'string', description: 'New display name' },
    'user-md-file': {
      type: 'string',
      description: 'Path to new USER.md content (pass empty string to clear)',
    },
  },
  async run({ args }) {
    const body: UpdateProfileGroupRequest = {}
    if (args.name !== undefined) body.name = args.name
    if (args['user-md-file'] !== undefined) {
      body.userMd = args['user-md-file'] === '' ? null : readFileSync(args['user-md-file'], 'utf8')
    }
    if (Object.keys(body).length === 0) {
      throw new Error('nothing to update — pass at least one of --name/--user-md-file')
    }
    const client = createClient()
    const updated = await client.patch<ProfileGroup>(`/api/profile-groups/${args.id}`, body)
    console.log(`updated profile group ${updated.id}`)
  },
})

interface EditableMember {
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: string | null
}

const editCmd = defineCommand({
  meta: { name: 'edit', description: 'Edit the member array in $EDITOR (JSON)' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const detail = await client.get<ProfileGroupDetail>(`/api/profile-groups/${args.id}`)
    const editable: EditableMember[] = detail.members.map((m) => ({
      profileId: m.profileId,
      agentName: m.agentName,
      modelOverride: m.modelOverride,
      reasoningLevel: m.reasoningLevel,
    }))
    const before = `${JSON.stringify(editable, null, 2)}\n`
    const tmpPath = join(
      tmpdir(),
      `bazilion-profile-group-${args.id}-${randomBytes(4).toString('hex')}.json`,
    )
    writeFileSync(tmpPath, before)
    try {
      const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi'
      const code: number = await new Promise((resolve, reject) => {
        const child = spawn(editor, [tmpPath], { stdio: 'inherit' })
        child.on('error', reject)
        child.on('close', (c) => resolve(c ?? 0))
      })
      if (code !== 0) throw new Error(`editor exited with code ${code}`)
      const after = readFileSync(tmpPath, 'utf8')
      if (after === before) {
        console.log('(no changes)')
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(after)
      } catch (err) {
        throw new Error(`invalid JSON: ${(err as Error).message}`)
      }
      if (!Array.isArray(parsed)) {
        throw new Error('expected a JSON array of members')
      }
      const body: PutProfileGroupMembersRequest = {
        members: parsed.map((s, i) => {
          const row = s as Partial<EditableMember>
          if (!row || typeof row.profileId !== 'string' || typeof row.agentName !== 'string') {
            throw new Error(`member ${i}: profileId and agentName are required strings`)
          }
          return {
            profileId: row.profileId,
            agentName: row.agentName,
            modelOverride: row.modelOverride ?? null,
            reasoningLevel:
              row.reasoningLevel === null || row.reasoningLevel === undefined
                ? null
                : (row.reasoningLevel as PutProfileGroupMembersRequest['members'][number]['reasoningLevel']),
          }
        }),
      }
      await client.put(`/api/profile-groups/${args.id}/members`, body)
      console.log(`saved ${body.members.length} member(s)`)
    } finally {
      try {
        rmSync(tmpPath, { force: true })
      } catch {}
    }
  },
})

const deleteCmd = defineCommand({
  meta: { name: 'delete', description: 'Delete a profile group (does not affect spawned agents)' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/profile-groups/${args.id}`)
    console.log(`deleted profile group ${args.id}`)
  },
})

const spawnCmd = defineCommand({
  meta: { name: 'spawn', description: 'Spawn the whole team into a group (transactional)' },
  args: {
    id: { type: 'positional', required: true },
    group: {
      type: 'string',
      description: 'Target group slug (overrides the template default)',
    },
    'user-md-file': {
      type: 'string',
      description: 'Path to USER.md content to seed (only takes effect on a fresh target group)',
    },
  },
  async run({ args }) {
    const body: SpawnProfileGroupRequest = {}
    if (args.group) body.groupSlug = args.group
    if (args['user-md-file']) body.userMd = readFileSync(args['user-md-file'], 'utf8')
    const client = createClient()
    const result = await client.post<SpawnProfileGroupResponse>(
      `/api/profile-groups/${args.id}/spawn`,
      body,
    )
    console.log(`spawned ${result.agents.length} agent(s) into group ${result.groupSlug}`)
    const rows = result.agents.map((a) => [a.id, a.name])
    for (const line of columnize(rows)) console.log(`  ${line}`)
    if (result.orphanAgentIds && result.orphanAgentIds.length > 0) {
      console.error('')
      console.error(`warning: ${result.orphanAgentIds.length} orphan agent dir(s) left on disk:`)
      for (const id of result.orphanAgentIds) console.error(`  ${id}`)
      process.exitCode = 1
    }
  },
})

export const profileGroupCommand = defineCommand({
  meta: { name: 'profile-group', description: 'Manage profile groups' },
  subCommands: {
    create: createCmd,
    list: listCmd,
    show: showCmd,
    update: updateCmd,
    edit: editCmd,
    delete: deleteCmd,
    spawn: spawnCmd,
  },
})

// Re-export the member type for any callers that want to introspect; not used
// by the CLI directly but keeps the dependency-graph honest.
export type { ProfileGroupMember }
