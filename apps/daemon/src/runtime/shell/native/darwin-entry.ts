import { realpathSync } from 'node:fs'
import { constants } from 'node:os'
import { posix } from 'node:path'
import { getDarwinProcessInspector } from '../../../lib/process/darwin.ts'
import { DarwinCensusReader, getDarwinCensusCalls } from '../../../lib/process/darwin-census.ts'
import { DarwinCommandJob } from './darwin-job.ts'
import {
  DARWIN_JOB_MAX_FRAME_BYTES,
  DARWIN_JOB_PROTOCOL,
  type DarwinJobResponse,
  parseDarwinJobRequest,
} from './darwin-protocol.ts'

// Internal fixed entry only. Staging/bundling happens outside confinement. No profile, backend,
// credential, arbitrary helper path or command bytes are accepted from argv/environment.
let closing = false
function emit(message: DarwinJobResponse): void {
  if (closing) return
  const frame = Buffer.from(`${JSON.stringify(message)}\n`)
  if (
    frame.length > DARWIN_JOB_MAX_FRAME_BYTES ||
    process.stdout.writableLength > 8 * DARWIN_JOB_MAX_FRAME_BYTES
  )
    process.exit(1)
  if (message.type === 'fatal') {
    closing = true
    process.stdout.write(frame, () => process.exit(1))
  } else process.stdout.write(frame)
}
function fatal(): void {
  emit({ type: 'fatal', error: 'native_job_unavailable' })
}
process.stdout.on('error', () => process.exit(1))
process.stdin.on('error', fatal)

try {
  const nonce = process.argv[2],
    cwd = process.argv[3]
  if (
    process.platform !== 'darwin' ||
    process.argv.length !== 4 ||
    !nonce ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce) ||
    !cwd ||
    !posix.isAbsolute(cwd) ||
    cwd === '/' ||
    posix.normalize(cwd) !== cwd ||
    Buffer.byteLength(cwd) > 4096 ||
    realpathSync(cwd) !== cwd
  )
    throw new Error('unavailable')
  // CoreFoundation can generate this key after a scrubbed exec. Never admit it or an ambient value.
  delete process.env.__CF_USER_TEXT_ENCODING
  const safe = new Set([
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LANGUAGE',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'SHELL',
    'TZ',
    'PWD',
    'CI',
    'NO_COLOR',
  ])
  if (Object.keys(process.env).some((key) => !safe.has(key))) throw new Error('unavailable')
  const calls = getDarwinCensusCalls()
  const reader = new DarwinCensusReader(calls)
  const owner = reader.ownIdentity()
  const outside = calls.identity(process.ppid, Buffer.alloc(56))
  if ('kind' in owner || outside.bytes !== 0 || outside.errno !== constants.errno.EPERM)
    throw new Error('unavailable')
  const inspection = getDarwinProcessInspector()
  const native = inspection.member(process.pid)
  if (
    !native ||
    native.state === 'Z' ||
    native.parent !== process.ppid ||
    native.group !== process.pid ||
    native.session !== process.pid
  )
    throw new Error('unavailable')
  const job = new DarwinCommandJob({ reader, owner, inspection, cwd, env: process.env, sink: emit })
  emit({ type: 'ready', version: DARWIN_JOB_PROTOCOL, nonce, owner, native })
  let pending = Buffer.alloc(0)
  process.stdin.on('data', (bytes: Buffer) => {
    if (closing) return
    try {
      if (pending.length + bytes.length > 2 * DARWIN_JOB_MAX_FRAME_BYTES)
        throw new Error('unavailable')
      pending = Buffer.concat([pending, bytes])
      for (;;) {
        const newline = pending.indexOf(10)
        if (newline < 0) break
        if (newline <= 0 || newline > DARWIN_JOB_MAX_FRAME_BYTES) throw new Error('unavailable')
        const raw = pending.subarray(0, newline)
        pending = pending.subarray(newline + 1)
        const line = raw.toString('utf8')
        if (!Buffer.from(line, 'utf8').equals(raw)) throw new Error('unavailable')
        if (job.accept(parseDarwinJobRequest(JSON.parse(line)))) {
          closing = true
          process.stdin.pause()
          process.stdout.write('', () => process.exit(0))
          return
        }
      }
      if (pending.length > DARWIN_JOB_MAX_FRAME_BYTES) throw new Error('unavailable')
    } catch {
      fatal()
    }
  })
  // EOF/transport loss is never a successful exit handshake. The daemon retains unknown ownership.
  process.stdin.once('end', () => {
    if (!closing) process.exit(1)
  })
} catch {
  fatal()
}
