// A zip archive written without compression ("stored"), streamed one file at a time. Enough for
// handing saved results over as one download: no dependency, and the files (mostly images) would
// not shrink anyway. Sizes stay below 4 GiB, so no ZIP64 records.

import { crc32 } from 'node:zlib'

export interface ZipEntry {
  name: string
  /** Epoch milliseconds, kept as the file's modification time. */
  modifiedAt: number
  /** Read the bytes when the archive reaches this file. */
  read: () => Uint8Array
}

const UTF8_NAMES = 0x0800

/** MS-DOS time and date, the format a zip header carries. */
function dosDateTime(epochMs: number): { time: number; date: number } {
  const d = new Date(epochMs)
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Give repeated names a number before their extension: `cover.png`, `cover (2).png`. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    if (count === 1) return name
    const dot = name.lastIndexOf('.')
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`
  })
}

function localHeader(name: Buffer, bytes: Uint8Array, crc: number, epochMs: number): Buffer {
  const { time, date } = dosDateTime(epochMs)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(UTF8_NAMES, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(bytes.byteLength, 18)
  header.writeUInt32LE(bytes.byteLength, 22)
  header.writeUInt16LE(name.byteLength, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, name])
}

function centralHeader(
  name: Buffer,
  size: number,
  crc: number,
  epochMs: number,
  offset: number,
): Buffer {
  const { time, date } = dosDateTime(epochMs)
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(UTF8_NAMES, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(time, 12)
  header.writeUInt16LE(date, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(size, 20)
  header.writeUInt32LE(size, 24)
  header.writeUInt16LE(name.byteLength, 28)
  header.writeUInt32LE(offset, 42)
  return Buffer.concat([header, name])
}

/** The archive as a stream: each file's header and bytes, then the directory. */
export function zipStream(entries: readonly ZipEntry[]): ReadableStream<Uint8Array> {
  const names = uniqueNames(entries.map((entry) => entry.name))
  const directory: Buffer[] = []
  let offset = 0
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const entry = entries[index]
      if (entry) {
        const name = Buffer.from(names[index] ?? entry.name, 'utf8')
        const bytes = entry.read()
        const crc = crc32(bytes)
        const header = localHeader(name, bytes, crc, entry.modifiedAt)
        directory.push(centralHeader(name, bytes.byteLength, crc, entry.modifiedAt, offset))
        offset += header.byteLength + bytes.byteLength
        index++
        controller.enqueue(header)
        controller.enqueue(bytes)
        return
      }
      const central = Buffer.concat(directory)
      const end = Buffer.alloc(22)
      end.writeUInt32LE(0x06054b50, 0)
      end.writeUInt16LE(entries.length, 8)
      end.writeUInt16LE(entries.length, 10)
      end.writeUInt32LE(central.byteLength, 12)
      end.writeUInt32LE(offset, 16)
      controller.enqueue(central)
      controller.enqueue(end)
      controller.close()
    },
  })
}
