// Document (non-image) input: store-and-reference.
//
// The model can't perceive arbitrary files (PDFs, CSVs, …) the way it sees
// images. So instead of feeding bytes to the model, we persist each uploaded
// file under the agent's private home and hand the agent a path reference in
// its turn message — it opens/parses the file with its own tools (bash/read,
// or a future doc tool) and decides how to process it. Mirrors how the
// Telegram inbound path handles non-image media.

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment } from '@bazilion/api-types'

/** Per-file ceiling for stored uploads. */
const MAX_FILE_BYTES = 25 * 1024 * 1024

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file'
  return base.replace(/[^\w.-]/g, '_').slice(0, 120) || 'file'
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Persist user-attached files into `<agentDir>/uploads/` and return a reference
 * note to append to the turn message (or '' when there are none). Oversized
 * files are skipped with an explanatory line rather than stored.
 */
export function saveInputFiles(agentDir: string, files: Attachment[] | undefined): string {
  if (!files || files.length === 0) return ''
  const dir = join(agentDir, 'uploads')
  mkdirSync(dir, { recursive: true })
  const lines: string[] = []
  for (const f of files) {
    const label = f.name ?? 'file'
    const buf = Buffer.from(f.data, 'base64')
    if (buf.byteLength > MAX_FILE_BYTES) {
      lines.push(`[attachment "${label}" skipped: too large (${fmtBytes(buf.byteLength)} > 25 MB)]`)
      continue
    }
    // Prefix a short uuid slice so same-named uploads don't clobber each other.
    const path = join(dir, `${randomUUID().slice(0, 8)}-${safeName(label)}`)
    writeFileSync(path, buf)
    lines.push(
      `[file saved to ${path} (${f.mimeType || 'unknown'}, ${fmtBytes(buf.byteLength)}) — open it with your tools]`,
    )
  }
  return lines.join('\n')
}
