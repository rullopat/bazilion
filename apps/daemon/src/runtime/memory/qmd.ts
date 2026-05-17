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
import { createStore, extractSnippet, type QMDStore } from '@tobilu/qmd'
import type { MemoryBackend } from './types.ts'

const INDEX_FILENAME = '.qmd-index.sqlite'
const COLLECTION_NAME = 'memory'
const PATTERN = '**/*.md'

// One store per memory directory per process. createStore opens a SQLite
// handle; we dedupe so concurrent chat requests for the same agent reuse it.
const storeCache = new Map<string, Promise<QMDStore>>()

function getStore(dir: string): Promise<QMDStore> {
  let p = storeCache.get(dir)
  if (!p) {
    p = createStore({
      dbPath: join(dir, INDEX_FILENAME),
      config: {
        collections: {
          [COLLECTION_NAME]: { path: dir, pattern: PATTERN },
        },
      },
    })
    storeCache.set(dir, p)
  }
  return p
}

function safeKey(root: string, key: string): string {
  if (key.includes('..') || key.startsWith('/') || key.includes('\0')) {
    throw new Error(`unsafe memory key: ${key}`)
  }
  return join(root, key)
}

function walkMd(dir: string, prefix: string, out: MemoryEntry[]): void {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue // skip .qmd-index.sqlite and friends
    const full = join(dir, e.name)
    const key = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) {
      walkMd(full, key, out)
    } else if (e.isFile() && e.name.endsWith('.md')) {
      const stats = statSync(full)
      out.push({
        key,
        content: readFileSync(full, 'utf8'),
        updatedAt: stats.mtimeMs,
      })
    }
  }
}

/**
 * Memory backend backed by @tobilu/qmd — BM25 keyword search over markdown
 * files under `root`. Writes markdown to disk, then asks qmd to reindex.
 *
 * Uses `searchLex` only; no embeddings, no LLM rerank, no model download.
 * The hybrid `search()` / `searchVector()` paths exist in the qmd SDK and
 * can be wired in later if we want semantic search — they'd add a dependency
 * on `node-llama-cpp` and several GB of GGUF models.
 */
export function qmdBackend(root: string): MemoryBackend {
  return {
    async init() {
      mkdirSync(root, { recursive: true })
      // Opening the store + initial scan. update() is idempotent.
      const store = await getStore(root)
      await store.update()
    },

    async read(key) {
      const path = safeKey(root, key)
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
      const path = safeKey(root, key)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      const stats = statSync(path)
      // Reindex so the newly-written file is searchable on the next search().
      // update() re-scans the collection; for typical memory sizes (tens of
      // files) this is sub-millisecond.
      const store = await getStore(root)
      await store.update()
      return { key, content, updatedAt: stats.mtimeMs }
    },

    async search(query, opts) {
      const limit = opts?.limit ?? 10
      const store = await getStore(root)
      const results = await store.searchLex(query, {
        limit,
        collection: COLLECTION_NAME,
      })
      const hits: MemoryHit[] = []
      for (const r of results) {
        // qmd's filepath is a synthetic URI (`qmd://<collection>/<path>`);
        // displayPath is collection-prefixed (`<collection>/<path>`). Strip
        // the leading `<collection>/` to get the key the caller wrote.
        const prefix = `${COLLECTION_NAME}/`
        const key = r.displayPath.startsWith(prefix)
          ? r.displayPath.slice(prefix.length)
          : r.displayPath
        let content = r.body ?? ''
        if (!content) {
          try {
            content = readFileSync(join(root, key), 'utf8')
          } catch {
            content = ''
          }
        }
        const snippet = extractSnippet(content, query).snippet
        hits.push({ key, snippet, score: r.score })
      }
      return hits
    },

    async list() {
      const out: MemoryEntry[] = []
      walkMd(root, '', out)
      return out.sort((a, b) => a.key.localeCompare(b.key))
    },

    async remove(key) {
      const path = safeKey(root, key)
      if (existsSync(path)) rmSync(path)
      const store = await getStore(root)
      await store.update()
    },
  }
}
