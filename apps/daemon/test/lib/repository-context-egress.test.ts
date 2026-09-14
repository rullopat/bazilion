import type { ChatFrame } from '@bazilion/api-types'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import {
  authorizeHttpChatFrame,
  CommunicationDeniedError,
  CommunicationPendingError,
} from '../../src/lib/communication.ts'
import { piMessagesToProviderView } from '../../src/runtime/pi/events.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
const frame: ChatFrame = {
  kind: 'event',
  event: {
    type: 'tool_result',
    name: 'repository_context',
    id: 'context-call',
    result: 'PRIVATE_REPOSITORY_SENTINEL',
  },
}
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  createProfile(env.db, env.paths, {
    id: 'context',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'context', teamId: env.teamId }).id
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})

test('text repository results use the existing HTTP egress approval tuple', () => {
  expect(() => authorizeHttpChatFrame(env.db, agentId, 'request', 0, frame)).not.toThrow()
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
    [env.teamId, agentId],
  )
  expect(() => authorizeHttpChatFrame(env.db, agentId, 'request', 1, frame)).toThrow(
    CommunicationPendingError,
  )
  const held = env.db.raw
    .query<{ payload_kind: string; payload_json: string }, []>(
      'SELECT payload_kind, payload_json FROM communication_approvals',
    )
    .get()
  expect(held?.payload_kind).toBe('http_chat_frame')
  expect(held?.payload_json).toContain('PRIVATE_REPOSITORY_SENTINEL')
  env.db.raw.run(
    "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
    [env.teamId, agentId],
  )
  expect(() => authorizeHttpChatFrame(env.db, agentId, 'request', 2, frame)).toThrow(
    CommunicationDeniedError,
  )
})

test.each([
  'repository_context',
  'coding_environment',
  'coding_command',
  'coding_receipt',
])('public history and done projections never independently release %s results', (toolName) => {
  const messages = [
    {
      role: 'toolResult',
      toolName,
      toolCallId: 'context-call',
      isError: false,
      content: [{ type: 'text', text: 'PRIVATE_REPOSITORY_SENTINEL' }],
      details: { repositoryContext: { secret: 'PRIVATE_REPOSITORY_SENTINEL' } },
      timestamp: 1,
    },
  ] as AgentMessage[]
  const projected = piMessagesToProviderView(messages)
  expect(JSON.stringify(projected)).not.toContain('PRIVATE_REPOSITORY_SENTINEL')
  expect(projected[0]?.toolName).toBe(toolName)
  expect(projected[0]?.content).toContain('retained privately')
  expect(JSON.stringify(messages)).toContain('PRIVATE_REPOSITORY_SENTINEL')
})
