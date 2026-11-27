// The file tools a turn gets besides Pi's own. On the host, Pi's read, write, edit, grep, find
// and ls work on host paths; in Docker mode the same tools take the container's paths
// (container-paths.ts), so they reach exactly what commands see. `apply_patch` works in both.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, posix, resolve } from 'node:path'
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { applyPatch, type PatchFiles } from '../tools/apply-patch.ts'
import type { ContainerPaths } from './container-paths.ts'

/** The image types Pi's read tool sends to the model, by their first bytes. */
function imageMimeType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  if (bytes.subarray(0, 2).toString('latin1') === 'BM') return 'image/bmp'
  return null
}

/** Errors name container paths, never the host folders behind them. */
function inContainer<T>(paths: ContainerPaths, run: () => T): T {
  try {
    return run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(paths.toContainer(message))
  }
}

type TextPart = { type: 'text'; text: string }
function mapText<R extends { content: Array<TextPart | { type: string }> }>(
  result: R,
  paths: ContainerPaths,
): R {
  return {
    ...result,
    content: result.content.map((part) =>
      part.type === 'text' ? { ...part, text: paths.toContainer((part as TextPart).text) } : part,
    ),
  }
}

/**
 * read, write, edit, grep, find and ls for a Docker turn, on container paths. `paths` is called
 * for every operation, so the mounts are checked when they are used.
 */
export function dockerFileTools(
  containerCwd: string,
  paths: () => ContainerPaths,
): ToolDefinition[] {
  const run = <T>(fn: (p: ContainerPaths) => T) => {
    const p = paths()
    return inContainer(p, () => fn(p))
  }
  const read = createReadToolDefinition(containerCwd, {
    operations: {
      readFile: async (path) => run((p) => p.readFile(path)),
      access: async (path) => run((p) => p.access(path, 'read')),
      detectImageMimeType: async (path) => run((p) => imageMimeType(p.readFile(path))),
    },
  })
  const write = createWriteToolDefinition(containerCwd, {
    operations: {
      writeFile: async (path, content) => run((p) => p.writeFile(path, content)),
      mkdir: async (dir) => run((p) => p.mkdir(dir)),
    },
  })
  const edit = createEditToolDefinition(containerCwd, {
    operations: {
      readFile: async (path) => run((p) => p.readFile(path)),
      writeFile: async (path, content) => run((p) => p.writeFile(path, content)),
      access: async (path) => run((p) => p.access(path, 'write')),
    },
  })
  const ls = createLsToolDefinition(containerCwd, {
    operations: {
      exists: (path) => paths().exists(path),
      stat: (path) => {
        const directory = run((p) => p.isDirectory(path))
        return { isDirectory: () => directory }
      },
      readdir: (path) => run((p) => p.readdir(path)),
    },
  })
  return [
    describedForDocker(read),
    describedForDocker(write),
    describedForDocker(edit),
    describedForDocker(ls),
    searchInContainer('grep', containerCwd, paths),
    searchInContainer('find', containerCwd, paths),
  ]
}

// Each Pi factory returns its own tool type; the session takes them all as plain definitions.
function describedForDocker<T extends { description: string }>(tool: T): ToolDefinition {
  return {
    ...tool,
    description: `${tool.description} Paths are the container's, as commands see them: /workspace (memory/ read-only), /inputs and /skills (read-only).`,
  } as unknown as ToolDefinition
}

/**
 * grep and find run ripgrep and fd on the host folder behind the container path they search; their
 * results name container paths.
 */
function searchInContainer(
  name: 'grep' | 'find',
  containerCwd: string,
  paths: () => ContainerPaths,
): ToolDefinition {
  const create = name === 'grep' ? createGrepToolDefinition : createFindToolDefinition
  const shape = create(containerCwd) as ToolDefinition
  return {
    ...describedForDocker(shape),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const p = paths()
      const args = params as { path?: string }
      const target = posix.resolve(containerCwd, args.path ?? '.')
      const host = inContainer(p, () => p.resolve(target, 'read').host)
      const tool = create(host) as ToolDefinition
      try {
        const result = await tool.execute(
          toolCallId,
          { ...args, path: host },
          signal,
          onUpdate,
          ctx,
        )
        return mapText(result, p)
      } catch (error) {
        throw new Error(p.toContainer(error instanceof Error ? error.message : String(error)))
      }
    },
  }
}

const PATCH_DESCRIPTION = [
  'Apply one patch that adds, changes, moves and deletes files. Every change is checked before any file is written, so a patch with a hunk that does not fit changes nothing.',
  'Format:',
  '*** Begin Patch',
  '*** Add File: path/new.txt',
  '+each line of the new file, after a "+"',
  '*** Update File: path/old.txt',
  '*** Move to: path/renamed.txt   (optional)',
  '@@ a line the hunk comes after   (optional, to place it)',
  ' a line kept as it is (a space first)',
  '-a line removed',
  '+a line added',
  '*** Delete File: path/gone.txt',
  '*** End Patch',
  'Give each hunk a few unchanged lines around the change. Paths are relative to the working directory or absolute.',
].join('\n')

function applyPatchTool(files: () => PatchFiles, extra = ''): ToolDefinition {
  return defineTool({
    name: 'apply_patch',
    label: 'apply_patch',
    description: `${PATCH_DESCRIPTION}${extra}`,
    parameters: Type.Object({
      input: Type.String({
        description: 'The whole patch, from "*** Begin Patch" to "*** End Patch".',
      }),
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      return { content: [{ type: 'text', text: applyPatch(params.input, files()) }], details: {} }
    },
  })
}

/** `apply_patch` on the host: paths relative to the Team workspace, or absolute. */
export function hostApplyPatchTool(cwd: string): ToolDefinition {
  return applyPatchTool(() => ({
    resolve: (path) => resolve(cwd, path),
    exists: (path) => existsSync(path),
    read: (path) => readFileSync(path, 'utf8'),
    write: (path, content) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    },
    remove: (path) => rmSync(path),
  }))
}

/** `apply_patch` in Docker mode: container paths, the same mounts as the other file tools. */
export function dockerApplyPatchTool(
  containerCwd: string,
  paths: () => ContainerPaths,
): ToolDefinition {
  return applyPatchTool(() => {
    const p = paths()
    // Container paths throughout; each operation checks its own.
    return {
      resolve: (path, access) => {
        const target = posix.resolve(containerCwd, path)
        inContainer(p, () => p.resolve(target, access))
        return target
      },
      exists: (path) => p.exists(path),
      read: (path) => inContainer(p, () => p.readFile(path).toString('utf8')),
      write: (path, content) =>
        inContainer(p, () => {
          p.mkdir(posix.dirname(path))
          p.writeFile(path, content)
        }),
      remove: (path) => inContainer(p, () => p.remove(path)),
    }
  }, " Paths are the container's: /workspace (memory/ read-only); /inputs and /skills are read-only.")
}
