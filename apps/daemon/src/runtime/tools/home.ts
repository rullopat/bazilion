import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolHandler } from './types.ts'

// Files the agent may read/write in its private home directory.
// BOOTSTRAP.md is readable but not writable — its lifecycle belongs to
// the `bootstrap_done` tool, not `home_write`.
const HOME_FILES_READABLE = [
  'IDENTITY.md',
  'SOUL.md',
  'BOOTSTRAP.md',
  'AGENTS.md',
  'TOOLS.md',
] as const

const HOME_FILES_WRITABLE = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const

export function homeTools(agentDir: string): ToolHandler[] {
  return [
    {
      def: {
        name: 'home_read',
        description:
          'Read one of your own home files — your identity, soul, or behaviour rules. These files are private to you and are also injected into your system prompt; read them when you need to quote exact wording or check current state.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', enum: [...HOME_FILES_READABLE] },
          },
          required: ['file'],
        },
      },
      async invoke(args) {
        const file = String(args.file ?? '')
        if (!HOME_FILES_READABLE.includes(file as (typeof HOME_FILES_READABLE)[number])) {
          throw new Error(
            `home_read: "file" must be one of ${HOME_FILES_READABLE.join(', ')}; got "${file}"`,
          )
        }
        const path = join(agentDir, file)
        try {
          return readFileSync(path, 'utf8')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`home_read: could not read ${file}: ${msg}`)
        }
      },
    },
    {
      def: {
        name: 'home_write',
        description:
          "Overwrite one of your own home files. Use this to update your name, personality, or persistent self-definition. Do NOT use this for work output (use `write` / `edit` — those land in your team's shared directory) or for facts you want to remember (use `memory_write`). BOOTSTRAP.md is not writable here; call `bootstrap_done` to retire it.",
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', enum: [...HOME_FILES_WRITABLE] },
            content: { type: 'string', description: 'new full file content' },
          },
          required: ['file', 'content'],
        },
      },
      async invoke(args) {
        const file = String(args.file ?? '')
        if (!HOME_FILES_WRITABLE.includes(file as (typeof HOME_FILES_WRITABLE)[number])) {
          throw new Error(
            `home_write: "file" must be one of ${HOME_FILES_WRITABLE.join(', ')}; got "${file}"`,
          )
        }
        const content = typeof args.content === 'string' ? args.content : ''
        const path = join(agentDir, file)
        writeFileSync(path, content, 'utf8')
        return `wrote ${file} (${Buffer.byteLength(content, 'utf8')} bytes)`
      },
    },
    {
      def: {
        name: 'home_list',
        description: 'List your home files with their sizes.',
        parameters: { type: 'object', properties: {} },
      },
      async invoke() {
        const entries: string[] = []
        for (const file of HOME_FILES_READABLE) {
          const path = join(agentDir, file)
          try {
            const s = statSync(path)
            entries.push(`${file} (${s.size}b)`)
          } catch {
            // file not present — skip
          }
        }
        if (entries.length === 0) {
          const dirEntries = (() => {
            try {
              return readdirSync(agentDir)
            } catch {
              return []
            }
          })()
          return `(no home files found; agent dir contains: ${dirEntries.join(', ') || 'nothing'})`
        }
        return entries.join('\n')
      },
    },
  ]
}
