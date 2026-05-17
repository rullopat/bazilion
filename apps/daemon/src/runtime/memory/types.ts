import type { MemoryEntry, MemoryHit } from '@bazilion/api-types'

export interface MemoryBackend {
  /** Initialize storage. Idempotent. */
  init(): Promise<void>
  /** Read a memory entry by key. Throws if missing. */
  read(key: string): Promise<MemoryEntry>
  /** Write or overwrite a memory entry. */
  write(key: string, content: string): Promise<MemoryEntry>
  /** Search memory for matches against a query string. */
  search(query: string, opts?: { limit?: number }): Promise<MemoryHit[]>
  /** List all entries (sorted by key). */
  list(): Promise<MemoryEntry[]>
  /** Delete an entry. No-op if missing. */
  remove(key: string): Promise<void>
}
