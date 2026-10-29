import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { executeNativeCommand, NativeCommandError } from '../../src/lib/native-execution/command.ts'
import { prepareNativeDarwinView } from '../../src/lib/native-execution/darwin-view.ts'
import { prepareNativeRuntime } from '../../src/lib/native-execution/runtime.ts'

/** Actual double-fork/setsid/closed-pipe canary; no oracle PID grants signalling authority. */
export async function runNativeDarwinLifetimeFixture() {
  assert.equal(process.platform, 'darwin')
  assert.equal(process.arch, 'arm64')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-darwin-lifetime-')))
  const workspace = join(root, 'workspace'),
    runtimeRoot = join(root, 'runtime'),
    slot = join(root, 'slot')
  for (const path of [workspace, join(workspace, 'memory'), runtimeRoot, slot])
    mkdirSync(path, { mode: 0o700 })
  const writer = join(root, 'writer'),
    ticks = join(workspace, 'ticks')
  const db = openDb(join(root, 'state.sqlite'))
  runMigrations(db)
  db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
  const lifecycle = workspaceLifecycle(db),
    lease = lifecycle.coordinator.claim('one', workspace, 'agent')
  let closeOutside: (() => Promise<void>) | undefined, descriptor: number | undefined
  try {
    execFileSync(
      '/usr/bin/clang',
      [
        '-Wall',
        '-Wextra',
        '-Werror',
        fileURLToPath(new URL('./native-darwin-writer.c', import.meta.url)),
        '-o',
        writer,
      ],
      { timeout: 15_000, stdio: 'pipe' },
    )
    // Calibrate only a fresh controlled child, never another user's argv/environment. Its PID is
    // an attack target here, not cleanup authority; original stdin EOF is the only retirement path.
    const outside = spawn(
      process.execPath,
      [
        '-e',
        "process.stdin.resume();process.stdin.on('end',()=>process.exit(0));process.stdout.write('controlled-ready\\n')",
        'BAZILION_NATIVE_CONTROLLED_OUTSIDE_ARG',
      ],
      { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let ready = false,
      outsideOutput = '',
      startError: unknown
    outside.on('error', (error) => {
      startError = error
    })
    outside.stdout.on('data', (bytes) => {
      outsideOutput = (outsideOutput + bytes.toString()).slice(-128)
      ready ||= outsideOutput.includes('controlled-ready')
    })
    outside.stderr.resume()
    const closed = new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
      naturalEOF: boolean
    }>((resolve) =>
      outside.once('close', (code, signal) =>
        resolve({
          code,
          signal,
          naturalEOF: outside.stdout.readableEnded && outside.stderr.readableEnded,
        }),
      ),
    )
    let closing: Promise<void> | undefined
    closeOutside = () =>
      (closing ??= (async () => {
        outside.stdin.end()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const result = await Promise.race([
            closed,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('controlled outside child closure unconfirmed')),
                2000,
              )
            }),
          ])
          assert.deepEqual(result, { code: 0, signal: null, naturalEOF: true })
        } finally {
          if (timer) clearTimeout(timer)
        }
      })())
    const readyDeadline = performance.now() + 2000
    while (!ready && !startError && performance.now() < readyDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(startError, undefined)
    assert(ready)
    assert(outside.pid)
    const probe = JSON.parse(
      execFileSync(writer, [String(outside.pid), 'probe-args'], {
        encoding: 'utf8',
        timeout: 2000,
      }),
    )
    assert.deepEqual(probe, { status: 0, errno: 0, marker: 1 })
    const marker = join(root, 'outside-marker')
    writeFileSync(marker, 'controlled-fd-marker', { flag: 'wx' })
    descriptor = openSync(marker, 'r')
    const fdProbe = JSON.parse(
      execFileSync(writer, ['unused', 'probe-fds'], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'pipe', descriptor],
      }),
    )
    assert.deepEqual(fdProbe, { inherited: 1 })
    const runtime = await prepareNativeRuntime(runtimeRoot)
    const view = await prepareNativeDarwinView(
      {
        root: slot,
        workspace,
        cwd: '.',
        env: {},
        readOnlyDirectories: [],
        readOnlyFiles: [{ path: writer, executable: true }],
        unavailable: [],
      },
      runtime,
    )
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const command = `set -e\n${quote(writer)} ${outside.pid} probe-args\n${quote(writer)} unused probe-fds\n${quote(writer)} ${quote(ticks)} linger`
    let stdout = ''
    let failure: unknown
    try {
      await executeNativeCommand({
        view,
        lifecycle,
        lease,
        command,
        toolCallId: 'detached-writer',
        timeoutMs: 5000,
        approvalHost: {
          async requestApproval(input) {
            return input.command === command && input.toolCallId === 'detached-writer'
              ? 'approved'
              : 'denied'
          },
        },
        onOutput(stream, bytes) {
          if (stream === 'stdout') {
            stdout += bytes.toString()
            assert(stdout.length <= 4096)
          }
        },
      })
    } catch (error) {
      failure = error
    }
    const lines = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(lines, [{ status: -1, errno: 1, marker: 0 }, { inherited: 0 }])
    assert(failure instanceof NativeCommandError)
    assert.equal(failure.code, 'recovery_required')
    assert.equal(failure.cleanupConfirmed, false)
    assert.equal(failure.observation?.domain.commandCompleted, true)
    assert.equal(failure.observation?.domain.commandNaturalEOF, true)
    assert.equal(failure.observation?.domain.ownerLive, true)
    assert.equal(failure.observation?.domain.terminalProof, false)
    assert(
      failure.observation?.domain.captures.some(
        (value) => value.kind === 'observation' && value.state === 'busy',
      ),
    )
    assert.equal(db.raw.query('SELECT id FROM workspace_writers').all().length, 1)
    assert.equal(
      db.raw
        .query(
          'SELECT id FROM workspace_resources WHERE creation_acknowledged=1 AND cleanup_confirmed=0',
        )
        .all().length,
      1,
    )
    assert.equal(runtime.close(), false)
    assert.equal(existsSync(slot), true)
    // Observe only the fixture's private bytes. Expiry is not settlement and no PID is signalled.
    const deadline = performance.now() + 10_000
    while (
      (!existsSync(ticks) || !readFileSync(ticks, 'utf8').endsWith('\nfinished\n')) &&
      performance.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert(readFileSync(ticks, 'utf8').endsWith('\nfinished\n'))
    // The same canonical registry still owns the original helper. It must acquire a fresh full
    // empty-domain/terminal proof before releasing resources; natural canary expiry is insufficient.
    await lifecycle.release(lease)
    assert.equal(db.raw.query('SELECT id FROM workspace_writers').all().length, 0)
    assert.equal(
      db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all().length,
      0,
    )
    assert.equal(runtime.close(), true)
    assert.equal(failure.cleanupConfirmed, false)
    await closeOutside()
    closeSync(descriptor)
    descriptor = undefined
    db.close()
    rmSync(root, { recursive: true })
    return {
      outsideProcargsDenied: true,
      inheritedDescriptorsClosed: true,
      detachedWriterHeld: true,
      naturalCommandEOFWasInsufficient: true,
      originalLiveOwnerRecoveryPositive: true,
      expiryWasNotSettlementAuthority: true,
      effectsReplayed: false,
    }
  } catch (cause) {
    let failure = cause
    try {
      await closeOutside?.()
    } catch (cleanup) {
      failure = new AggregateError([cause, cleanup], 'native and controlled outside-child failure')
    }
    if (descriptor !== undefined) closeSync(descriptor)
    throw new Error(`Native detached-writer control failed; retained ${root}`, { cause: failure })
  }
}
