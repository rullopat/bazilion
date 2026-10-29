import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { executeNativeCommand, NativeCommandError } from '../../src/lib/native-execution/command.ts'
import { prepareNativeLinuxView } from '../../src/lib/native-execution/linux-view.ts'
import { prepareNativeRuntime } from '../../src/lib/native-execution/runtime.ts'
import { BashApprovalDeniedError } from '../../src/runtime/shell/approval.ts'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'
const retained: unknown[] = []
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-command-'))),
    workspace = join(root, 'workspace'),
    slot = join(root, 'slot')
  mkdirSync(workspace)
  mkdirSync(join(workspace, 'memory'))
  mkdirSync(slot, { mode: 0o700 })
  writeFileSync(join(workspace, 'target'), 'controlled target')
  const db = openDb(join(root, 'state.sqlite'))
  runMigrations(db)
  db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
  const lifecycle = workspaceLifecycle(db),
    lease = lifecycle.coordinator.claim('one', workspace, 'agent')
  const runtimeRoot = join(root, 'runtime')
  mkdirSync(runtimeRoot, { mode: 0o700 })
  const runtime = await prepareNativeRuntime(runtimeRoot)
  const view = await prepareNativeLinuxView(
    {
      root: slot,
      workspace,
      cwd: '.',
      env: {},
      readOnlyDirectories: [],
      readOnlyFiles: [],
      unavailable: [],
    },
    runtime,
  )
  return {
    root,
    workspace,
    db,
    lifecycle,
    lease,
    view,
    runtime,
    async nextView() {
      const next = join(root, 'next-slot')
      mkdirSync(next, { mode: 0o700 })
      return prepareNativeLinuxView(
        {
          root: next,
          workspace,
          cwd: '.',
          env: {},
          readOnlyDirectories: [],
          readOnlyFiles: [],
          unavailable: [],
        },
        runtime,
      )
    },
    async close() {
      await lifecycle.release(lease)
      expect(db.raw.query('SELECT id FROM workspace_writers').all()).toEqual([])
      expect(runtime.close()).toBe(true)
      db.close()
      rmSync(root, { recursive: true })
    },
  }
}
async function known(visit: (input: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const input = await fixture()
  try {
    await visit(input)
    await input.close()
  } catch (cause) {
    retained.push(input)
    throw new Error(`Shared native command failed; retained ${input.root}`, { cause })
  }
}

test.skipIf(!enabled)(
  'one frozen runtime serves distinct command views with fresh filter descriptors',
  async () => {
    await known(async (input) => {
      const first = await executeNativeCommand({
        ...input,
        command: 'printf source-change > generated',
        toolCallId: 'first',
        timeoutMs: 5000,
        onOutput() {},
      })
      expect(first.code).toBe(0)
      const second = await input.nextView()
      expect(second.runtimeFacts).toEqual(input.view.runtimeFacts)
      let stdout = ''
      const result = await executeNativeCommand({
        ...input,
        view: second,
        command: `node -e "process.stdout.write(require('fs').readFileSync('/proc/self/status','utf8'))"`,
        toolCallId: 'second',
        timeoutMs: 5000,
        onOutput(stream, bytes) {
          if (stream === 'stdout') stdout += bytes.toString()
        },
      })
      expect(result.code).toBe(0)
      expect(stdout).toMatch(/^Seccomp:\s+2$/m)
      expect(readFileSync(join(input.workspace, 'generated'), 'utf8')).toBe('source-change')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'native views cannot borrow a different canonical workspace writer',
  async () => {
    await known(async (input) => {
      const otherRoot = join(input.root, 'other-workspace')
      mkdirSync(otherRoot)
      mkdirSync(join(otherRoot, 'memory'))
      const other = input.lifecycle.coordinator.claim('one', otherRoot, 'agent')
      try {
        expect(() =>
          input.lifecycle.native(other, input.view.backend, input.view.definition, input.view),
        ).toThrow('definition')
        expect(input.db.raw.query('SELECT id FROM workspace_resources').all()).toEqual([])
      } finally {
        other.finish(true)
        input.view.close()
      }
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'shared adapter reports actual nonzero exit and separates private ready frames from command output',
  async () => {
    await known(async (input) => {
      let stdout = '',
        stderr = ''
      const result = await executeNativeCommand({
        ...input,
        command: 'printf command-out; printf command-err >&2; exit 7',
        toolCallId: 'normal',
        timeoutMs: 5000,
        onOutput(stream, bytes) {
          if (stream === 'stdout') stdout += bytes
          else stderr += bytes
        },
      })
      expect(result).toEqual({
        code: 7,
        signal: null,
        stdoutTruncated: false,
        stderrTruncated: false,
      })
      expect(stdout).toBe('command-out')
      expect(stderr).toBe('command-err')
      await expect(input.view.revalidate()).rejects.toThrow('refused')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'unattended dangerous command denies before native intent, process or workspace effect',
  async () => {
    await known(async (input) => {
      await expect(
        executeNativeCommand({
          ...input,
          command: `rm -rf ${JSON.stringify(join(input.workspace, 'target'))}`,
          toolCallId: 'denied',
          timeoutMs: 5000,
          onOutput() {},
        }),
      ).rejects.toBeInstanceOf(BashApprovalDeniedError)
      expect(readFileSync(join(input.workspace, 'target'), 'utf8')).toBe('controlled target')
      expect(input.db.raw.query('SELECT id FROM workspace_resources').all()).toEqual([])
      await expect(input.view.revalidate()).rejects.toThrow('refused')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'approved dangerous command executes once through the same adapter',
  async () => {
    await known(async (input) => {
      let approvals = 0,
        stdout = ''
      const result = await executeNativeCommand({
        ...input,
        command: `rm -rf ${JSON.stringify(join(input.workspace, 'target'))}; printf approved`,
        toolCallId: 'approved',
        timeoutMs: 5000,
        approvalHost: {
          async requestApproval() {
            approvals++
            return 'approved'
          },
        },
        onOutput(stream, bytes) {
          if (stream === 'stdout') stdout += bytes
        },
      })
      expect(result.code).toBe(0)
      expect(approvals).toBe(1)
      expect(stdout).toBe('approved')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'active cancellation settles the live owned native domain and closes its retained view',
  async () => {
    await known(async (input) => {
      const abort = new AbortController()
      await expect(
        executeNativeCommand({
          ...input,
          command: 'printf started; sleep 30',
          toolCallId: 'cancelled',
          timeoutMs: 5000,
          signal: abort.signal,
          onOutput(stream, bytes) {
            if (stream === 'stdout' && bytes.toString().includes('started')) abort.abort()
          },
        }),
      ).rejects.toMatchObject({ code: 'cancelled', cleanupConfirmed: true })
      await expect(input.view.revalidate()).rejects.toThrow('refused')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'command timeout is distinct from cancellation and still requires positive native settlement',
  async () => {
    await known(async (input) => {
      await expect(
        executeNativeCommand({
          ...input,
          command: 'sleep 30',
          toolCallId: 'timed-out',
          timeoutMs: 200,
          onOutput() {},
        }),
      ).rejects.toMatchObject({ code: 'timed_out', cleanupConfirmed: true })
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'output sink failure unwinds through live retirement without exposing its private cause',
  async () => {
    await known(async (input) => {
      let error: unknown
      try {
        await executeNativeCommand({
          ...input,
          command: 'printf output; sleep 30',
          toolCallId: 'sink-error',
          timeoutMs: 5000,
          onOutput() {
            throw new Error('private-sink-canary')
          },
        })
      } catch (cause) {
        error = cause
      }
      expect(error).toMatchObject({ code: 'unavailable', cleanupConfirmed: true })
      expect((error as Error).message).not.toContain('private-sink-canary')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'combined retained output is bounded and truncation is an explicit executor fact',
  async () => {
    await known(async (input) => {
      let bytes = 0
      const result = await executeNativeCommand({
        ...input,
        command: `node -e "process.stdout.write('x'.repeat(3*1024*1024))"`,
        toolCallId: 'bounded-output',
        timeoutMs: 5000,
        onOutput(_stream, chunk) {
          bytes += chunk.length
        },
      })
      expect(result.code).toBe(0)
      expect(result.stdoutTruncated).toBe(true)
      expect(bytes).toBe(2 * 1024 * 1024)
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'restored canonical state revokes cleanup and retains the actual admitted view',
  async () => {
    const input = await fixture()
    retained.push(input)
    let restored = false,
      error: unknown
    try {
      await executeNativeCommand({
        ...input,
        command: 'printf restore-now; sleep 0.1',
        toolCallId: 'restored',
        timeoutMs: 5000,
        onOutput(stream, bytes) {
          if (!restored && stream === 'stdout' && bytes.toString().includes('restore-now')) {
            restored = true
            input.db.raw.run("UPDATE workspace_writers SET recovery_mode='restored' WHERE id=?", [
              input.lease.writer.id,
            ])
          }
        },
      })
    } catch (cause) {
      error = cause
    }
    expect(restored).toBe(true)
    expect(error).toBeInstanceOf(NativeCommandError)
    expect(error).toMatchObject({ code: 'recovery_required', cleanupConfirmed: false })
    expect(input.runtime.close()).toBe(false)
    input.view.manager.revalidate()
    expect(
      input.db.raw.query('SELECT cleanup_confirmed FROM workspace_resources').get(),
    ).toMatchObject({ cleanup_confirmed: 0 })
    input.lease.finish(false)
    expect(() => input.lifecycle.coordinator.claim('one', input.workspace, 'agent')).toThrow(
      'workspace_recovery_required',
    )
    // No force-close, guessed signalling, database acknowledgement or fixture deletion.
  },
  20_000,
)
