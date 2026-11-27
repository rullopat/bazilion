// `deliver_file` — the agent's outbound document channel.
//
// The tool reads a confined workspace file and hands it to the daemon, which saves it as a
// result; the tool result and the chat's `file` event carry the saved result's id.

import { realpathSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ResultReference } from '@bazilion/api-types'
import { ContainedFileError, type ContainedFileRefusal, readContainedFile } from '../safe-files.ts'
import type { ToolHandler } from './types.ts'

const MAX_DELIVER_BYTES = 25 * 1024 * 1024

const REFUSALS: Record<ContainedFileRefusal, string> = {
  outside: 'path must stay within the workspace',
  not_file: 'not a regular file',
  changed: 'path changed during validation',
  too_large: 'file exceeds 25 MiB',
}

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
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

export interface DeliveredFile {
  name: string
  mimeType: string
  /** base64 */
  data: string
}
/** Save a delivered file for the tool call that delivered it. */
export type FileSink = (file: DeliveredFile, toolCallId: string) => Promise<ResultReference>
/** Show one of the Agent's saved results again (a picture made in the background). */
export type ShowResult = (
  resultId: string,
) => Promise<{ result: ResultReference; name: string; mimeType: string }>

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function deliverFileTool(cwd: string, sink: FileSink, show?: ShowResult): ToolHandler {
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
        'Send a file from your workspace to the user so they can download it (web), receive it as a document (Telegram), or save it (CLI). Use this to deliver reports, exports, or any artifact you produced. Max 25 MiB. With `result` instead of `path`, show one of your saved results again (a picture made in the background, say).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to a file, relative to your workspace.',
          },
          result: {
            type: 'string',
            description: 'The id of one of your saved results, instead of a path.',
          },
        },
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      if (typeof args.result === 'string' && args.result) {
        if (!show) throw new Error('deliver_file: saved results cannot be shown in this turn')
        const shown = await show(args.result)
        return {
          content: [
            { type: 'text', text: `Showed "${shown.name}" (result ${shown.result.resultId}).` },
          ],
          details: { results: [shown.result] },
        }
      }
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

      let data: string
      try {
        data = readContainedFile(abs, workspaceRealPath, MAX_DELIVER_BYTES).toString('base64')
      } catch (error) {
        if (error instanceof ContainedFileError)
          throw new Error(`deliver_file: ${REFUSALS[error.reason]}: ${p}`)
        throw new Error(`deliver_file: no such file: ${p}`)
      }

      const name = basename(abs)
      const mimeType = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      if (!context?.toolCallId) throw new Error('deliver_file: missing tool call id')
      const result = await sink({ name, mimeType, data }, context.toolCallId)
      return {
        content: [
          { type: 'text', text: `Saved "${name}" (${mimeType}) as result ${result.resultId}.` },
        ],
        details: { results: [result] },
      }
    },
  }
}
