import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { MemoryEntry, MemoryHit } from '@bazilion/api-types'
import type { MemoryBackend } from './types.ts'

const SNIPPET_PAD = 60

/**
 * Filesystem-backed memory: every entry is a file under `root`. Search is
 * substring matching across all files. Index = the filesystem itself.
 */
export function filesBackend(root: string): MemoryBackend {
  function safe(key: string): string {
    if (key.includes('..') || key.startsWith('/') || key.includes('\0')) {
      throw new Error(`unsafe memory key: ${key}`)
    }
    return join(root, key)
  }

  function walk(dir: string, prefix: string, out: MemoryEntry[]): void {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      const key = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) {
        walk(full, key, out)
      } else if (e.isFile()) {
        const stats = statSync(full)
        out.push({
          key,
          content: readFileSync(full, 'utf8'),
          updatedAt: stats.mtimeMs,
        })
      }
    }
  }

  return {
    async init() {
      mkdirSync(root, { recursive: true })
    },

    async read(key) {
      const path = safe(key)
      if (!existsSync(path)) {
        throw new Error(`memory entry not found: ${key}`)
      }
      const stats = statSync(path)
      return {
        key,
        content: readFileSync(path, 'utf8'),
        updatedAt: stats.mtimeMs,
      }
    },

    async write(key, content) {
      const path = safe(key)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      const stats = statSync(path)
      return { key, content, updatedAt: stats.mtimeMs }
    },

    async search(query, opts) {
      const limit = opts?.limit ?? 10
      const all: MemoryEntry[] = []
      walk(root, '', all)
      const q = query.toLowerCase()
      const hits: MemoryHit[] = []
      for (const entry of all) {
        const idx = entry.content.toLowerCase().indexOf(q)
        if (idx === -1) continue
        const start = Math.max(0, idx - SNIPPET_PAD)
        const end = Math.min(entry.content.length, idx + query.length + SNIPPET_PAD)
        hits.push({
          key: entry.key,
          snippet: entry.content.slice(start, end),
          score: 1,
        })
      }
      return hits.slice(0, limit)
    },

    async list() {
      const out: MemoryEntry[] = []
      walk(root, '', out)
      return out.sort((a, b) => a.key.localeCompare(b.key))
    },

    async remove(key) {
      const path = safe(key)
      if (existsSync(path)) rmSync(path)
    },
  }
}
