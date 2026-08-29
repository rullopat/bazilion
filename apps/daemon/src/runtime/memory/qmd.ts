import type { Stats } from 'node:fs'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { MemoryEntry, MemoryHit } from '@bazilion/api-types'
import { createStore, extractSnippet, type QMDStore } from '@tobilu/qmd'
import { withNativeModuleErrorBoundary } from '../../lib/native-module-error.ts'
import type { MemoryBackend } from './types.ts'

const INDEX_FILENAME = '.qmd-index.sqlite'
const COLLECTION_NAME = 'memory'
const PATTERN = '**/*.md'
const QMD_NATIVE_ERROR_OPTIONS = { subject: 'Bazilion memory' } as const

export interface QmdBackendOptions {
  /** Test seam for exercising qmd initialization failures without replacing a native binary. */
  createStore?: typeof createStore
}

// One store per memory directory per process. createStore opens a SQLite
// handle; we dedupe so concurrent chat requests for the same agent reuse it.
const storeCache = new Map<string, Promise<QMDStore>>()

function getStore(dir: string, storeFactory: typeof createStore): Promise<QMDStore> {
  let p = storeCache.get(dir)
  if (!p) {
    p = withNativeModuleErrorBoundary(
      () =>
        storeFactory({
          dbPath: join(dir, INDEX_FILENAME),
          config: {
            collections: {
              [COLLECTION_NAME]: { path: dir, pattern: PATTERN },
            },
          },
        }),
      QMD_NATIVE_ERROR_OPTIONS,
    ).catch((error) => {
      // A failed initialization must be retryable after the operator rebuilds
      // native dependencies without restarting the daemon.
      storeCache.delete(dir)
      throw error
    })
    storeCache.set(dir, p)
  }
  return p
}

function unsafeMemoryPath(path: string, reason: string): Error {
  return new Error(`unsafe memory path "${path}": ${reason}`)
}

function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function assertContained(root: string, candidate: string): void {
  if (!isContained(root, candidate)) {
    throw unsafeMemoryPath(candidate, `resolved outside memory root "${root}"`)
  }
}

/**
 * Create and canonicalize the memory root without accepting a final symlink.
 * A Team itself may intentionally be registered through a symlink, so only
 * the memory root and descendants are treated as the capability boundary.
 */
function initializeSafeRoot(root: string): string {
  mkdirSync(root, { recursive: true })
  const info = lstatSync(root)
  if (info.isSymbolicLink()) {
    throw unsafeMemoryPath(root, 'memory root must not be a symbolic link')
  }
  if (!info.isDirectory()) {
    throw unsafeMemoryPath(root, 'memory root is not a directory')
  }
  return realpathSync(root)
}

function assertRootUnchanged(root: string, canonicalRoot: string): void {
  const info = lstatIfPresent(root)
  if (!info) throw unsafeMemoryPath(root, 'memory root disappeared')
  if (info.isSymbolicLink()) {
    throw unsafeMemoryPath(root, 'memory root must not be a symbolic link')
  }
  if (!info.isDirectory()) {
    throw unsafeMemoryPath(root, 'memory root is not a directory')
  }
  const current = realpathSync(root)
  if (relative(canonicalRoot, current) !== '' || relative(current, canonicalRoot) !== '') {
    throw unsafeMemoryPath(root, 'memory root changed after initialization')
  }
}

function safeKey(root: string, key: string): string {
  const segments = key.split(/[\\/]/)
  if (
    key.length === 0 ||
    key.includes('\0') ||
    isAbsolute(key) ||
    /^[A-Za-z]:[\\/]/.test(key) ||
    key.startsWith('\\\\') ||
    segments.includes('..')
  ) {
    throw new Error(`unsafe memory key: ${key}`)
  }

  const candidate = resolve(root, key)
  if (candidate === root) throw new Error(`unsafe memory key: ${key}`)
  assertContained(root, candidate)
  return candidate
}

/**
 * Inspect every existing component of a key without following symlinks.
 * Returns the final lstat, or undefined when the final path does not exist.
 */
function inspectSafePath(root: string, path: string): Stats | undefined {
  assertContained(root, path)
  const rel = relative(root, path)
  let current = root
  const components = rel.split(sep).filter(Boolean)

  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index] as string)
    const info = lstatIfPresent(current)
    if (!info) return undefined
    if (info.isSymbolicLink()) {
      throw unsafeMemoryPath(current, 'symbolic links are not allowed')
    }
    if (index < components.length - 1 && !info.isDirectory()) {
      throw unsafeMemoryPath(current, 'path ancestor is not a directory')
    }
    assertContained(root, realpathSync(current))
  }

  return lstatIfPresent(path)
}

function ensureSafeParentDirectories(root: string, path: string): void {
  const parent = dirname(path)
  assertContained(root, parent)
  const rel = relative(root, parent)
  let current = root

  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component)
    let info = lstatIfPresent(current)
    if (!info) {
      mkdirSync(current)
      info = lstatSync(current)
    }
    if (info.isSymbolicLink()) {
      throw unsafeMemoryPath(current, 'symbolic-link ancestors are not allowed')
    }
    if (!info.isDirectory()) {
      throw unsafeMemoryPath(current, 'path ancestor is not a directory')
    }
    assertContained(root, realpathSync(current))
  }
}

