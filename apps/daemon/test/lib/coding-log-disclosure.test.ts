import type { ChatFrame } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import {
  getCodingCommandLog,
  saveCodingCommandLog,
} from '../../src/core/repos/coding-command-logs.ts'
import { saveCodingCommand } from '../../src/core/repos/coding-commands.ts'
import { authorizeHttpChatFrame, CommunicationPendingError } from '../../src/lib/communication.ts'
import { approvalsRouter } from '../../src/routes/approvals.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-041 disclosure boundary: an approval is source-owned egress. Approving a held
// terminal coding result must release the captured bytes; denying it must not.

let env: TestEnv
let agentId: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))

const COMMAND_ID = '11111111-2222-4333-8444-555555555555'

beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  createProfile(env.db, env.paths, {
    id: 'producer',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId }).id
  const now = Date.now()
  saveCodingCommand(env.db, {
    id: COMMAND_ID,
    agentId,
    teamId: env.teamId,
    turnId: 'turn-1',
    toolCallId: 'call-1',
    input: { command: 'run', cwd: '.', purpose: 'test', timeoutSeconds: 30 },
    environment: {
      posture: 'docker',
      imageId: 'debian:bookworm-slim',
      cwd: '/workspace',
      rootIdentity: 'root-1',
      inputFingerprint: null,
      capturedAt: now,
      restrictions: [],
    },
    startedAt: now,
    finishedAt: now,
    state: 'failed',
    exitCode: 1,
    diagnostic: 'boom',
    truncated: false,
    reason: null,
  })
  saveCodingCommandLog(env.db, {
    commandId: COMMAND_ID,
    teamId: env.teamId,
    agentId,
    turnId: 'turn-1',
    toolCallId: 'call-1',
    diagnostic: 'boom',
    observedBytes: 4,
    redacted: false,
    truncated: false,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})

function terminalFrame(): ChatFrame {
  return {
    kind: 'event',
    event: {
      type: 'tool_result',
      id: 'call-1',
      name: 'coding_command',
      result: JSON.stringify({ id: COMMAND_ID, teamId: env.teamId }),
    },
  }
}

/** Put the agent→user edge into the approval posture and capture the held approval id. */
function hold(): string {
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'agent' AND target_kind = 'user'",
    [env.teamId],
  )
  try {
    authorizeHttpChatFrame(env.db, agentId, 'request', 0, terminalFrame())
  } catch (error) {
    if (error instanceof CommunicationPendingError) return error.approval.id
    throw error
  }
  throw new Error('Expected the terminal coding frame to be held')
}

test('an approved terminal coding result releases the captured bytes', async () => {
  expect(getCodingCommandLog(env.db, COMMAND_ID).releasedAt).toBeNull()
  const approvalId = hold()
  // Held: the operator has neither the outcome nor the bytes.
  expect(getCodingCommandLog(env.db, COMMAND_ID).releasedAt).toBeNull()

  const approved = await approvalsRouter.request(`/${approvalId}/approve`, { method: 'POST' })
  expect(approved.status).toBe(200)
  expect(getCodingCommandLog(env.db, COMMAND_ID).releasedAt).not.toBeNull()
})

test('a denied terminal coding result releases nothing', async () => {
  const approvalId = hold()
  const denied = await approvalsRouter.request(`/${approvalId}/deny`, { method: 'POST' })
  expect(denied.status).toBe(200)
  expect(getCodingCommandLog(env.db, COMMAND_ID).releasedAt).toBeNull()
})

test('a direct authorized terminal coding result releases the captured bytes', () => {
  authorizeHttpChatFrame(env.db, agentId, 'request', 0, terminalFrame())
  expect(getCodingCommandLog(env.db, COMMAND_ID).releasedAt).not.toBeNull()
})
