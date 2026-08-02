// `deliver_file` — the agent's outbound document channel.
//
// The agent produces a file in its workspace (write a report, render a chart,
// zip something up) and calls deliver_file(path) to hand it to the user. The
// file lives on the daemon's filesystem (the worker is a subprocess on the same
// host), so we read it directly, base64-encode it, and emit it as a `file`
// SessionEvent via an injected sink — the worker writes that frame to stdout,
// the daemon forwards it, and each client surfaces it (web download link,
// Telegram document, CLI save-to-disk).

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
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

export type FileSink = (file: { name: string; mimeType: string; data: string }) => void

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function deliverFileTool(cwd: string, sink: FileSink): ToolHandler {
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
        'Send a file from your workspace to the user so they can download it (web), receive it as a document (Telegram), or save it (CLI). Use this to deliver reports, exports, or any artifact you produced. Max 25 MB.',
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
    async invoke(args) {
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
        data = readFileSync(fd).toString('base64')
      } finally {
        closeSync(fd)
      }

      const name = basename(abs)
      const mimeType = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      sink({ name, mimeType, data })
      return `Delivered "${name}" (${mimeType}) to the user.`
    },
  }
}
