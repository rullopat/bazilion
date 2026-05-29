import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CreateProfileRequest,
  FileContentResponse,
  LoadedProfile,
  Profile,
  ProfileFileName,
  PutFileRequest,
  SkillsMode,
  UpdateProfileRequest,
} from '@bazilion/api-types'
import { PROFILE_FILES } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

function splitCsv(v: string | undefined): string[] | undefined {
  if (!v) return undefined
  const out = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return out.length > 0 ? out : undefined
}

function parseSkillsMode(v: string | undefined): SkillsMode | undefined {
  if (v === undefined) return undefined
  if (v === 'all' || v === 'selected') return v
  throw new Error(`--skills-mode must be 'all' or 'selected', got '${v}'`)
}

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Create a new profile' },
  args: {
    id: { type: 'positional', required: true, description: 'Profile slug' },
    name: { type: 'string', description: 'Display name (defaults to slug)' },
    model: {
      type: 'string',
      required: true,
      description: 'Default model, e.g. anthropic:claude-opus-4-8',
    },
    'skills-mode': {
      type: 'string',
      description: "'all' (attach every discovered skill) or 'selected' (default)",
    },
    skills: {
      type: 'string',
      description: 'Default skills, comma-separated (skills-mode=selected)',
    },
    'soul-file': {
      type: 'string',
      description: 'Path to custom SOUL.md content (defaults to the built-in template)',
    },
    'identity-file': {
      type: 'string',
      description: 'Path to custom IDENTITY.md content (defaults to the built-in template)',
    },
    'bootstrap-file': {
      type: 'string',
      description: 'Path to custom BOOTSTRAP.md content (defaults to the built-in template)',
    },
    'skip-bootstrap': {
      type: 'boolean',
      description: 'Skip the bootstrap file entirely (no first-run intro)',
    },
    'agents-file': {
      type: 'string',
      description: 'Path to AGENTS.md content (optional; omit to skip)',
    },
    'tools-file': {
      type: 'string',
      description: 'Path to TOOLS.md content (optional; omit to skip)',
    },
    'heartbeat-file': {
      type: 'string',
      description: 'Path to HEARTBEAT.md content (optional; omit to skip)',
    },
  },
  async run({ args }) {
    const skillsMode = parseSkillsMode(args['skills-mode'])
    const readTemplate = (path: string | undefined): string | undefined =>
      path ? readFileSync(path, 'utf8') : undefined
    const body: CreateProfileRequest = {
      id: args.id,
      name: args.name,
      defaultModel: args.model,
      skillsMode,
      defaultSkills: splitCsv(args.skills),
      soul: readTemplate(args['soul-file']),
      identity: readTemplate(args['identity-file']),
      bootstrap: args['skip-bootstrap']
        ? null
        : (readTemplate(args['bootstrap-file']) ?? undefined),
      agents: readTemplate(args['agents-file']),
      tools: readTemplate(args['tools-file']),
      heartbeat: readTemplate(args['heartbeat-file']),
    }
    const client = createClient()
    const profile = await client.post<Profile>('/api/profiles', body)
    console.log(`created profile ${profile.id} at ${profile.dir}`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List profiles' },
  async run() {
    const client = createClient()
    const list = await client.get<Profile[]>('/api/profiles')
    if (list.length === 0) {
      console.log('(no profiles)')
      return
    }
    const rows = list.map((p) => [p.id, p.defaultModel, p.name])
    for (const line of columnize(rows)) console.log(line)
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show profile details' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const loaded = await client.get<LoadedProfile>(`/api/profiles/${args.id}`)
    console.log(`# ${loaded.profile.id}`)
    console.log(`name:           ${loaded.profile.name}`)
    console.log(`dir:            ${loaded.profile.dir}`)
    console.log(`default model:  ${loaded.profile.defaultModel}`)
    console.log(`skills mode:    ${loaded.profile.skillsMode}`)
    console.log(
      `default skills: ${
        loaded.defaultSkills.length === 0 ? '(none)' : loaded.defaultSkills.join(', ')
      }`,
    )
    console.log(`bootstrap: ${loaded.files.bootstrap !== null ? 'yes' : 'no'}`)
    console.log(`agents:    ${loaded.files.agents !== null ? 'yes' : 'no'}`)
    console.log(`tools:     ${loaded.files.tools !== null ? 'yes' : 'no'}`)
    console.log(`heartbeat: ${loaded.files.heartbeat !== null ? 'yes' : 'no'}`)
    if (loaded.identity) {
      const fields = Object.entries(loaded.identity)
        .filter(([, v]) => typeof v === 'string' && v.length > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      if (fields) console.log(`identity:  ${fields}`)
    }
  },
})

const editCmd = defineCommand({
  meta: { name: 'edit', description: 'Open a profile file in $EDITOR' },
  args: {
    id: { type: 'positional', required: true },
    file: {
      type: 'string',
      default: 'profile.json',
      description: `File: ${PROFILE_FILES.join(', ')}`,
    },
  },
  async run({ args }) {
    if (!(PROFILE_FILES as readonly string[]).includes(args.file)) {
      throw new Error(`unsupported file: ${args.file}. Allowed: ${PROFILE_FILES.join(', ')}`)
    }
    const file = args.file as ProfileFileName
    const client = createClient()
    const { content } = await client.get<FileContentResponse>(
      `/api/profiles/${args.id}/files/${file}`,
    )
    const tmpPath = join(tmpdir(), `bazilion-${args.id}-${file}-${randomBytes(4).toString('hex')}`)
    writeFileSync(tmpPath, content)
    try {
      const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi'
      const code: number = await new Promise((resolve, reject) => {
        const child = spawn(editor, [tmpPath], { stdio: 'inherit' })
        child.on('error', reject)
        child.on('close', (c) => resolve(c ?? 0))
      })
      if (code !== 0) throw new Error(`editor exited with code ${code}`)
      const updated = readFileSync(tmpPath, 'utf8')
      if (updated === content) {
        console.log('(no changes)')
        return
      }
      const body: PutFileRequest = { content: updated }
      await client.put(`/api/profiles/${args.id}/files/${file}`, body)
      console.log(`saved ${file}`)
    } finally {
      try {
        rmSync(tmpPath, { force: true })
      } catch {}
    }
  },
})

const updateCmd = defineCommand({
  meta: {
    name: 'update',
    description: 'Update profile settings (name, model, skills-mode, skills)',
  },
  args: {
    id: { type: 'positional', required: true },
    name: { type: 'string', description: 'New display name' },
    model: { type: 'string', description: 'New default model' },
    'skills-mode': {
      type: 'string',
      description: "Switch to 'all' or 'selected'",
    },
    skills: { type: 'string', description: 'Replacement default skills, comma-separated' },
  },
  async run({ args }) {
    const body: UpdateProfileRequest = {}
    if (args.name !== undefined) body.name = args.name
    if (args.model !== undefined) body.defaultModel = args.model
    const mode = parseSkillsMode(args['skills-mode'])
    if (mode !== undefined) body.skillsMode = mode
    if (args.skills !== undefined) {
      body.defaultSkills = args.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    if (Object.keys(body).length === 0) {
      throw new Error(
        'nothing to update — pass at least one of --name/--model/--skills-mode/--skills',
      )
    }
    const client = createClient()
    const profile = await client.patch<Profile>(`/api/profiles/${args.id}`, body)
    console.log(`updated profile ${profile.id}`)
  },
})

const deleteCmd = defineCommand({
  meta: { name: 'delete', description: 'Permanently delete a profile and its files' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/profiles/${args.id}`)
    console.log(`deleted profile ${args.id}`)
  },
})

export const profileCommand = defineCommand({
  meta: { name: 'profile', description: 'Manage profiles' },
  subCommands: {
    create: createCmd,
    list: listCmd,
    show: showCmd,
    edit: editCmd,
    update: updateCmd,
    delete: deleteCmd,
  },
})
