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
const HOME_FILES_READABLE = [
  'IDENTITY.md',
  'SOUL.md',
  'BOOTSTRAP.md',
  'AGENTS.md',
  'TOOLS.md',
] as const

const HOME_FILES_WRITABLE = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const

export type PrivateHomeFile = (typeof HOME_FILES_READABLE)[number]
export type PrivateHomeSnapshot = Partial<Record<PrivateHomeFile, string>>

/**
 * Read the complete fixed Agent-document surface without following links.
 * Protected preparation calls this before spawn; prompt construction uses the
 * returned bytes so a planted fixed-name symlink can never inject host data.
 */
export function loadPrivateHomeSnapshot(agentDir: string): PrivateHomeSnapshot {
  const homeRoot = resolvePrivateHomeRoot(agentDir)
  const snapshot: PrivateHomeSnapshot = {}
  for (const file of HOME_FILES_READABLE) {
    const path = privateHomeFile(homeRoot, file)
    try {
      snapshot[file] = readRegularFileNoFollow(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new Error(`private Agent home is unsafe at ${file}`)
    }
  }
  return snapshot
}

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
          throw new Error(`home_write: could not write ${file}: ${msg}`)
        } finally {
          if (fd !== undefined) closeSync(fd)
        }
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
