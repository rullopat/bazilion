import { fstatSync, readSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { assertNativeFileCapture, captureNativeFile, type NativeFileCapture } from './files.ts'
import { NativeLayoutError } from './layout.ts'

const unavailable = () => new NativeLayoutError('unavailable')
export interface LinuxElfMetadata {
  readonly interpreter: string | null
  readonly needed: readonly string[]
  readonly searchPaths: readonly string[]
}

/**
 * Read only bounded public ELF64 metadata from an already-pinned trusted runtime input.
 * Never run ldd, repository helpers or a loader; never honor ambient LD_* or binary RPATH.
 * Untrusted workspace executables do not use this resolver to gain additional mounted inputs.
 */
export function readLinuxElfMetadata(file: NativeFileCapture): LinuxElfMetadata {
  assertNativeFileCapture(file)
  file.revalidate()
  const size = fstatSync(file.fd, { bigint: true }).size
  function number(value: bigint): number {
    if (value < 0n || value > size || value > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable()
    return Number(value)
  }
  function block(offset: number, bytes: number, maximum: number): Buffer {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(bytes) ||
      offset < 0 ||
      bytes < 0 ||
      bytes > maximum ||
      BigInt(offset) + BigInt(bytes) > size
    )
      throw unavailable()
    const buffer = Buffer.alloc(bytes)
    let read = 0
    while (read < bytes) {
      const count = readSync(file.fd, buffer, read, bytes - read, offset + read)
      if (!count) throw unavailable()
      read += count
    }
    return buffer
  }
  function cstring(buffer: Buffer, offset: number): string {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= buffer.length) throw unavailable()
    const end = buffer.indexOf(0, offset)
    if (end < 0 || end - offset > 4096) throw unavailable()
    const bytes = buffer.subarray(offset, end)
    const text = bytes.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw unavailable()
    return text
  }
  const header = block(0, 64, 64)
  const machine = process.arch === 'x64' ? 62 : process.arch === 'arm64' ? 183 : 0
  if (
    !machine ||
    !header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header[6] !== 1 ||
    ![2, 3].includes(header.readUInt16LE(16)) ||
    header.readUInt16LE(18) !== machine ||
    header.readUInt16LE(52) !== 64 ||
    header.readUInt16LE(54) !== 56
  )
    throw unavailable()
  const count = header.readUInt16LE(56)
  if (count <= 0 || count > 128) throw unavailable()
  const programs = block(number(header.readBigUInt64LE(32)), count * 56, 128 * 56)
  const loads: Array<{ offset: bigint; virtual: bigint; bytes: bigint }> = []
  let interpreter: string | null = null
  let dynamic: Buffer | undefined
  for (let index = 0; index < count; index++) {
    const row = programs.subarray(index * 56, (index + 1) * 56)
    const type = row.readUInt32LE(0)
    const offset = row.readBigUInt64LE(8)
    const bytes = row.readBigUInt64LE(32)
    if (offset + bytes > size) throw unavailable()
    if (type === 1) loads.push({ offset, virtual: row.readBigUInt64LE(16), bytes })
    else if (type === 2) {
      if (dynamic || bytes % 16n !== 0n) throw unavailable()
      dynamic = block(number(offset), number(bytes), 64 * 1024)
    } else if (type === 3) {
      if (interpreter !== null) throw unavailable()
      interpreter = cstring(block(number(offset), number(bytes), 4096), 0)
      if (!isAbsolute(interpreter) || [...interpreter].some((char) => char.charCodeAt(0) < 32))
        throw unavailable()
    }
  }
  const neededOffsets: number[] = []
  const searchOffsets: number[] = []
  let stringAddress: bigint | undefined, stringBytes: bigint | undefined
  if (dynamic) {
    let ended = false
    for (let offset = 0; offset < dynamic.length; offset += 16) {
      const tag = dynamic.readBigInt64LE(offset)
      const value = dynamic.readBigUInt64LE(offset + 8)
      if (tag === 0n) {
        ended = true
        break
      }
      if (tag === 1n) {
        if (neededOffsets.length >= 256) throw unavailable()
        neededOffsets.push(number(value))
      } else if (tag === 15n || tag === 29n) {
        if (searchOffsets.length >= 16) throw unavailable()
        searchOffsets.push(number(value))
      } else if (tag === 5n) stringAddress = value
      else if (tag === 10n) stringBytes = value
    }
    if (!ended) throw unavailable()
  }
  const needed: string[] = []
  const searchPaths: string[] = []
  if (neededOffsets.length || searchOffsets.length) {
    if (stringAddress === undefined || stringBytes === undefined || stringBytes <= 0n)
      throw unavailable()
    const address = stringAddress
    const bytes = stringBytes
    const segment = loads.find(
      (load) => address >= load.virtual && address + bytes <= load.virtual + load.bytes,
    )
    if (!segment) throw unavailable()
    const start = number(segment.offset + address - segment.virtual)
    const length = number(bytes)
    const stringAt = (offset: number) => {
      if (offset < 0 || offset >= length) throw unavailable()
      return cstring(block(start + offset, Math.min(4097, length - offset), 4097), 0)
    }
    for (const offset of neededOffsets) {
      const name = stringAt(offset)
      if (!/^[A-Za-z0-9_.+-]+$/.test(name) || name === '.' || name === '..') throw unavailable()
      needed.push(name)
    }
    for (const offset of searchOffsets) searchPaths.push(...stringAt(offset).split(':'))
  }
  file.revalidate()
  return Object.freeze({
    interpreter,
    needed: Object.freeze([...new Set(needed)].sort()),
    searchPaths: Object.freeze(searchPaths),
  })
}

