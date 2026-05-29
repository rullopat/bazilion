// `deliver_file` — the agent's outbound document channel.
//
// The agent produces a file in its workspace (write a report, render a chart,
// zip something up) and calls deliver_file(path) to hand it to the user. The
// file lives on the daemon's filesystem (the worker is a subprocess on the same
// host), so we read it directly, base64-encode it, and emit it as a `file`
// SessionEvent via an injected sink — the worker writes that frame to stdout,
// the daemon forwards it, and each client surfaces it (web download link,
// Telegram document, CLI save-to-disk).

import { readFileSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, resolve } from 'node:path'
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

export function deliverFileTool(cwd: string, sink: FileSink): ToolHandler {
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
            description: 'Path to the file, relative to your workspace or absolute.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const p = String(args.path ?? '')
      if (!p) throw new Error('deliver_file: path is required')
      const abs = isAbsolute(p) ? p : resolve(cwd, p)
      let size: number
      try {
        size = statSync(abs).size
      } catch {
        throw new Error(`deliver_file: no such file: ${p}`)
      }
      if (size > MAX_DELIVER_BYTES) {
        throw new Error(
          `deliver_file: "${basename(abs)}" is too large (${(size / 1024 / 1024).toFixed(1)} MB > 25 MB)`,
        )
      }
      const name = basename(abs)
      const mimeType = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      sink({ name, mimeType, data: readFileSync(abs).toString('base64') })
      return `Delivered "${name}" (${mimeType}) to the user.`
    },
  }
}
