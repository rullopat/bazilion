import { crc32 } from 'node:zlib'
import { expect, test } from 'vitest'
import { uniqueNames, zipStream } from '../../src/lib/zip.ts'
import { readStoredZip } from '../fixtures/zip.ts'

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks)
    chunks.push(value)
  }
}

test('an archive holds every file under its name, bytes intact, read only when reached', async () => {
  const read: string[] = []
  const files = [
    { name: 'report.md', bytes: Buffer.from('# Report\n') },
    { name: 'copertina è.png', bytes: Buffer.from([137, 80, 78, 71, 0, 255]) },
    { name: 'empty.txt', bytes: Buffer.alloc(0) },
  ]
  const stream = zipStream(
    files.map((file) => ({
      name: file.name,
      modifiedAt: Date.UTC(2026, 10, 19, 12, 0, 0),
      read: () => {
        read.push(file.name)
        return file.bytes
      },
    })),
  )
  expect(read).toEqual([])
  const zip = await collect(stream)
  expect(read).toEqual(files.map((file) => file.name))
  const stored = readStoredZip(zip)
  expect(stored.map((file) => file.name)).toEqual(files.map((file) => file.name))
  for (const [index, file] of stored.entries()) {
    expect(file.bytes.equals(files[index]?.bytes ?? Buffer.alloc(1))).toBe(true)
    expect(file.crc).toBe(crc32(file.bytes))
  }
})

test('an empty archive is still a valid zip', async () => {
  expect(readStoredZip(await collect(zipStream([])))).toEqual([])
})

test('files that share a name are numbered before the extension', () => {
  expect(uniqueNames(['cover.png', 'notes', 'cover.png', 'cover.png', 'notes'])).toEqual([
    'cover.png',
    'notes',
    'cover (2).png',
    'cover (3).png',
    'notes (2)',
  ])
})