function readSafeFile(root: string, path: string): { content: string; stats: Stats } {
  const info = inspectSafePath(root, path)
  if (!info) throw new Error(`memory entry not found: ${relative(root, path)}`)
  if (!info.isFile()) throw unsafeMemoryPath(path, 'memory entry is not a regular file')

  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stats = fstatSync(fd)
    if (!stats.isFile()) throw unsafeMemoryPath(path, 'memory entry is not a regular file')
    return { content: readFileSync(fd, 'utf8'), stats }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw unsafeMemoryPath(path, 'symbolic links are not allowed')
    }
    throw error
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function writeSafeFile(root: string, path: string, content: string): Stats {
  ensureSafeParentDirectories(root, path)
  const existing = inspectSafePath(root, path)
  if (existing?.isSymbolicLink()) {
    throw unsafeMemoryPath(path, 'symbolic links are not allowed')
  }
  if (existing && !existing.isFile()) {
    throw unsafeMemoryPath(path, 'memory entry is not a regular file')
  }

  let fd: number | undefined
  try {
    fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o666,
    )
    const stats = fstatSync(fd)
    if (!stats.isFile()) throw unsafeMemoryPath(path, 'memory entry is not a regular file')
    writeFileSync(fd, content)
    return fstatSync(fd)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw unsafeMemoryPath(path, 'symbolic links are not allowed')
    }
    throw error
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function assertSafeTree(root: string, dir = root): void {
  assertContained(root, realpathSync(dir))
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const info = lstatSync(full)
    if (info.isSymbolicLink()) {
      throw unsafeMemoryPath(full, 'symbolic links are not allowed in memory storage')
    }
    if (info.isDirectory()) {
      assertSafeTree(root, full)
    } else if (!info.isFile()) {
      throw unsafeMemoryPath(full, 'special files are not allowed in memory storage')
    }
  }
}

function walkMd(root: string, dir: string, prefix: string, out: MemoryEntry[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const info = lstatSync(full)
    if (info.isSymbolicLink()) {
      throw unsafeMemoryPath(full, 'symbolic links are not allowed in memory storage')
    }
    if (entry.name.startsWith('.')) continue // skip .qmd-index.sqlite and friends

    const key = prefix ? `${prefix}/${entry.name}` : entry.name
    if (info.isDirectory()) {
      walkMd(root, full, key, out)
    } else if (info.isFile() && entry.name.endsWith('.md')) {
      const { content, stats } = readSafeFile(root, full)
      out.push({ key, content, updatedAt: stats.mtimeMs })
    } else if (!info.isFile()) {
      throw unsafeMemoryPath(full, 'special files are not allowed in memory storage')
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
export function qmdBackend(root: string, options: QmdBackendOptions = {}): MemoryBackend {
  let canonicalRoot: string | undefined
  const storeFactory = options.createStore ?? createStore

  const safeRoot = (): string => {
    if (!canonicalRoot) canonicalRoot = initializeSafeRoot(root)
    else assertRootUnchanged(root, canonicalRoot)
    return canonicalRoot
  }

  return {
    async init() {
      const safe = safeRoot()
      assertSafeTree(safe)
      // Opening the store + initial scan. update() is idempotent.
      const store = await getStore(safe, storeFactory)
      await withNativeModuleErrorBoundary(() => store.update(), QMD_NATIVE_ERROR_OPTIONS)
    },

    async read(key) {
      const safe = safeRoot()
      const path = safeKey(safe, key)
      const { content, stats } = readSafeFile(safe, path)
      return {
        key,
        content,
        updatedAt: stats.mtimeMs,
      }
    },

    async write(key, content) {
      const safe = safeRoot()
      assertSafeTree(safe)
      const path = safeKey(safe, key)
      const stats = writeSafeFile(safe, path, content)
      // Reindex so the newly-written file is searchable on the next search().
      // update() re-scans the collection; for typical memory sizes (tens of
      // files) this is sub-millisecond.
      assertSafeTree(safe)
      const store = await getStore(safe, storeFactory)
      await withNativeModuleErrorBoundary(() => store.update(), QMD_NATIVE_ERROR_OPTIONS)
      return { key, content, updatedAt: stats.mtimeMs }
    },

    async search(query, opts) {
      const limit = opts?.limit ?? 10
      const safe = safeRoot()
      assertSafeTree(safe)
      const store = await getStore(safe, storeFactory)
      const results = await withNativeModuleErrorBoundary(
        () =>
          store.searchLex(query, {
            limit,
            collection: COLLECTION_NAME,
          }),
        QMD_NATIVE_ERROR_OPTIONS,
      )
      const hits: MemoryHit[] = []
      for (const r of results) {
        // qmd's filepath is a synthetic URI (`qmd://<collection>/<path>`);
        // displayPath is collection-prefixed (`<collection>/<path>`). Strip
        // the leading `<collection>/` to get the key the caller wrote.
        const prefix = `${COLLECTION_NAME}/`
        const key = r.displayPath.startsWith(prefix)
          ? r.displayPath.slice(prefix.length)
          : r.displayPath
        const path = safeKey(safe, key)
        const info = inspectSafePath(safe, path)
        if (!info) continue
        if (!info.isFile()) throw unsafeMemoryPath(path, 'search result is not a regular file')
        let content = r.body ?? ''
        if (!content) {
          content = readSafeFile(safe, path).content
        }
        const snippet = extractSnippet(content, query).snippet
        hits.push({ key, snippet, score: r.score })
      }
      return hits
    },

    async list() {
      const safe = safeRoot()
      assertSafeTree(safe)
      const out: MemoryEntry[] = []
      walkMd(safe, safe, '', out)
      return out.sort((a, b) => a.key.localeCompare(b.key))
    },

    async remove(key) {
      const safe = safeRoot()
      assertSafeTree(safe)
      const path = safeKey(safe, key)
      const info = inspectSafePath(safe, path)
      if (info) {
        if (!info.isFile()) throw unsafeMemoryPath(path, 'memory entry is not a regular file')
        rmSync(path)
      }
      assertSafeTree(safe)
      const store = await getStore(safe, storeFactory)
      await withNativeModuleErrorBoundary(() => store.update(), QMD_NATIVE_ERROR_OPTIONS)
    },
  }
}
