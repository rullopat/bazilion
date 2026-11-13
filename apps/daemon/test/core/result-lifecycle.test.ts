import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { deleteAgent } from '../../src/core/agent/delete.ts'
import { moveAgent } from '../../src/core/agent/move.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as results from '../../src/core/repos/results.ts'
import { deleteTeam } from '../../src/core/team/delete.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { makeTestEnv } from './helpers.ts'

test('transfer and Agent deletion retain original Team results; Team deletion leaves linked source intact', () => {
  const env = makeTestEnv()
  const external = mkdtempSync(join(tmpdir(), 'baz034-linked-'))
  try {
    writeFileSync(join(external, 'report.txt'), 'external original')
    registerTeam(env.db, { id: 'linked', link: external }, env.paths)
    createProfile(env.db, env.paths, { id: 'producer', defaultModel: 'lmstudio:test' })
    const agent = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: 'linked' })
    const result = results.publish(env.db, {
      teamId: 'linked',
      agentId: agent.id,
      sessionId: 'original-session',
      toolCallId: 'call',
      name: 'report.txt',
      mimeType: 'text/plain',
      bytes: readFileSync(join(external, 'report.txt')),
    })
    moveAgent(env.db, env.paths, agent.id, env.teamId)
    expect(results.list(env.db, { teamId: env.teamId }).total).toBe(0)
    expect(results.get(env.db, result.id)).toMatchObject({
      teamId: 'linked',
      agentId: agent.id,
    })
    deleteAgent(env.db, agent.id)
    expect(existsSync(env.paths.agentDir(agent.id))).toBe(false)
    expect(results.read(env.db, result.id).toString()).toBe('external original')
    deleteTeam(env.db, env.paths, 'linked')
    expect(results.get(env.db, result.id)).toBeNull()
    expect(existsSync(env.paths.teamDir('linked'))).toBe(false)
    expect(readFileSync(join(external, 'report.txt'), 'utf8')).toBe('external original')
  } finally {
    env.cleanup()
    rmSync(external, { recursive: true, force: true })
  }
})
