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
import { ApiClientError, createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

function printFindings(findings: SkillScanFinding[], prefix = '  '): void {
  for (const f of findings) {
    const line = f.line ? ` line ${f.line}` : ''
    console.log(`${prefix}${f.severity}: ${f.code}${line} - ${f.message}`)
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
      const set = await client.get<ResolvedSkillsResponse>(`/api/agents/${args.agent}/skills`)
      if (set.resolved.length === 0 && set.missing.length === 0) {
        console.log('(no skills attached to this agent)')
        return
      }
      const rows = set.resolved.map((s) => [s.name, s.description])
      for (const line of columnize(rows)) console.log(line)
      for (const m of set.missing) {
        console.log(`(missing: ${m.name} — ${m.reason})`)
      }
      return
    }

    const skills = await client.get<SkillInfo[]>('/api/skills')
    if (skills.length === 0) {
      console.log('(no skills installed; use "bazilion skill import" to add some)')
      return
    }
    const rows = skills.map((s) => [
      s.name,
      s.parseError ? `(parse error: ${s.parseError})` : s.description,
    ])
    for (const line of columnize(rows)) console.log(line)
    const flagged = skills.filter((s) => s.scanFindings && s.scanFindings.length > 0)
    if (flagged.length > 0) {
      console.log('')
      console.log('scan findings:')
      for (const s of flagged) {
        console.log(`${s.name}:`)
        printFindings(s.scanFindings ?? [])
      }
    }
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
    force: { type: 'boolean', description: 'Overwrite existing skills' },
  },
  async run({ args }) {
    const client = createClient()

    // Auto-detect local .zip uploads: if `--from` points at an existing local
    // file ending in .zip, stream it to the server as multipart. Otherwise
    // fall through to the legacy JSON path (server reads the source directly).
    const absFrom = resolve(args.from)
    const isLocalZip =
      args.from.toLowerCase().endsWith('.zip') && existsSync(absFrom) && statSync(absFrom).isFile()

    let result: ImportSkillsResponse
    try {
      if (isLocalZip) {
        const bytes = readFileSync(absFrom)
        const file = new File([bytes], basename(absFrom), { type: 'application/zip' })
        const fd = new FormData()
        fd.set('file', file)
        if (args.force) fd.set('force', 'true')
        result = await client.postMultipart<ImportSkillsResponse>('/api/skills/import', fd)
      } else {
        const body: ImportSkillsRequest = {
          source: args.from,
          force: args.force,
        }
        result = await client.post<ImportSkillsResponse>('/api/skills/import', body)
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.body.code === 'skill_scan_blocked') {
        console.error(`error: ${err.body.error}`)
        if (err.body.findings && err.body.findings.length > 0) {
          console.error('scan findings:')
          for (const f of err.body.findings) {
            const line = f.line ? ` line ${f.line}` : ''
            console.error(`  ${f.severity}: ${f.code}${line} - ${f.message}`)
          }
        }
        console.error('  hint: inspect the skill, then rerun with --force to confirm')
        process.exitCode = 1
        return
      }
      throw err
    }

    if (result.imported.length === 0 && result.skipped.length === 0) {
      console.log('(nothing to import)')
      return
    }
    for (const name of result.imported) {
      console.log(`imported ${name}`)
    }
    for (const s of result.skipped) {
      console.log(`skipped ${s.name}: ${s.reason}`)
    }
    if (result.findings && Object.keys(result.findings).length > 0) {
      console.log('')
      console.log('confirmed scan findings:')
      for (const [name, findings] of Object.entries(result.findings)) {
        console.log(`${name}:`)
        printFindings(findings)
      }
    }
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove an installed skill' },
  args: {
    name: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/skills/${encodeURIComponent(args.name)}`)
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
