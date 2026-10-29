import { createHash } from 'node:crypto'
import { closeSync, constants, openSync, statfsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readFileDescriptorBoundedSync } from '@openclaw/fs-safe/advanced'
import type { ContextDirectory } from '../repository-context/files.ts'

const unavailable = () => new Error('Native filesystem identity is unavailable')
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const LOCAL_LINUX_FILESYSTEMS = new Set([
  0xef53n, // ext2/3/4
  0x58465342n, // XFS
  0x9123683en, // Btrfs
  0x01021994n, // tmpfs
  0x2fc12fc1n, // ZFS
  0x794c7630n, // overlayfs
  0xf2f52010n, // F2FS
])

/** Closed parser for an owned directory descriptor's procfs metadata, not a target PID oracle. */
export function linuxMountIdentity(fdinfo: Buffer, filesystem: bigint, blockSize: bigint): string {
  const type = BigInt.asUintN(32, filesystem)
  if (!LOCAL_LINUX_FILESYSTEMS.has(type) || blockSize <= 0n || fdinfo.length > 4096)
    throw unavailable()
  const matches = [...fdinfo.toString('utf8').matchAll(/^mnt_id:[ \t]+([1-9][0-9]{0,19})$/gm)]
  const id = matches[0]?.[1]
  if (matches.length !== 1 || !id || BigInt(id) > 0xffffffffffffffffn) throw unavailable()
  return hash(`linux-mount:${id}:${type}:${blockSize}`)
}

/**
 * Public 64-bit Darwin statfs ABI: 2168 bytes, fsid @48, type @60, flags @64, name @72,
 * mounted-on name @88 (1024 bytes). Never expose source-device/volume names to the model.
 */
export function darwinMountIdentity(
  buffer: Buffer,
  expectedBlockSize: bigint,
  writable = false,
): string {
  if (buffer.length !== 2168) throw unavailable()
  const blockSize = buffer.readUInt32LE(0)
  const flags = buffer.readUInt32LE(64)
  const fsid = buffer.subarray(48, 56)
  const name = buffer.subarray(72, 88)
  const mountedOn = buffer.subarray(88, 1112)
  const end = mountedOn.indexOf(0)
  const typeEnd = name.indexOf(0)
  if (
    BigInt(blockSize) !== expectedBlockSize ||
    blockSize < 512 ||
    (flags & 0x1000) === 0 || // MNT_LOCAL; remote/FUSE/broker-backed inputs are not assumed safe.
    fsid.every((byte) => byte === 0) ||
    buffer.readUInt32LE(60) === 0 ||
    typeEnd <= 0 ||
    !['apfs', 'hfs', 'tmpfs'].includes(name.subarray(0, typeEnd).toString('ascii')) ||
    // HFS directory hardlinks cannot be admitted by this file-link census. Readonly inputs
    // cannot mutate those aliases; writable scopes require a filesystem without that surface.
    (writable && name.subarray(0, typeEnd).toString('ascii') === 'hfs') ||
    end <= 0 ||
    mountedOn[0] !== 47
  )
    throw unavailable()
  const mount = mountedOn.subarray(0, end)
  if (!Buffer.from(mount.toString('utf8'), 'utf8').equals(mount)) throw unavailable()
  // Free-space counters change during capture; only mount identity/type/flags enter this key.
  return hash(Buffer.concat([buffer.subarray(48, 72), name.subarray(0, typeEnd), mount]))
}

let darwinRead: ((fd: number, buffer: Buffer) => { status: number; errno: number }) | undefined
function getDarwinRead(): NonNullable<typeof darwinRead> {
  if (!darwinRead) {
    if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch))
      throw unavailable()
    try {
      const ffi = createRequire(import.meta.url)('koffi') as typeof import('koffi')
      if (ffi.version !== '3.3.3') throw unavailable()
      const library = ffi.load('/usr/lib/libSystem.B.dylib')
      // The public SDK uses the ordinary 64-bit symbol on arm64, the INODE64 alias on x86-64.
      const symbol = process.arch === 'arm64' ? 'fstatfs' : 'fstatfs$INODE64'
      const call = library.func(symbol, 'int', ['int', 'void *']) as (
        fd: number,
        buffer: Buffer,
      ) => number
      darwinRead = (fd, buffer) => {
        ffi.errno(0)
        const status = call(fd, buffer)
        return { status, errno: ffi.errno() }
      }
    } catch {
      throw unavailable()
    }
  }
  return darwinRead
}

/** Read-only facts for a live retained directory. No persisted ID grants signalling authority. */
export function nativeMountIdentity(directory: ContextDirectory, writable: boolean): string {
  directory.validateIdentity()
  const filesystem = statfsSync(directory.path, { bigint: true })
  let result: string
  if (process.platform === 'linux') {
    const infoFd = openSync(
      `/proc/self/fdinfo/${directory.fd}`,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    try {
      result = linuxMountIdentity(
        readFileDescriptorBoundedSync(infoFd, 4096),
        filesystem.type,
        filesystem.bsize,
      )
    } finally {
      closeSync(infoFd)
    }
  } else if (process.platform === 'darwin') {
    const buffer = Buffer.alloc(2168)
    try {
      const observed = getDarwinRead()(directory.fd, buffer)
      if (observed.status !== 0 || observed.errno !== 0) throw unavailable()
      result = darwinMountIdentity(buffer, filesystem.bsize, writable)
    } finally {
      buffer.fill(0)
    }
  } else throw unavailable()
  directory.validateIdentity()
  return result
}
