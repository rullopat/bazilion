import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { FileEntry } from '@earendil-works/pi-coding-agent'
import type { Paths } from '../core/paths.ts'

/** Bounded descriptor read shared by publication provenance and source-conversation display. */
export function readResultSession(
  paths: Paths,
  agentId: string,
  filename: string,
  sessionId: string,
  minimumEntryOffset = 0,
): FileEntry[] {
  if (basename(filename) !== filename) throw new Error('Invalid result session filename')
  const directory = join(realpathSync(paths.agentsDir), agentId, 'sessions')
  return readCanonicalSessionFile(directory, filename, sessionId, minimumEntryOffset)
}

/** Bounded canonical reader for an already Agent-bound session directory. */
export function readCanonicalSessionFile(
  directory: string,
  filename: string,
  sessionId: string,
  minimumEntryOffset = 0,
): FileEntry[] {
  if (basename(filename) !== filename) throw new Error('Invalid session filename')
  if (realpathSync(directory) !== directory) throw new Error('Result session escaped its owner')
  const fd = openSync(
    join(directory, filename),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
      throw new Error('Result source session is unavailable or too large')
    const buffer = Buffer.alloc(stat.size + 1)
    let count = 0
    while (count < buffer.length) {
      const n = readSync(fd, buffer, count, buffer.length - count, null)
      if (n === 0) break
      count += n
    }
    if (count !== stat.size) throw new Error('Result source session changed while reading')
    const entries: Array<{ entry: FileEntry; offset: number }> = []
    let position = 0
    for (const line of buffer.subarray(0, count).toString('utf8').split('\n')) {
      if (line.trim()) entries.push({ entry: JSON.parse(line), offset: position })
      position += Buffer.byteLength(line) + 1
    }
    const header = entries[0]?.entry
    if (header?.type !== 'session' || header.id !== sessionId)
      throw new Error('Result source session does not match the active Agent session')
    return entries
      .filter((row, index) => index === 0 || row.offset >= minimumEntryOffset)
      .map((row) => row.entry)
  } finally {
    closeSync(fd)
  }
}
