// Wire shapes for the per-group memory store. The `MemoryBackend` interface
// itself stays in apps/daemon/src/runtime/memory (it has methods and is
// server-internal); these are the values that cross the HTTP wire.

export interface MemoryEntry {
  key: string
  content: string
  updatedAt: number
}

export interface MemoryHit {
  key: string
  snippet: string
  score: number
}
