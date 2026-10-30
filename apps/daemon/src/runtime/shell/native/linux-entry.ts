import { closeSync, readdirSync, readFileSync, writeSync } from 'node:fs'

// Trusted single-use bootstrap, staged as JavaScript outside confinement. There is no model
// command/profile/backend argument. Bash receives command bytes only after daemon admission.
const nonce = process.argv[2]
const safeKeys = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
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
try {
  if (
    process.platform !== 'linux' ||
    typeof process.execve !== 'function' ||
    !nonce ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce) ||
    process.argv.length > 64 ||
    Object.keys(process.env).some((key) => !safeKeys.has(key))
  )
    throw new Error('Native entry unavailable')
  const status = readFileSync('/proc/self/status', 'utf8')
  if (status.length > 64 * 1024) throw new Error('Native entry unavailable')
  for (const [key, expected] of [
    ['NoNewPrivs', '1'],
    ['Seccomp', '2'],
    ...['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((key) => [key, '0000000000000000']),
  ]) {
    const values = [...status.matchAll(new RegExp(`^${key}:[ \\t]+([^\\n]+)$`, 'gm'))]
    if (values.length !== 1 || values[0]?.[1]?.trim() !== expected)
      throw new Error('Native entry unavailable')
  }
  // Do not assume libc/execve closes inherited manager, gate, file or runtime descriptors.
  // Enumerate only this trusted process's readonly /proc view, close every non-stdio entry,
  // and acknowledge readiness only afterwards. The enumerator's already-closed FD is EBADF.
  const descriptors = readdirSync('/proc/self/fd')
  if (descriptors.length > 4096) throw new Error('Native entry unavailable')
  for (const name of descriptors) {
    if (!/^(0|[1-9][0-9]*)$/.test(name)) throw new Error('Native entry unavailable')
    const fd = Number(name)
    if (!Number.isSafeInteger(fd)) throw new Error('Native entry unavailable')
    if (fd < 3) continue
    try {
      closeSync(fd)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBADF') throw error
    }
  }
  const marker = Buffer.from(`BAZILION_NATIVE_READY:${nonce}\n`)
  if (writeSync(1, marker) !== marker.length) throw new Error('Native entry unavailable')
  // execve replaces this trusted bootstrap; no control descriptors or supervisor memory are
  // left in the payload. Kernel namespace init and the daemon-owned manager supervise lifetime.
  process.execve(
    '/usr/bin/bash',
    ['bash', '--noprofile', '--norc', '-s', '--', ...process.argv.slice(3)],
    process.env,
  )
} catch {
  writeSync(2, 'Native entry unavailable\n')
  // No event-loop continuation after descriptor retirement if execve refuses.
  process.exit(1)
}
