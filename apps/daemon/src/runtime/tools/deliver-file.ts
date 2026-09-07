// `deliver_file` — the agent's outbound document channel.
//
// The tool reads a confined workspace file and awaits daemon-owned publication.
// The sink returns an opaque receipt only after bytes and provenance commit;
// worker events and canonical Pi tool-result details carry that same reference.
// Shared Agent-to-user authorization still owns release to operator surfaces.

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ResultReference } from '@bazilion/api-types'
import type { ToolHandler } from './types.ts'

const MAX_DELIVER_BYTES = 25 * 1024 * 1024

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export interface DeliveredFile {
  name: string
  mimeType: string
  data: string
}
export interface DeliverySource {
  sessionId: string
  toolCallId: string
}
export type FileSink = (file: DeliveredFile, source: DeliverySource) => Promise<ResultReference>

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function deliverFileTool(cwd: string, sink: FileSink, sessionId = ''): ToolHandler {
  const workspacePath = resolve(cwd)
  let workspaceRealPath: string | null = null
  try {
    workspaceRealPath = realpathSync(workspacePath)
  } catch {
    // Keep tool construction side-effect free. Invocation reports the broken
    // workspace only if the agent actually tries to deliver a file.
  }

  return {
    def: {
      name: 'deliver_file',
      description:
        'Send a file from your workspace to the user so they can download it (web), receive it as a document (Telegram), or save it (CLI). Use this to deliver reports, exports, or any artifact you produced. Max 25 MiB. Saved delivery remains subject to Team Policy.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to a file, relative to your workspace.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      const p = String(args.path ?? '')
      if (!p) throw new Error('deliver_file: path is required')
      if (isAbsolute(p)) {
        throw new Error(`deliver_file: path must stay within the workspace: ${p}`)
      }

      const abs = resolve(workspacePath, p)
      if (!isWithin(workspacePath, abs)) {
        throw new Error(`deliver_file: path must stay within the workspace: ${p}`)
      }

      if (!workspaceRealPath) {
        throw new Error('deliver_file: workspace is unavailable')
      }

      let real: string
      let expected: ReturnType<typeof statSync>
      try {
        real = realpathSync(abs)
        expected = statSync(real)
      } catch {
        throw new Error(`deliver_file: no such file: ${p}`)
      }

      if (!isWithin(workspaceRealPath, real)) {
        throw new Error(`deliver_file: path must stay within the workspace: ${p}`)
      }

      // Use a no-follow descriptor after canonical validation. Besides making
      // the regular-file check explicit, this closes the common final-symlink
      // swap window between realpath/stat/read. Non-blocking mode prevents a
      // non-regular path such as a FIFO from hanging before fstat can reject it.
      let fd: number
      try {
        fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      } catch {
        throw new Error(`deliver_file: no such file: ${p}`)
      }

      let data: string
      try {
        const stat = fstatSync(fd)
        if (!stat.isFile()) {
          throw new Error(`deliver_file: not a regular file: ${p}`)
        }
        if (stat.dev !== expected.dev || stat.ino !== expected.ino) {
          throw new Error(`deliver_file: path changed during validation: ${p}`)
        }
        let confirmedReal: string
        try {
          confirmedReal = realpathSync(abs)
        } catch {
          throw new Error(`deliver_file: path changed during validation: ${p}`)
        }
        if (confirmedReal !== real) {
          throw new Error(`deliver_file: path changed during validation: ${p}`)
        }
        if (stat.size > MAX_DELIVER_BYTES) {
          throw new Error(
            `deliver_file: "${basename(abs)}" is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB > 25 MB)`,
          )
        }
        // Bound the read itself, including growth after fstat. Never allocate more
        // than the limit plus one sentinel byte, even for a rapidly growing source.
        const buffer = Buffer.alloc(MAX_DELIVER_BYTES + 1)
        let length = 0
        while (length < buffer.length) {
          const count = readSync(fd, buffer, length, buffer.length - length, null)
          if (count === 0) break
          length += count
        }
        if (length > MAX_DELIVER_BYTES) throw new Error('deliver_file: file exceeds 25 MiB')
        data = buffer.subarray(0, length).toString('base64')
      } finally {
        closeSync(fd)
      }

      const name = basename(abs)
      const mimeType = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      if (!context?.toolCallId || !sessionId)
        throw new Error('deliver_file: missing source operation')
      const result = await sink(
        { name, mimeType, data },
        { sessionId, toolCallId: context.toolCallId },
      )
      return {
        content: [
          {
            type: 'text',
            text: `Saved "${name}" (${mimeType}) as result ${result.resultId}. Delivery is subject to Team Policy.`,
          },
        ],
        result,
      }
    },
  }
}
