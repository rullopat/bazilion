import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NativeCommandFailureObservation } from '../../src/lib/native-execution/command.ts'
import { getDarwinProcessInspector } from '../../src/lib/process/darwin.ts'
import { DarwinCensusReader } from '../../src/lib/process/darwin-census.ts'
import { runNativeWorkerFixture } from './native-worker.ts'

interface Incident {
  phase: string
  retained?: string
  observation?: NativeCommandFailureObservation
  canonicalResourcesConfirmed?: boolean
  templateRetired?: boolean
}
/** Two actual outside lifetimes invalidate both independent captures. No census row is changed. */
export async function runNativeWorkerRetirementFixture(
  tool: 'coding_command' | 'bash' = 'coding_command',
) {
  assert.equal(process.platform, 'darwin')
  assert.equal(process.arch, 'arm64')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-retirement-control-')))
  const original = DarwinCensusReader.prototype.inventory,
    originalError = console.error
  const incidents: Incident[] = [],
    closures: Promise<{ code: number | null; signal: NodeJS.Signals | null }>[] = []
  const inspector = getDarwinProcessInspector()
  let active = false,
    calls = 0,
    failure: unknown
  console.error = (...args: unknown[]) => {
    originalError(...args)
    for (const arg of args)
      if (typeof arg === 'string') {
        try {
          const entry = JSON.parse(arg) as Incident
          if (entry.phase?.startsWith('native-worker-failure')) incidents.push(entry)
        } catch {
          /* Not our diagnostic frame. */
        }
      }
  }
  DarwinCensusReader.prototype.inventory = function () {
    const real = original.call(this)
    if (active) {
      calls++
      if (calls % 2 === 1 && closures.length < 2 && real.kind === 'inventory') {
        const child = spawn('/bin/sleep', ['1'], {
          cwd: root,
          env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, LANG: 'C' },
          detached: true,
          stdio: 'ignore',
        })
        closures.push(
          new Promise((resolve) =>
            child.once('close', (code, signal) => resolve({ code, signal })),
          ),
        )
        assert.ok(child.pid)
        const identity = inspector.member(child.pid)
        assert(
          identity &&
            identity.parent === process.pid &&
            identity.group === child.pid &&
            identity.session === child.pid,
        )
      }
    }
    return real
  }
  try {
    await runNativeWorkerFixture('protected', {
      ...(tool === 'coding_command'
        ? {
            onCodingStart() {
              active = true
              calls = 0
            },
          }
        : {
            onNativeStart() {
              if (!active) {
                active = true
                calls = 0
              }
            },
          }),
    })
  } catch (error) {
    failure = error
  } finally {
    DarwinCensusReader.prototype.inventory = original
    console.error = originalError
  }
  assert(failure instanceof Error, 'controlled retirement drift must not pass as normal completion')
  assert.equal(closures.length, 2)
  const first = incidents.find((x) => x.phase === 'native-worker-failure')
  const recovery = incidents.find((x) => x.phase === 'native-worker-failure-teardown')
  assert.ok(first?.retained)
  const retained = realpathSync(first.retained)
  assert.equal(retained, first.retained)
  assert.equal(dirname(retained), realpathSync(tmpdir()))
  assert(basename(retained).startsWith('native-worker-'))
  assert.equal(lstatSync(retained).isSymbolicLink(), false)
  const domain = first.observation?.domain
  assert(domain)
  assert.deepEqual(domain.captures, [
    { kind: 'unknown', reason: 'drift' },
    { kind: 'unknown', reason: 'drift' },
  ])
  assert.equal(domain.commandNaturalEOF, true)
  assert.equal(domain.ownerLive, true)
  assert.equal(domain.terminalProof, false)
  assert.equal(recovery?.canonicalResourcesConfirmed, true)
  assert.equal(recovery?.templateRetired, true)
  assert(failure.cause instanceof Error)
  assert.match(failure.cause.message, /Native cleanup could not be confirmed/)
  const db = new DatabaseSync(join(retained, 'bazilion.db'), { readOnly: true })
  try {
    const rows = db.prepare('SELECT receipt_json FROM coding_commands').all()
    assert.equal(rows.length, tool === 'coding_command' ? 1 : 0)
    if (tool === 'coding_command') {
      const row = rows[0]
      assert.equal(typeof row?.receipt_json, 'string')
      const receipt = JSON.parse(String(row?.receipt_json))
      assert.equal(receipt.state, 'interrupted')
      assert.equal(receipt.exitCode, null)
      assert.equal(receipt.environment.posture, 'native')
      assert.equal(receipt.reason, 'Native execution recovery_required')
    } else {
      const results = readdirSync(join(retained, 'agents')).flatMap((agent) => {
        const sessions = join(retained, 'agents', agent, 'sessions')
        return readdirSync(sessions)
          .filter((file) => file.endsWith('.jsonl'))
          .flatMap((file) =>
            readFileSync(join(sessions, file), 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
          )
          .filter((row) => row.type === 'message' && row.message?.role === 'toolResult')
          .map((row) => row.message)
      })
      const bash = results.find((result) => result.toolCallId === 'native-worker-bash')
      assert.equal(bash?.isError, true)
      assert.deepEqual(bash.details?.nativeExecutionFailure, {
        code: 'recovery_required',
        cleanupConfirmed: false,
        observation: {
          backend: 'darwin-seatbelt',
          phase: 'census',
          ownerLive: true,
          commandCompleted: true,
          commandNaturalEOF: true,
          fenced: true,
          terminalProof: false,
          captures: ['drift', 'drift'],
        },
      })
      assert.match(bash.content[0].text, /diagnostics, not cleanup authority/)
    }
    assert.equal(db.prepare('SELECT id FROM workspace_writers').all().length, 0)
    assert.equal(
      db.prepare('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all().length,
      0,
    )
  } finally {
    db.close()
  }
  const natural = await Promise.all(closures)
  assert(natural.every((value) => value.code === 0 && value.signal === null))
  rmSync(root, { recursive: true })
  return {
    node: process.version,
    expectedControlledFailureObserved: true,
    firstClosedFacts: domain,
    realInventoryUnmodified: true,
    realOutsideLifetimeChanges: 2,
    interruptedReceiptPersisted: tool === 'coding_command',
    canonicalBashFailureFactsPersisted: tool === 'bash',
    independentChildrenExitedNaturally: true,
    fixtureExpiryIsNotSettlementEvidence: true,
    oracleConfersNoSignallingAuthority: true,
    canonicalLiveOwnerRecoveryPositive: true,
    templateRetiredOnlyAfterPositiveViewRelease: true,
    originalRunStillFailed: true,
    originalDeadlinesAndCensusChecksUnchanged: true,
    effectsReplayed: false,
    productionBackendQualified: false,
  }
}
