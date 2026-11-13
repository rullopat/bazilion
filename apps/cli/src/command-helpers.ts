import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { createInterface } from 'node:readline'
import type { Attachment, SkillScanFinding } from '@bazilion/api-types'
import { columnize } from './columnize.ts'
import { collectFlagValues } from './repeatable-args.ts'

/** A required positional argument. */
export function positional(description: string) {
  return { type: 'positional', required: true, description } as const
}

export const agentArg = positional('Agent id or prefix')
export const teamArg = positional('Team slug')
export const jsonFlag = { type: 'boolean', description: 'Emit JSON' } as const

/** A daemon API path from its segments, each URL-encoded: `apiPath('agents', id, 'skills')`. */
export function apiPath(...segments: string[]): string {
  return `/api/${segments.map(encodeURIComponent).join('/')}`
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

/** Print rows as aligned columns, or `empty` when there are none. */
export function printRows(rows: string[][], empty: string): void {
  if (rows.length === 0) console.log(empty)
  for (const line of columnize(rows)) console.log(line)
}

/** Ask on stdin and return the trimmed answer; the end of input is an empty answer. */
export function ask(question: string): Promise<string> {
  process.stdout.write(question)
  const input = createInterface({ input: process.stdin })
  return new Promise((resolve) => {
    let answer = ''
    input.once('line', (line) => {
      answer = line
      input.close()
    })
    input.once('close', () => resolve(answer.trim()))
  })
}

/** Ask a yes/no question; only y or yes confirms. */
export async function confirm(question: string): Promise<boolean> {
  return /^y(es)?$/i.test(await ask(`${question} [y/N] `))
}

/** Show control characters (escape sequences, carriage returns, ...) as `\xNN`. */
export function terminalSafe(value: string, keepTabs = false): string {
  let safe = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    const isControl =
      (code <= 31 && code !== 10 && !(keepTabs && code === 9)) || (code >= 127 && code <= 159)
    safe += isControl ? `\\x${code.toString(16).padStart(2, '0')}` : character
  }
  return safe
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const FILE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.zip': 'application/zip',
}

function attachment(path: string, mimeType: string): Attachment {
  return { name: basename(path), mimeType, data: readFileSync(path).toString('base64') }
}

/**
 * The repeatable `--image` and `--file` flags as attachments: images go to the model, files are
 * stored for the Agent to read. citty keeps only the last value of a repeated flag, so the values
 * come from the raw arguments.
 */
export function loadAttachments(rawArgs: string[]): Attachment[] {
  const images = collectFlagValues(rawArgs, 'image').map((path) => {
    const mimeType = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!mimeType) throw new Error(`unsupported image type: ${path} (png/jpg/gif/webp only)`)
    return attachment(path, mimeType)
  })
  const files = collectFlagValues(rawArgs, 'file').map((path) =>
    attachment(path, FILE_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'),
  )
  return [...images, ...files]
}

export function findingLines(findings: SkillScanFinding[]): string[] {
  return findings.map(
    (f) => `${f.severity}: ${f.code}${f.line ? ` line ${f.line}` : ''} - ${f.message}`,
  )
}