export interface LinuxElfClosure {
  readonly files: readonly NativeFileCapture[]
  /** Exact destination aliases, not additional directory grants. */
  readonly bindings: readonly { path: string; file: NativeFileCapture }[]
  revalidate(): void
  close(): void
}

/** Resolve a closed bounded dependency closure for explicitly selected trusted executables. */
export function captureLinuxElfClosure(
  executables: readonly string[],
  libraryRoots: readonly string[],
): LinuxElfClosure {
  if (
    process.platform !== 'linux' ||
    !executables.length ||
    executables.length > 64 ||
    !libraryRoots.length ||
    libraryRoots.length > 16
  )
    throw unavailable()
  const roots = [...new Set(libraryRoots.map((root) => realpathSync(root)))]
  const files = new Map<string, NativeFileCapture>()
  const bindings = new Map<string, NativeFileCapture>()
  const pending: NativeFileCapture[] = []
  const inside = (path: string) =>
    roots.some((root) => path === root || path.startsWith(`${root}/`))
  function add(path: string, executable = false) {
    if (!isAbsolute(path)) throw unavailable()
    const canonical = realpathSync(path)
    if (!executable && !inside(canonical)) throw unavailable()
    let file = files.get(canonical)
    if (!file) {
      if (files.size >= 256) throw unavailable()
      file = captureNativeFile({ path, executable, rootOwned: !executable })
      files.set(canonical, file)
      pending.push(file)
    }
    const previous = bindings.get(path)
    if (previous && previous !== file) throw unavailable()
    bindings.set(path, file)
  }
  try {
    for (const path of executables) add(path, true)
    for (let index = 0; index < pending.length; index++) {
      const file = pending[index]
      if (!file) throw unavailable()
      const metadata = readLinuxElfMetadata(file)
      for (const entry of metadata.searchPaths) {
        const expanded = entry.replace(/\$\{ORIGIN\}|\$ORIGIN/g, dirname(file.canonicalPath))
        if (
          !expanded ||
          expanded.includes('$') ||
          !isAbsolute(expanded) ||
          !inside(resolve(expanded))
        )
          throw unavailable()
      }
      if (metadata.interpreter) add(metadata.interpreter)
      for (const name of metadata.needed) {
        let selected: string | undefined
        for (const root of roots) {
          const candidate = join(root, name)
          try {
            if (!inside(realpathSync(candidate))) throw unavailable()
            selected = candidate
            break
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
        if (!selected) throw unavailable()
        add(selected)
      }
    }
    const retained = Object.freeze([...files.values()])
    const aliases = Object.freeze(
      [...bindings].map(([path, file]) => Object.freeze({ path, file })),
    )
    return Object.freeze({
      files: retained,
      bindings: aliases,
      revalidate() {
        for (const file of retained) file.revalidate()
      },
      close() {
        for (const file of retained) file.close()
      },
    })
  } catch {
    for (const file of files.values()) file.close()
    throw unavailable()
  }
}
