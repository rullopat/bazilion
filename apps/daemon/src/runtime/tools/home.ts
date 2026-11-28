import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { noFollowFlag, readRegularFileNoFollow, resolveRealDirectory } from '../safe-files.ts'
import type { ToolHandler } from './types.ts'

// Files the agent may read/write in its private home directory.
// BOOTSTRAP.md is readable but not writable — its lifecycle belongs to
// the `bootstrap_done` tool, not `home_write`.
const HOME_FILES_READABLE = ['IDENTITY.md', 'SOUL.md', 'BOOTSTRAP.md'] as const

const HOME_FILES_WRITABLE = ['IDENTITY.md', 'SOUL.md'] as const

export function homeTools(agentDir: string): ToolHandler[] {
  const homeRoot = resolvePrivateHomeRoot(agentDir)
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
        const path = privateHomeFile(homeRoot, file)
        try {
          return readRegularFileNoFollow(path)
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
          "Overwrite one of your own home files. Use this to update your name, personality, persistent self-definition, or the rules you keep about how you work (in SOUL.md). It replaces the whole file: read it first and keep everything you are not changing; to change one passage or add a rule, `home_edit` is safer. Do NOT use this for work output (use `write` / `edit` — those land in your team's shared directory) or for facts you want to remember (use `memory_write`). BOOTSTRAP.md is not writable here; call `bootstrap_done` to retire it.",
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
        writeHomeFile(homeRoot, file, content, 'home_write')
        return `wrote ${file} (${Buffer.byteLength(content, 'utf8')} bytes)`
      },
    },
    {
      def: {
        name: 'home_edit',
        description:
          'Change one passage of one of your own home files, keeping the rest as it is: `old_text` must appear exactly once and becomes `new_text` (empty removes it). With `old_text` empty, `new_text` is added at the end of the file. Use it to add, change or remove a rule under `## How you work` in SOUL.md, or one line of IDENTITY.md.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', enum: [...HOME_FILES_WRITABLE] },
            old_text: {
              type: 'string',
              description: 'The exact text to change, enough of it to appear once; empty to add',
            },
            new_text: { type: 'string', description: 'What it becomes, or what is added' },
          },
          required: ['file', 'old_text', 'new_text'],
        },
      },
      async invoke(args) {
        const file = String(args.file ?? '')
        if (!HOME_FILES_WRITABLE.includes(file as (typeof HOME_FILES_WRITABLE)[number])) {
          throw new Error(
            `home_edit: "file" must be one of ${HOME_FILES_WRITABLE.join(', ')}; got "${file}"`,
          )
        }
        const oldText = typeof args.old_text === 'string' ? args.old_text : ''
        const newText = typeof args.new_text === 'string' ? args.new_text : ''
        const path = privateHomeFile(homeRoot, file)
        let current: string
        try {
          current = readRegularFileNoFollow(path)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`home_edit: could not read ${file}: ${msg}`)
        }
        let next: string
        if (!oldText) {
          if (!newText)
            throw new Error('home_edit: give `new_text` to add, or `old_text` to change')
          const body = current.trimEnd()
          next = `${body}${body ? '\n\n' : ''}${newText.trim()}\n`
        } else {
          const at = current.indexOf(oldText)
          if (at < 0) {
            throw new Error(
              `home_edit: ${file} does not contain \`old_text\`; read it with home_read`,
            )
          }
          if (current.indexOf(oldText, at + 1) >= 0) {
            throw new Error(
              `home_edit: \`old_text\` appears more than once in ${file}; give more of it`,
            )
          }
          next = current.slice(0, at) + newText + current.slice(at + oldText.length)
        }
        writeHomeFile(homeRoot, file, next, 'home_edit')
        return `changed ${file} (${Buffer.byteLength(next, 'utf8')} bytes)`
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
          const path = privateHomeFile(homeRoot, file)
          try {
            const s = lstatSync(path)
            if (s.isSymbolicLink() || !s.isFile()) continue
            entries.push(`${file} (${s.size}b)`)
          } catch {
            // file not present — skip
          }
        }
        if (entries.length === 0) {
          const dirEntries = (() => {
            try {
              return readdirSync(homeRoot)
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

/** Replace a home file's content, refusing a link or anything but a regular file. */
function writeHomeFile(homeRoot: string, file: string, content: string, tool: string): void {
  const path = privateHomeFile(homeRoot, file)
  let fd: number | undefined
  try {
    rejectExistingSymlinkOrNonFile(path)
    fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag(),
      0o600,
    )
    if (!fstatSync(fd).isFile()) throw new Error('target is not a regular file')
    writeFileSync(fd, content, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${tool}: could not write ${file}: ${msg}`)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function resolvePrivateHomeRoot(agentDir: string): string {
  try {
    return resolveRealDirectory(agentDir)
  } catch {
    throw new Error('home tools require a real private Agent directory')
  }
}

function privateHomeFile(homeRoot: string, file: string): string {
  // `file` has already passed a closed enum check. Keeping path construction
  // here makes the fixed-root boundary explicit for every filesystem call.
  return join(homeRoot, file)
}

function rejectSymlinkOrNonFile(path: string): void {
  const entry = lstatSync(path)
  if (entry.isSymbolicLink()) throw new Error('symbolic links are not allowed')
  if (!entry.isFile()) throw new Error('target is not a regular file')
}

function rejectExistingSymlinkOrNonFile(path: string): void {
  try {
    rejectSymlinkOrNonFile(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw error
  }
}
