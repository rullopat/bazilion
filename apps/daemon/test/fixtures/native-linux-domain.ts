import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { captureLinuxElfClosure } from '../../src/lib/native-execution/elf.ts'
import { captureNativeFile } from '../../src/lib/native-execution/files.ts'
import { captureNativeLayout } from '../../src/lib/native-execution/layout.ts'
import { getLinuxPidfdCalls } from '../../src/lib/process/linux.ts'
import { OwnedLinuxNamespace } from '../../src/lib/process/linux-domain.ts'
import { compileLinuxSeccompFilter } from '../../src/runtime/shell/native/seccomp.ts'

/** Real trusted-canary fixture; not a substitute for product admission or an Agent host. */
export async function nativeLinuxDomainFixture() {
  if (process.platform !== 'linux' || (process.arch !== 'x64' && process.arch !== 'arm64'))
    throw new Error('unsupported native ABI')
  getLinuxPidfdCalls()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-native-linux-domain-')))
  const entryPath = join(root, 'linux-entry.mjs')
  writeFileSync(
    entryPath,
    stripTypeScriptTypes(
      readFileSync(
        new URL('../../src/runtime/shell/native/linux-entry.ts', import.meta.url),
        'utf8',
      ),
      { mode: 'strip' },
    ),
    { mode: 0o400 },
  )
  const entry = captureNativeFile({ path: entryPath, executable: false })
  const filter = join(root, 'seccomp.bpf')
  writeFileSync(filter, compileLinuxSeccompFilter(process.arch), { mode: 0o600 })
  const libraries = ['/usr/lib', '/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu'].filter(
    (path) => {
      try {
        realpathSync(path)
        return true
      } catch {
        return false
      }
    },
  )
  const probe = join(root, 'probe')
  const compiled = spawnSync(
    '/usr/bin/cc',
    [
      '-std=c11',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      fileURLToPath(new URL('./native-seccomp-probe.c', import.meta.url)),
      '-o',
      probe,
    ],
    {
      env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      encoding: 'utf8',
      timeout: 10_000,
    },
  )
  if (compiled.status !== 0 || compiled.signal || compiled.error)
    throw new Error(`Native compilation failed; retained ${root}: ${compiled.stderr}`)
  const closure = captureLinuxElfClosure(
    [
      '/usr/bin/bash',
      process.execPath,
      '/usr/bin/true',
      '/usr/bin/setsid',
      '/usr/bin/sleep',
      probe,
    ],
    libraries,
  )
  const binaries = await captureNativeLayout({
    registeredPath: '/usr/bin',
    writable: false,
    readableRoots: [...libraries, '/usr/bin', '/dev/null'],
    readOnlyPaths: [],
  })
  let starts = 0,
    finished = 0
  return {
    root,
    probe,
    async start(
      arguments_: readonly string[] = ['--noprofile', '--norc', '-s'],
      lifecycle?: {
        beforeSpawn(workspace: string): void
        bind(owner: OwnedLinuxNamespace): void
        beforeEntry?(owner: OwnedLinuxNamespace): Promise<void>
      },
    ) {
      const workspace = join(root, `workspace-${++starts}`)
      mkdirSync(workspace)
      const writable = await captureNativeLayout({
        registeredPath: workspace,
        writable: true,
        readableRoots: [],
        readOnlyPaths: [],
      })
      closure.revalidate()
      await binaries.revalidate()
      await writable.revalidate()
      const args = [
        '--unshare-user',
        '--unshare-pid',
        '--unshare-net',
        '--unshare-ipc',
        '--unshare-uts',
        '--die-with-parent',
        '--new-session',
        '--cap-drop',
        'ALL',
        '--ro-bind-fd',
        '6',
        '/usr/bin',
        '--dir',
        '/usr/lib',
        '--symlink',
        'usr/bin',
        '/bin',
        '--symlink',
        'usr/lib',
        '/lib',
        '--symlink',
        'usr/lib',
        '/lib64',
        '--proc',
        '/proc',
        '--remount-ro',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--bind-fd',
        '7',
        workspace,
        '--chdir',
        workspace,
        '--seccomp',
        '3',
        '--json-status-fd',
        '4',
        '--block-fd',
        '5',
      ]
      const mounted = new Set<string>()
      const sourceFds: number[] = []
      for (const binding of closure.bindings) {
        const target = binding.path.replace(/^\/lib(?:64)?(?=\/)/, '/usr/lib')
        if (mounted.has(target)) continue
        mounted.add(target)
        const fd = 8 + sourceFds.length
        sourceFds.push(binding.file.fd)
        args.push('--ro-bind-fd', String(fd), target)
      }
      if (
        arguments_.slice(0, 3).join(' ') !== '--noprofile --norc -s' ||
        (arguments_.length > 3 && arguments_[3] !== '--')
      )
        throw new Error('Native fixture requires fixed stdin entry')
      const nonce = randomUUID()
      const entryPrefix = `BAZILION_NATIVE_READY:${nonce}\n`
      args.push('--ro-bind-fd', String(8 + sourceFds.length), entryPath)
      sourceFds.push(entry.fd)
      args.push(
        '--remount-ro',
        '/',
        '--',
        process.execPath,
        '--jitless',
        entryPath,
        nonce,
        ...arguments_.slice(4),
      )
      const descriptor = openSync(filter, 'r')
      let child: ChildProcess
      try {
        lifecycle?.beforeSpawn(workspace)
        child = spawn('/usr/bin/bwrap', args, {
          detached: true,
          env: { PATH: '/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C' },
          stdio: [
            'pipe',
            'pipe',
            'pipe',
            descriptor,
            'pipe',
            'pipe',
            binaries.directory.fd,
            writable.directory.fd,
            ...sourceFds,
          ],
        })
      } finally {
        closeSync(descriptor)
      }
      const closed = once(child, 'close')
      let stdout = '',
        stderr = ''
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
      const owner = new OwnedLinuxNamespace(child, nonce)
      lifecycle?.bind(owner)
      await lifecycle?.beforeEntry?.(owner)
      const gate = child.stdio.at(5)
      if (!(gate instanceof Writable)) throw new Error('Native fixture gate unavailable')
      // Only the fixed trusted entry runs now. No command bytes are released before full ack.
      gate.end('1')
      let released = false,
        done = false
      return {
        child,
        owner,
        workspace,
        closed,
        get stdout() {
          return stdout.startsWith(entryPrefix) ? stdout.slice(entryPrefix.length) : stdout
        },
        get stderr() {
          return stderr
        },
        async release(input = '') {
          if (released) throw new Error('Native fixture gate already released')
          await owner.ready
          released = true
          await owner.execute(input)
        },
        async waitSettled() {
          await closed
          const deadline = performance.now() + 3500
          while (!owner.isSettled() && performance.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 10))
          return owner.isSettled()
        },
        finish() {
          if (done) return true
          if (!owner.closeSettled() && owner.observation().root !== 'closed') return false
          writable.close()
          done = true
          finished++
          return true
        },
      }
    },
    cleanup() {
      if (finished !== starts) throw new Error(`Native ownership unknown; retained ${root}`)
      binaries.close()
      entry.close()
      closure.close()
      rmSync(root, { recursive: true })
    },
  }
}
