import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContextDirectory } from '../repository-context/files.ts'
import { captureNativeFile, type NativeFileCapture } from './files.ts'
import { NativeLayoutError } from './layout.ts'

export type NativeBackend = 'linux-bwrap' | 'darwin-seatbelt'
export interface NativeEntryArtifacts {
  readonly entryPath: string
  readonly files: readonly NativeFileCapture[]
  /** Trusted code bytes/format only, not a workspace snapshot or test verdict. */
  readonly fingerprint: string
  close(): void
}
const unavailable = () => new NativeLayoutError('unavailable')
const SOURCE_FILES = Object.freeze({
  'native-linux-entry.mjs': '../../runtime/shell/native/linux-entry.ts',
  'native-darwin-entry.mjs': '../../runtime/shell/native/darwin-entry.ts',
  'darwin-job.mjs': '../../runtime/shell/native/darwin-job.ts',
  'darwin-protocol.mjs': '../../runtime/shell/native/darwin-protocol.ts',
  'darwin-census.mjs': '../process/darwin-census.ts',
  'darwin.mjs': '../process/darwin.ts',
})
const IMPORTS = Object.freeze({
  '../../../lib/process/darwin-census.ts': './darwin-census.mjs',
  '../../../lib/process/darwin.ts': './darwin.mjs',
  './darwin-job.ts': './darwin-job.mjs',
  './darwin-protocol.ts': './darwin-protocol.mjs',
})

const sourceLayout = import.meta.url.endsWith('/src/lib/native-execution/artifacts.ts')

/** Writable workspaces must not contain or live inside the running daemon's trusted code. */
export function nativeTrustedCodeRoot(): string {
  const directory = dirname(fileURLToPath(import.meta.url))
  return sourceLayout ? resolve(directory, '../../../../..') : dirname(directory)
}

/**
 * Fixed installed/source layouts, not ambient discovery or a caller-selected helper. Raw TS is
 * stripped only in the trusted daemon, before confinement. The native --jitless child sees JS.
 * Caller owns the private empty control root and retains it until native resource settlement.
 */
export function stageNativeEntry(
  controlRoot: string,
  backend: NativeBackend,
): NativeEntryArtifacts {
  const files: NativeFileCapture[] = []
  let root: ContextDirectory | undefined
  try {
    if (!isAbsolute(controlRoot) || normalize(controlRoot) !== controlRoot) throw unavailable()
    if (!['linux-bwrap', 'darwin-seatbelt'].includes(backend)) throw unavailable()
    const stat = lstatSync(controlRoot)
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      process.getuid?.() !== stat.uid ||
      (stat.mode & 0o777) !== 0o700 ||
      readdirSync(controlRoot).length
    )
      throw unavailable()
    root = new ContextDirectory(controlRoot)
    root.validateIdentity()
    const directory = dirname(fileURLToPath(import.meta.url))
    const entryName =
      backend === 'linux-bwrap' ? 'native-linux-entry.mjs' : 'native-darwin-entry.mjs'
    const selected: readonly (keyof typeof SOURCE_FILES)[] =
      backend === 'linux-bwrap'
        ? [entryName]
        : [
            'native-darwin-entry.mjs',
            'darwin-job.mjs',
            'darwin-protocol.mjs',
            'darwin-census.mjs',
            'darwin.mjs',
          ]
    const hash = createHash('sha256').update(
      `native-entry-v1:${backend}:${sourceLayout ? 'stripped-source' : 'bundle'}`,
    )
    let total = 0
    const targets: readonly (keyof typeof SOURCE_FILES)[] = sourceLayout ? selected : [entryName]
    for (const name of targets) {
      const input = sourceLayout
        ? fileURLToPath(new URL(SOURCE_FILES[name], import.meta.url))
        : join(directory, name.replace(/\.mjs$/, '.js'))
      if (lstatSync(input).isSymbolicLink()) throw unavailable()
      const source = captureNativeFile({ path: input, executable: false })
      let code: string
      try {
        if (fstatSync(source.fd).size > 512 * 1024) throw unavailable()
        code = readFileSync(source.fd, 'utf8')
        source.revalidate()
      } finally {
        source.close()
      }
      total += Buffer.byteLength(code)
      if (Buffer.byteLength(code) > 512 * 1024 || total > 2 * 1024 * 1024) throw unavailable()
      if (sourceLayout) {
        code = stripTypeScriptTypes(code, { mode: 'strip' })
        for (const [from, target] of Object.entries(IMPORTS)) {
          code = code.replaceAll(`'${from}'`, `'${target}'`).replaceAll(`"${from}"`, `"${target}"`)
        }
        for (const reference of code.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
          const target = reference[1]
          if (target?.startsWith('.') && !selected.some((file) => target === `./${file}`))
            throw unavailable()
        }
      }
      const target = join(controlRoot, name)
      root.validateIdentity()
      const descriptor = openSync(
        join(root.path, name),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o400,
      )
      try {
        writeFileSync(descriptor, code)
      } finally {
        closeSync(descriptor)
      }
      root.validateIdentity()
      files.push(captureNativeFile({ path: target, executable: false }))
      hash.update(JSON.stringify([name, code]))
    }
    const fingerprint = hash.digest('hex')
    root.close()
    root = undefined
    return Object.freeze({
      entryPath: join(controlRoot, entryName),
      files: Object.freeze(files),
      fingerprint,
      close() {
        for (const file of files) file.close()
      },
    })
  } catch {
    root?.close()
    for (const file of files) file.close()
    throw unavailable()
  }
}
