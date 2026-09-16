import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { runMigrations } from '../../daemon/src/core/db/migrate.ts'
import { getCodingCommand, saveCodingCommand } from '../../daemon/src/core/repos/coding-commands.ts'
import { saveSourceSnapshot } from '../../daemon/src/core/repos/source-snapshots.ts'
import {
  claimVerificationAttempt,
  createVerificationRequest,
  finishVerificationAttempt,
  getVerificationRequest,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
  recordVerificationCheckOutcome,
  VERIFICATION_REQUEST_TTL_MS,
} from '../../daemon/src/core/repos/verification-requests.ts'
import { WorkspaceCoordinator } from '../../daemon/src/lib/coding-environment/workspace.ts'
import { invalidateRestoredCodingEvidence } from '../src/backup-coding-recovery.ts'

test('restore invalidates Agent receipts and never treats copied writer records as kill authority', async () => {
  const home = mkdtempSync(join(tmpdir(), 'coding-restore-'))
  const root = join(home, 'teams', 'example')
  mkdirSync(root, { recursive: true })
  const db = openDb(join(home, 'db'))
  try {
    runMigrations(db)
    db.raw.run("INSERT INTO teams(id,name,created_at) VALUES ('example','Example',0)")
    const coordinator = new WorkspaceCoordinator(db)
    const lease = coordinator.claim('example', root, 'agent')
    const receipt = {
      id: 'receipt',
      agentId: 'agent',
      teamId: 'example',
      turnId: 'turn',
      toolCallId: 'tool',
      input: {
        command: 'node --version',
        cwd: '.',
        purpose: 'runtime' as const,
        timeoutSeconds: 30,
      },
      environment: {
        posture: 'protected' as const,
        imageId: 'sha256:fixture',
        cwd: '.',
        rootIdentity: lease.writer.rootIdentity,
        inputFingerprint: 'before',
        capturedAt: Date.now(),
        restrictions: [],
      },
      startedAt: Date.now(),
      finishedAt: null,
      state: 'running' as const,
      exitCode: null,
      diagnostic: '',
      truncated: false,
      reason: null,
    }
    saveCodingCommand(db, receipt)
    const raw = new DatabaseSync(join(home, 'db'))
    try {
      invalidateRestoredCodingEvidence(raw, home, join(home, 'restored'))
    } finally {
      raw.close()
    }
    expect(getCodingCommand(db, 'receipt')?.state).toBe('interrupted')
    expect(getCodingCommand(db, 'receipt')?.environment.inputFingerprint).toBeNull()
    const restored = new WorkspaceCoordinator(db)
    expect(
      await restored.recover(lease.writer.id, async () => {
        throw new Error('must not terminate copied resources')
      }),
    ).toBe(false)
    expect(() => restored.claim('example', root, 'agent')).toThrow('workspace_recovery_required')
  } finally {
    db.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('restore revalidates captured verification evidence instead of replaying it', () => {
  const home = mkdtempSync(join(tmpdir(), 'verification-restore-'))
  mkdirSync(join(home, 'teams', 'example'), { recursive: true })
  const db = openDb(join(home, 'db'))
  try {
    runMigrations(db)
    db.raw.run("INSERT INTO teams(id,name,created_at) VALUES ('example','Example',0)")
    db.raw.run(
      `INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at)
       VALUES ('profile','Profile','p','lmstudio:model',1,1)`,
    )
    for (const id of ['coder', 'tester']) {
      db.raw.run(
        `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
         VALUES (?, 'profile', ?, 'idle', ?, 'example', 1)`,
        [id, id, `/tmp/${id}`],
      )
    }
    const request = (id: string, snapshotId: string, now: number) =>
      createVerificationRequest(db, {
        id,
        teamId: 'example',
        requesterKind: 'agent',
        requesterAgentId: 'coder',
        recipientAgentId: 'tester',
        snapshotId,
        snapshotComplete: true,
        head: 'head',
        baseOid: 'base',
        environment: { image: 'debian', sandbox: 'off' },
        checks: [{ command: 'pnpm test', cwd: '.', purpose: 'suite', timeoutMs: 5_000 }],
        now,
      })
    // Evidence that survived the round-trip, evidence that did not, and one past its window.
    saveSourceSnapshot(db, {
      snapshotId: 'snap-kept',
      teamId: 'example',
      capturedBy: 'operator',
      agentId: null,
      turnId: null,
      toolCallId: null,
      complete: true,
      head: 'head',
      baseOid: 'base',
      entryCount: 0,
      capturedContentBytes: 0,
      manifestJson: '{}',
    })
    const now = Date.now()
    request('kept', 'snap-kept', now)
    request('lost', 'snap-gone', now)
    request('expired', 'snap-kept', now - VERIFICATION_REQUEST_TTL_MS - 1)
    // One request with an open claim and one whose attempts already reported outcomes.
    const openClaim = claimVerificationAttempt(db, {
      requestId: 'kept',
      leaseOwner: 'daemon-before-backup',
      leaseMs: 60_000,
    })
    request('ran', 'snap-kept', now)
    const ranClaim = claimVerificationAttempt(db, {
      requestId: 'ran',
      leaseOwner: 'daemon-before-backup',
      leaseMs: 60_000,
    })
    saveCodingCommand(db, {
      id: 'receipt',
      agentId: 'tester',
      teamId: 'example',
      turnId: 'turn',
      toolCallId: 'tool',
      input: { command: 'pnpm test', cwd: '.', purpose: 'verification', timeoutSeconds: 5 },
      environment: {
        posture: 'protected',
        imageId: 'sha256:fixture',
        cwd: '.',
        rootIdentity: 'root',
        inputFingerprint: 'before',
        capturedAt: now,
        restrictions: [],
      },
      startedAt: now,
      finishedAt: now + 1,
      state: 'succeeded',
      exitCode: 0,
      diagnostic: '',
      truncated: false,
      reason: null,
    })
    recordVerificationCheckOutcome(db, {
      attemptId: ranClaim?.attempt.id ?? '',
      ordinal: 0,
      state: 'succeeded',
      commandId: 'receipt',
      exitCode: 0,
      finishedAt: now + 1,
    })
    finishVerificationAttempt(db, {
      attemptId: ranClaim?.attempt.id ?? '',
      leaseOwner: 'daemon-before-backup',
      state: 'completed',
      now: now + 1,
    })

    const raw = new DatabaseSync(join(home, 'db'))
    try {
      invalidateRestoredCodingEvidence(raw, home, join(home, 'restored'))
    } finally {
      raw.close()
    }

    // A resumable request keeps its window and stays eligible.
    expect(getVerificationRequest(db, 'example', 'kept')?.state).toBe('running')
    expect(listVerificationAttempts(db, 'kept')[0]).toMatchObject({
      state: 'uncertain',
      leaseOwner: null,
      error: 'execution was interrupted by a backup restore',
    })
    // The claim is settled, so nothing will run it again by itself.
    expect(
      claimVerificationAttempt(db, {
        requestId: 'kept',
        leaseOwner: 'daemon-after-restore',
        leaseMs: 60_000,
      }),
    ).toBeNull()
    // Captured evidence that did not survive cannot be executed: blocked, not silently run.
    expect(getVerificationRequest(db, 'example', 'lost')?.state).toBe('blocked')
    expect(getVerificationRequest(db, 'example', 'expired')).toBeNull()
    // A receipt-backed result does not present the copied home's evidence as current.
    const outcomes = listVerificationCheckOutcomes(db, ranClaim?.attempt.id ?? '')
    expect(outcomes[0]).toMatchObject({ state: 'unknown', commandId: null, exitCode: null })
    expect(getVerificationRequest(db, 'example', 'ran')?.state).toBe('uncertain')
    expect(listVerificationAttempts(db, 'ran')[0]).toMatchObject({
      state: 'uncertain',
      error: 'evidence was invalidated by a backup restore',
    })
    expect(openClaim?.attempt.id).toBeTruthy()
  } finally {
    db.close()
    rmSync(home, { recursive: true, force: true })
  }
})
