import { expect, test } from 'vitest'
import {
  claimVerificationAttempt,
  createVerificationRequest,
} from '../../src/core/repos/verification-requests.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import {
  assertVerificationWorkerOwnership,
  consumeVerificationWorkerOwnership,
  createVerificationWorkerOwnership,
} from '../../src/lib/verification/worker-ownership.ts'
import { makeTestEnv } from '../core/helpers.ts'

async function setup() {
  const env = makeTestEnv()
  env.db.raw.run(
    "INSERT INTO profiles(id,name,dir,default_model,created_at,updated_at)VALUES('ownership','Ownership','p','lmstudio:fixture',1,1)",
  )
  env.db.raw.run(
    "INSERT INTO agents(id,profile_id,name,status,dir,team_id,created_at)VALUES('owned-specialist','ownership','Specialist','idle','private',?,1)",
    [env.teamId],
  )
  // Synthetic stored metadata only. These scope tests launch no sandbox or worker and issue no receipt.
  const request = createVerificationRequest(env.db, {
    teamId: env.teamId,
    requesterKind: 'operator',
    requesterAgentId: null,
    recipientAgentId: 'owned-specialist',
    snapshotId: 'scope-only',
    snapshotComplete: true,
    head: null,
    baseOid: 'base',
    environment: {
      sandbox: 'native',
      image: null,
      cwd: '.',
      env: {},
      inputScope: 'team-memory',
      native: {
        backend: 'linux-bwrap',
        architecture: 'x64',
        nodeVersion: 'v26.12.1',
        kernelRelease: 'scope-only',
        fingerprint: 'a'.repeat(64),
        policyFingerprint: 'b'.repeat(64),
      },
    },
    checks: [{ command: 'printf scope', cwd: '.', purpose: 'scope', timeoutMs: 5000 }],
  })
  const claim = claimVerificationAttempt(env.db, {
    requestId: request.id,
    leaseOwner: 'ownership-unit',
    leaseMs: 60_000,
  })
  if (!claim) throw new Error('missing fixture claim')
  const controller = new AbortController()
  registerAgent('owned-specialist', controller)
  const lifecycle = workspaceLifecycle(env.db),
    lease = await lifecycle.claim(env.teamId, env.paths.teamDir(env.teamId), 'agent')
  const input = {
    db: env.db,
    paths: env.paths,
    requestId: request.id,
    attemptId: claim.attempt.id,
    leaseOwner: 'ownership-unit',
    lease,
    controller,
  }
  const binding = {
    kind: 'specialist_verification' as const,
    agentId: 'owned-specialist',
    turnId: claim.attempt.id,
    verification: { requestId: request.id, attemptId: claim.attempt.id },
  }
  return {
    env,
    lifecycle,
    lease,
    input,
    binding,
    async close() {
      unregisterAgent('owned-specialist')
      await lifecycle.release(lease)
      env.cleanup()
    },
  }
}

test('verification ownership is nominal, exact-bound, one-use and cannot grant host-command or PID authority', async () => {
  const fixture = await setup()
  try {
    const owner = createVerificationWorkerOwnership(fixture.input)
    expect(() => assertVerificationWorkerOwnership({ ...owner }, fixture.binding)).toThrow(
      'ownership',
    )
    for (const binding of [
      { ...fixture.binding, agentId: 'other' },
      { ...fixture.binding, turnId: 'other' },
      { ...fixture.binding, verification: { ...fixture.binding.verification, requestId: 'other' } },
      { ...fixture.binding, verification: { ...fixture.binding.verification, attemptId: 'other' } },
    ])
      expect(() => assertVerificationWorkerOwnership(owner, binding)).toThrow('ownership')
    const lifecycle = consumeVerificationWorkerOwnership(owner, fixture.binding)
    expect(() => consumeVerificationWorkerOwnership(owner, fixture.binding)).toThrow('ownership')
    expect(() => lifecycle.beforeInput(12345, true)).toThrow('ownership')
    expect(() => lifecycle.beforeSignal?.()).toThrow('not registered')
    expect(fixture.env.db.raw.query('SELECT id FROM workspace_resources').all()).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('copied leases, wrong registration and expired attempts cannot mint restricted worker ownership', async () => {
  const fixture = await setup()
  try {
    expect(() =>
      createVerificationWorkerOwnership({
        ...fixture.input,
        lease: { ...fixture.lease } as unknown as typeof fixture.lease,
      }),
    ).toThrow()
    expect(() =>
      createVerificationWorkerOwnership({ ...fixture.input, controller: new AbortController() }),
    ).toThrow('ownership')
    fixture.env.db.raw.run('UPDATE verification_attempts SET lease_expires_at=? WHERE id=?', [
      Date.now() - 1,
      fixture.input.attemptId,
    ])
    expect(() => createVerificationWorkerOwnership(fixture.input)).toThrow('ownership')
    expect(fixture.env.db.raw.query('SELECT id FROM workspace_resources').all()).toEqual([])
  } finally {
    await fixture.close()
  }
})
