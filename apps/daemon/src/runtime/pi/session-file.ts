import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type { FileEntry } from '@earendil-works/pi-coding-agent'

// Bounded reads of an Agent's Pi session files: one append-only JSONL transcript per
// conversation, named `<conversation id>.jsonl`, whose first line is a header naming that id.

const MAX_SESSION_BYTES = 64 * 1024 * 1024
const MAX_HEADER_BYTES = 64 * 1024

/** The first `limit` bytes of a session file (a regular file, never a symlink), and its size. */
function readStart(directory: string, id: string, limit: number): { bytes: Buffer; size: number } {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid conversation id')
  const fd = openSync(
    join(directory, `${id}.jsonl`),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('Session file is not a regular file')
    const bytes = Buffer.alloc(Math.min(stat.size, limit))
    let count = 0
    while (count < bytes.length) {
      const n = readSync(fd, bytes, count, bytes.length - count, count)
      if (n === 0) break
      count += n
    }
    return { bytes: bytes.subarray(0, count), size: stat.size }
  } finally {
    closeSync(fd)
  }
}

function checkHeader(entry: FileEntry | undefined, id: string): void {
  if (entry?.type !== 'session' || entry.id !== id)
    throw new Error('Session file does not belong to this conversation')
}

/** Every entry of a conversation's transcript. A line still being appended is left out. */
export function readSessionFile(directory: string, id: string): FileEntry[] {
  const { bytes, size } = readStart(directory, id, MAX_SESSION_BYTES)
  if (size > MAX_SESSION_BYTES) throw new Error('Session file is larger than 64 MiB')
  const text = bytes.toString('utf8')
  const entries = text
    .slice(0, text.lastIndexOf('\n') + 1)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as FileEntry)
  checkHeader(entries[0], id)
  return entries
}

/** Check that a conversation's transcript exists, reading only its header line. */
export function readSessionHeader(directory: string, id: string): void {
  const text = readStart(directory, id, MAX_HEADER_BYTES).bytes.toString('utf8')
  const end = text.indexOf('\n')
  if (end < 0) throw new Error('Session file has no header')
  checkHeader(JSON.parse(text.slice(0, end)) as FileEntry, id)
}
