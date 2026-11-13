import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type {
  ImportSkillsRequest,
  ImportSkillsResponse,
  ResolvedSkillsResponse,
  SkillInfo,
  SkillScanFinding,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { apiPath, findingLines, positional, printRows } from '../command-helpers.ts'
import { explainScanBlock } from '../errors.ts'

function printFindings(title: string, findings: Record<string, SkillScanFinding[]>): void {
  const flagged = Object.entries(findings).filter(([, list]) => list.length > 0)
  if (flagged.length === 0) return
  console.log('')
  console.log(title)
  for (const [name, list] of flagged) {
    console.log(`${name}:`)
    for (const line of findingLines(list)) console.log(`  ${line}`)
  }
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List installed skills (or those attached to an agent)' },
  args: {
    agent: { type: 'string', description: 'Filter to skills attached to this agent' },
  },
  async run({ args }) {
    const client = createClient()

    if (args.agent) {
      const set = await client.get<ResolvedSkillsResponse>(apiPath('agents', args.agent, 'skills'))
      if (set.resolved.length === 0 && set.missing.length === 0) {
        console.log('(no skills attached to this agent)')
        return
      }
      for (const line of columnize(set.resolved.map((s) => [s.name, s.description]))) {
        console.log(line)
      }
      for (const m of set.missing) console.log(`(missing: ${m.name} — ${m.reason})`)
      return
    }

    const skills = await client.get<SkillInfo[]>('/api/skills')
    printRows(
      skills.map((s) => [s.name, s.parseError ? `(parse error: ${s.parseError})` : s.description]),
      '(no skills installed; use "bazilion skill import" to add some)',
    )
    printFindings(
      'scan findings:',
      Object.fromEntries(skills.map((s) => [s.name, s.scanFindings ?? []])),
    )
  },
})

const importCmd = defineCommand({
  meta: {
    name: 'import',
    description: 'Import skills from openclaw, a directory, or a local .zip archive',
  },
  args: {
    from: {
      type: 'string',
      required: true,
      description:
        'Source: "openclaw", a filesystem path on the server, or a local .zip file to upload',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite existing skills and import despite scan findings',
    },
  },
  async run({ args }) {
    const client = createClient()

    // Auto-detect local .zip uploads: if `--from` points at an existing local
    // file ending in .zip, stream it to the server as multipart. Otherwise
    // send the source as JSON (the server reads openclaw or a server-side path).
    const absFrom = resolve(args.from)
    const isLocalZip =
      args.from.toLowerCase().endsWith('.zip') && existsSync(absFrom) && statSync(absFrom).isFile()

    let request: Promise<ImportSkillsResponse>
    if (isLocalZip) {
      const form = new FormData()
      form.set(
        'file',
        new File([readFileSync(absFrom)], basename(absFrom), { type: 'application/zip' }),
      )
      if (args.force) form.set('force', 'true')
      request = client.postMultipart<ImportSkillsResponse>('/api/skills/import', form)
    } else {
      const body: ImportSkillsRequest = { source: args.from, force: args.force }
      request = client.post<ImportSkillsResponse>('/api/skills/import', body)
    }
    const result = await request.catch(explainScanBlock('--force'))

    if (result.imported.length === 0 && result.skipped.length === 0) {
      console.log('(nothing to import)')
      return
    }
    for (const name of result.imported) console.log(`imported ${name}`)
    for (const s of result.skipped) console.log(`skipped ${s.name}: ${s.reason}`)
    printFindings('confirmed scan findings:', result.findings ?? {})
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove an installed skill' },
  args: { name: positional('Skill name') },
  async run({ args }) {
    await createClient().del(apiPath('skills', args.name))
    console.log(`removed skill ${args.name}`)
  },
})

export const skillCommand = defineCommand({
  meta: { name: 'skill', description: 'Manage the skill library' },
  subCommands: {
    list: listCmd,
    import: importCmd,
    rm: rmCmd,
  },
})
