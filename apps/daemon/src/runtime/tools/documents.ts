// Pictures and PDFs an Agent reads (BAZ-091). view_image puts pictures in front of the model:
// files from its workspace or uploads, pages on the web (through the same guard as web_fetch) and
// its saved results. pdf_read gives a PDF's text page by page, in parts like browser_snapshot.
// Both read files as the Agent's file tools do: container paths in Docker, and on the host its
// workspace and uploads only.

import { splitPages } from '../../lib/browser/snapshot.ts'
import type { ResultContent } from '../worker/ipc-protocol.ts'
import { MAX_PICTURE_BYTES, pictureType } from './pictures.ts'
import type { ToolHandler, ToolResultPart } from './types.ts'
import { guardedFetch } from './web-ssrf.ts'

export interface DocumentSources {
  /** A file the Agent names, read as its file tools would. */
  readFile(path: string): Buffer
  /** One of its saved results. */
  readResult?(resultId: string): Promise<ResultContent>
  /** Tests reach a local server. */
  allowPrivate?: boolean
  signal?: AbortSignal
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []

/** A picture from the web, refused past the largest a provider takes. */
async function fetchPicture(url: string, sources: DocumentSources): Promise<Buffer> {
  const { response, release } = await guardedFetch({
    url,
    allowPrivate: sources.allowPrivate ?? false,
    ...(sources.signal ? { signal: sources.signal } : {}),
  })
  try {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const declared = Number(response.headers.get('content-length'))
    if (declared > MAX_PICTURE_BYTES) throw new Error(`larger than ${size(MAX_PICTURE_BYTES)}`)
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_PICTURE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`larger than ${size(MAX_PICTURE_BYTES)}`)
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    await release()
  }
}

export function viewImageTool(sources: DocumentSources): ToolHandler {
  return {
    def: {
      name: 'view_image',
      description:
        'Look at one or more pictures: files in your workspace or uploads, pictures on the web, or your saved results (an image you made, a screenshot). They are shown to you together, in the order given. PNG, JPEG, GIF and WebP.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files, as your file tools name them.',
          },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Pictures on the web (http or https).',
          },
          results: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids of your saved results.',
          },
        },
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const asked = [
        ...strings(args.paths).map((value) => ({ kind: 'path' as const, value })),
        ...strings(args.urls).map((value) => ({ kind: 'url' as const, value })),
        ...strings(args.results).map((value) => ({ kind: 'result' as const, value })),
      ]
      if (asked.length === 0) throw new Error('view_image: give at least one path, url or result')
      const parts: ToolResultPart[] = []
      const problems: string[] = []
      for (const [index, source] of asked.entries()) {
        try {
          let bytes: Buffer
          if (source.kind === 'path') bytes = sources.readFile(source.value)
          else if (source.kind === 'url') bytes = await fetchPicture(source.value, sources)
          else {
            if (!sources.readResult) throw new Error('saved results cannot be read in this turn')
            bytes = Buffer.from((await sources.readResult(source.value)).data, 'base64')
          }
          if (bytes.byteLength > MAX_PICTURE_BYTES)
            throw new Error(`larger than ${size(MAX_PICTURE_BYTES)}`)
          const type = pictureType(bytes)
          if (!type) throw new Error('not a PNG, JPEG, GIF or WebP picture')
          parts.push(
            {
              type: 'text',
              text: `Picture ${index + 1}: ${source.value} (${type.mimeType}, ${size(bytes.byteLength)})`,
            },
            { type: 'image', data: bytes.toString('base64'), mimeType: type.mimeType },
          )
        } catch (error) {
          problems.push(
            `${source.value}: ${error instanceof Error ? error.message : 'could not be read'}`,
          )
        }
      }
      if (parts.length === 0) throw new Error(`view_image: nothing to show. ${problems.join('; ')}`)
      if (problems.length > 0)
        parts.push({ type: 'text', text: `Not shown: ${problems.join('; ')}` })
      return parts
    },
  }
}

