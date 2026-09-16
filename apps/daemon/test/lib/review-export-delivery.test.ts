import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import * as communicationApprovalRepo from '../../src/core/repos/communicationApprovals.ts'
import * as results from '../../src/core/repos/results.ts'
import { planApprovalDelivery } from '../../src/lib/approval-delivery-plan.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureReviewPacket } from '../../src/lib/review/capture.ts'
import { deliverReviewExport } from '../../src/lib/review/deliver-export.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 criterion 4: an export is a publication, not a download.
//
// The rule under test is that nothing about an export bypasses the shipped egress contract: the bytes are
// published *held*, the existing authorizer decides, and only an `allow` releases them. A held export must
// be genuinely unreadable — not merely unreported.

afterEach(() => {
  vi.unstubAllEnvs()
})

function seed(db: BazilionDb, teamId: string): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'reviewer']) {
    db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, id, `/tmp/${id}`, teamId],
    )
  }
}

function git(env: TestEnv, ...args: string[]): string {
  return execFileSync('git', ['-C', env.paths.teamDir(env.teamId), ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: env.home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

async function packetEnv(requestedBy: 'agent' | 'operator' = 'agent') {
  const env = makeTestEnv()
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  // The intent is a discriminated union: an agent requester names itself, an operator requester does not.
  const intent =
    requestedBy === 'agent'
      ? {
          teamId: env.teamId,
          snapshotId: captured.reference.id,
          reviewerAgentId: 'reviewer',
          requesterKind: 'agent' as const,
          requesterAgentId: 'coder',
        }
      : {
          teamId: env.teamId,
          snapshotId: captured.reference.id,
          reviewerAgentId: 'reviewer',
          requesterKind: 'operator' as const,
        }
  const result = captureReviewPacket(env.db, env.paths, intent)
  if (result.kind !== 'captured') throw new Error('capture blocked')
  return { env, packet: result.packet }
}

test('a delivered export is a durable, hashed artifact owned by the reviewer', async () => {
  const { env, packet } = await packetEnv()
  try {
    const delivery = await deliverReviewExport(env.db, env.paths, packet.id)
    expect(delivery.kind).toBe('delivered')
    if (delivery.kind !== 'delivered') throw new Error('expected a delivery')

    const receipt = results.getReceipt(env.db, delivery.resultId)
    // Provenance names the packet and the revision, and the bytes are the export with a matching hash.
    expect(receipt).toMatchObject({
      sourceKind: 'review_packet',
      reviewPacketId: packet.id,
      reviewRevision: packet.snapshotId,
      mimeType: 'text/markdown',
      agentId: 'reviewer',
      releasedAt: expect.any(Number),
    })
    expect(receipt?.sessionId).toBeNull()
    expect(receipt?.toolCallId).toBeNull()
    const bytes = results.readReleased(env.db, delivery.resultId).toString('utf8')
    expect(bytes).toContain('## Patch')
    expect(bytes).toContain('three')
    expect(bytes).toContain('## Limitations')

    // The operator surface can read it, and the requester was told where to find it.
    expect(results.getReleased(env.db, delivery.resultId)?.id).toBe(delivery.resultId)
    const messages = env.db.raw
      .query<{ payload: string; from_agent_id: string; to_agent_id: string }, []>(
        'SELECT payload, from_agent_id, to_agent_id FROM messages',
      )
      .all()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ from_agent_id: 'reviewer', to_agent_id: 'coder' })
    expect(messages[0]?.payload).toContain(`result:${delivery.resultId}`)
    expect(messages[0]?.payload).toContain('not an approval')

    // Re-delivering the same revision returns the same receipt rather than duplicating the bytes.
    const again = await deliverReviewExport(env.db, env.paths, packet.id)
    expect(again).toMatchObject({ kind: 'delivered', resultId: delivery.resultId })
  } finally {
    env.cleanup()
  }
})

test('an approval-held delivery leaves the bytes unreadable, and the approval can release them', async () => {
  const { env, packet } = await packetEnv()
  try {
    // An `approval_required` edge from the reviewer to the operator holds the publication. The edge is the
    // shipped shape: agent source, user target, posture.
    vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
    env.db.raw.run(
      `INSERT INTO team_policy_edges (team_id, source_kind, source_id, target_kind, target_id, posture)
       VALUES (?, 'agent', 'reviewer', 'user', '', 'approval_required')`,
      [env.teamId],
    )

    const delivery = await deliverReviewExport(env.db, env.paths, packet.id)
    expect(delivery.kind).toBe('held')
    if (delivery.kind !== 'held') throw new Error('expected a hold')

    // Held means unreadable: not in the library, not downloadable, and no notice was sent.
    expect(results.getReleased(env.db, delivery.resultId)).toBeNull()
    expect(results.listReleased(env.db, { teamId: env.teamId }).total).toBe(0)
    expect(() => results.readReleased(env.db, delivery.resultId)).toThrow()
    expect(env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM messages').get()?.n).toBe(
      0,
    )
    // The approval names exactly this artifact, which is what makes the hold durable and releasable.
    const approvalId = env.db.raw
      .query<{ id: string }, []>('SELECT id FROM communication_approvals')
      .get()?.id
    const approval = env.db.raw
      .query<
        {
          operation: string
          payload_kind: string
          attempt_id: string
          payload_json: string
          status: string
        },
        []
      >(
        'SELECT operation, payload_kind, attempt_id, payload_json, status FROM communication_approvals',
      )
      .get()
    expect(approval).toMatchObject({
      operation: 'agent_to_user',
      payload_kind: 'agent_result',
      attempt_id: delivery.resultId,
      status: 'pending',
    })
    expect(JSON.parse(approval?.payload_json ?? '{}')).toMatchObject({
      resultId: delivery.resultId,
    })

    // And the hold is *releasable*: the approval plans as a result delivery, which is what the dispatcher
    // needs. A held artifact whose plan the dispatcher cannot validate would be stuck forever — the exact
    // failure a wrong origin or attempt kind produces.
    // The payload is needed to validate the plan, which is exactly what the dispatcher reads.
    const detail = communicationApprovalRepo.get(env.db, approvalId ?? '', true)
    if (!detail || !('payload' in detail)) throw new Error('missing approval detail')
    const plan = planApprovalDelivery(detail)
    expect(plan.kind).toBe('agent_result')
    if (plan.kind === 'agent_result') {
      expect(plan.payload).toEqual({ agentId: 'reviewer', resultId: delivery.resultId })
    }
    // The dispatcher's own `agent_result` branch releases exactly this tuple, so the release is the
    // shipped path rather than a new one. Applying it here shows the bytes become readable when it runs.
    results.release(env.db, delivery.resultId, 'reviewer')
    expect(results.getReleased(env.db, delivery.resultId)?.id).toBe(delivery.resultId)
  } finally {
    env.cleanup()
  }
})

test('a denied delivery does not release anything, and an operator-only packet is refused', async () => {
  const denied = await packetEnv()
  try {
    // A denied edge is the absence of an allow: with enforcement on, a missing edge denies.
    vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
    denied.env.db.raw.run(
      `INSERT INTO team_policy_edges (team_id, source_kind, source_id, target_kind, target_id, posture)
       VALUES (?, 'agent', 'reviewer', 'user', '', 'allow')`,
      [denied.env.teamId],
    )
    denied.env.db.raw.run(
      "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND target_kind = 'user'",
      [denied.env.teamId],
    )
    const delivery = await deliverReviewExport(denied.env.db, denied.env.paths, denied.packet.id)
    expect(delivery.kind).toBe('denied')
    // The bytes were published (so the attempt is auditable) but never released.
    expect(results.listReleased(denied.env.db, { teamId: denied.env.teamId }).total).toBe(0)
    expect(
      denied.env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM messages').get()?.n,
    ).toBe(0)
  } finally {
    denied.env.cleanup()
  }

  const operatorOnly = await packetEnv('operator')
  try {
    const delivery = await deliverReviewExport(
      operatorOnly.env.db,
      operatorOnly.env.paths,
      operatorOnly.packet.id,
    )
    // There is nobody to deliver to, and the export route already serves the operator the bytes.
    expect(delivery).toMatchObject({ kind: 'refused' })
    expect(
      results.listReleased(operatorOnly.env.db, { teamId: operatorOnly.env.teamId }).total,
    ).toBe(0)
  } finally {
    operatorOnly.env.cleanup()
  }
})
