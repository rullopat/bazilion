import { spawnSync } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { compileLinuxSeccompFilter } from '../../src/runtime/shell/native/seccomp.ts'

// Explicit real-native lane, pending the approved CI transition; never a mocked platform pass.
const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'

test.skipIf(!enabled)(
  'actual Bubblewrap installs the mandatory IPC-only filter before C/Node execution',
  () => {
    if (process.arch !== 'x64' && process.arch !== 'arm64') throw new Error('unsupported test ABI')
    const root = mkdtempSync(join(tmpdir(), 'bazilion-native-seccomp-'))
    const probe = join(root, 'probe')
    const filter = join(root, 'seccomp.bpf')
    const source = fileURLToPath(new URL('../fixtures/native-seccomp-probe.c', import.meta.url))
    const env = { PATH: '/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C' }
    const compile = spawnSync(
      '/usr/bin/cc',
      ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', source, '-o', probe],
      {
        env,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      },
    )
    if (compile.status !== 0 || compile.signal || compile.error) {
      throw new Error(`Native probe compilation failed; retained ${root}: ${compile.stderr}`)
    }
    writeFileSync(filter, compileLinuxSeccompFilter(process.arch), { mode: 0o600 })

    function run(filtered: boolean, node = false) {
      const workspace = join(root, node ? 'node' : filtered ? 'filtered' : 'control')
      const memory = join(workspace, 'memory')
      mkdirSync(memory, { recursive: true, mode: 0o700 })
      writeFileSync(join(memory, 'note.txt'), 'read-only-memory')
      const descriptor = openSync(filter, 'r')
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
        '--ro-bind',
        '/usr',
        '/usr',
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
        '--dev',
        '/dev',
        '--dir',
        '/tmp',
        '--bind',
        workspace,
        '/work',
        '--ro-bind',
        memory,
        '/work/memory',
        '--ro-bind',
        probe,
        '/probe',
        '--chdir',
        '/work',
        '--json-status-fd',
        '4',
        ...(filtered ? ['--seccomp', '3'] : []),
      ]
      if (node) args.push('--ro-bind', process.execPath, '/node')
      const program = node
        ? [
            '/node',
            '--input-type=module',
            '-e',
            `import { writeFileSync } from 'node:fs';
       import { spawnSync } from 'node:child_process';
       import { Worker } from 'node:worker_threads';
       import { randomBytes } from 'node:crypto';
       writeFileSync('/work/node.txt', randomBytes(16));
       if (spawnSync('/usr/bin/true').status !== 0) throw Error('nested command failed');
       const worker = new Worker('import {parentPort} from "node:worker_threads"; parentPort.postMessage(42)', {eval: true, execArgv: ['--input-type=module']});
       const exited = new Promise((resolve, reject) => {worker.once('exit', code => code === 0 ? resolve() : reject(Error('thread failed')))});
       const value = await new Promise((resolve, reject) => {worker.once('message', resolve); worker.once('error', reject)});
       await exited;
       console.log(JSON.stringify({nodeRuntime: true, thread: value, canary: !!process.env.BAZILION_NATIVE_PARENT_CANARY}));`,
          ]
        : ['/probe']
      try {
        const result = spawnSync('/usr/bin/bwrap', [...args, '--', ...program], {
          env: filtered ? env : { ...env, BAZILION_NATIVE_PARENT_CANARY: 'synthetic-canary' },
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 256 * 1024,
          stdio: ['ignore', 'pipe', 'pipe', descriptor, 'pipe'],
        })
        if (result.status !== 0 || result.signal || result.error) {
          throw new Error(`Native execution failed; retained ${root}: ${result.stderr}`)
        }
        const status = result.output[4]
        if (typeof status !== 'string') throw new Error(`Missing native status; retained ${root}`)
        const frames = status
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(
          frames.some(
            (frame) => Number.isSafeInteger(frame['child-pid']) && frame['child-pid'] > 0,
          ),
        ).toBe(true)
        expect(frames.some((frame) => frame['exit-code'] === 0)).toBe(true)
        // The status PID is evidence only, never used for signalling or adopted after restart.
        expect(readFileSync(join(memory, 'note.txt'), 'utf8')).toBe('read-only-memory')
        return JSON.parse(result.stdout.trim())
      } finally {
        closeSync(descriptor)
      }
    }

    // Counterfactual same namespace/view with a trusted fixed probe, not an admitted unfiltered tool.
    const control = run(false)
    for (const key of ['ipv4Tcp', 'ipv4Udp', 'ipv6Tcp', 'ipv6Udp', 'netlink'])
      expect(control[key]).toBe(0)
    expect(control.unknown).toBe(constants.errno.ENOSYS)
    expect(control.nsIoctl).toBe(constants.errno.EBADF)
    expect(control.terminal).toBe(constants.errno.EBADF)
    expect(control.debug).toBe(0)
    expect(control.parentCanaryPresent).toBe(true)

    const actual = run(true)
    for (const key of [
      'ipv4Tcp',
      'ipv4Udp',
      'ipv6Tcp',
      'ipv6Udp',
      'netlink',
      'unknown',
      'unshare',
      'setns',
      'debug',
      'nsIoctl',
      'terminal',
    ]) {
      expect(actual[key]).toBe(constants.errno.EPERM)
    }
    expect([constants.errno.EACCES, constants.errno.EPERM]).toContain(actual.initMem)
    expect(actual.pid).toBe(2)
    expect(actual).toMatchObject({
      pair: 1,
      pathIpc: 1,
      forkSetsid: 1,
      seccomp: 2,
      noNewPrivs: 1,
      zeroCaps: true,
      fd3: constants.errno.EBADF,
      fd4: constants.errno.EBADF,
      clone3: constants.errno.ENOSYS,
      workspaceWrite: 0,
      memoryWrite: constants.errno.EROFS,
      parentCanaryPresent: false,
    })
    expect(run(true, true)).toEqual({ nodeRuntime: true, thread: 42, canary: false })
    // Only the all-success path disposes its home; every failure retains diagnostics and inputs.
    rmSync(root, { recursive: true })
  },
  40_000,
)