/** "3", "2-5", "1,4-6": the page numbers, in order, without repeats. */
export function parsePages(text: string, total: number): number[] {
  const pages = new Set<number>()
  for (const piece of text.split(',')) {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(piece)
    if (!range) throw new Error(`pdf_read: "${text}" is not pages such as 3, 2-5 or 1,4-6`)
    const from = Number(range[1])
    const to = range[2] === undefined ? from : Number(range[2])
    if (from < 1 || to < from || to > total)
      throw new Error(`pdf_read: the PDF has pages 1 to ${total}, not ${piece.trim()}`)
    for (let page = from; page <= to; page += 1) pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

interface PdfText {
  total: number
  /** By page number; read once per turn. */
  pages: Map<number, string>
}

export function pdfReadTool(sources: DocumentSources): ToolHandler {
  // A PDF read in parts is opened once per turn.
  const opened = new Map<string, Promise<{ total: number; text(page: number): Promise<string> }>>()
  const texts = new Map<string, PdfText>()

  async function open(path: string) {
    let document = opened.get(path)
    if (!document) {
      document = (async () => {
        const bytes = sources.readFile(path)
        const { getDocumentProxy } = await import('unpdf')
        const pdf = await getDocumentProxy(new Uint8Array(bytes)).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : ''
          throw new Error(
            /password/i.test(message)
              ? `pdf_read: ${path} is protected with a password`
              : `pdf_read: ${path} is not a PDF that can be read${message ? ` (${message})` : ''}`,
          )
        })
        return {
          total: pdf.numPages,
          async text(page: number) {
            const content = await (await pdf.getPage(page)).getTextContent()
            return content.items
              .map((item) =>
                'str' in item ? `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ''}` : '',
              )
              .join('')
              .replace(/[ \t]+\n/g, '\n')
              .trim()
          },
        }
      })()
      opened.set(path, document)
      document.catch(() => opened.delete(path))
    }
    return document
  }

  return {
    def: {
      name: 'pdf_read',
      description:
        'Read the text of a PDF in your workspace or uploads, page by page. A long result comes in parts: pass part to read the next. A page without text (a scan) is marked as such; there is no OCR.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The PDF, as your file tools name it.' },
          pages: {
            type: 'string',
            description: 'Which pages, such as "3", "2-5" or "1,4-6". All of them by default.',
          },
          part: {
            type: 'integer',
            minimum: 1,
            description: 'Which part of a long result to read (the first is 1).',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      if (!path) throw new Error('pdf_read: path is required')
      const document = await open(path)
      const wanted =
        typeof args.pages === 'string' && args.pages.trim()
          ? parsePages(args.pages, document.total)
          : Array.from({ length: document.total }, (_, index) => index + 1)
      let text = texts.get(path)
      if (!text) {
        text = { total: document.total, pages: new Map() }
        texts.set(path, text)
      }
      const blocks: string[] = []
      for (const page of wanted) {
        let words = text.pages.get(page)
        if (words === undefined) {
          words = await document.text(page)
          text.pages.set(page, words)
        }
        blocks.push(
          words
            ? `--- Page ${page} ---\n${words}`
            : `--- Page ${page}: no text (a scanned page, or only pictures) ---`,
        )
      }
      const parts = splitPages(blocks.join('\n\n'))
      const part = typeof args.part === 'number' && Number.isInteger(args.part) ? args.part : 1
      if (part < 1 || part > parts.length)
        throw new Error(`pdf_read: this read has parts 1 to ${parts.length}`)
      const shown = typeof args.pages === 'string' && args.pages.trim() ? args.pages.trim() : null
      const next =
        part < parts.length
          ? ` — read on with pdf_read ${JSON.stringify({ path, ...(shown ? { pages: shown } : {}), part: part + 1 })}`
          : ''
      return [
        `${path}: ${document.total} page${document.total === 1 ? '' : 's'}${shown ? `, pages ${shown}` : ''}. Part ${part} of ${parts.length}${next}`,
        '',
        parts[part - 1] ?? '',
      ].join('\n')
    },
  }
}
