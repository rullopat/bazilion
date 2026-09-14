import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { runMigrations } from '../../daemon/src/core/db/migrate.ts'
import { getCodingCommand, saveCodingCommand } from '../../daemon/src/core/repos/coding-commands.ts'
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
