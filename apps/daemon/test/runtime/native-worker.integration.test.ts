import { test } from 'vitest'
import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'
import { runNativeWorkerFixture } from '../fixtures/native-worker.ts'

test.skipIf(!enabled).each(['configured', 'protected'] as const)(
  'real %s worker uses only its live native turn, correlates output and retires both resources',
  async (kind) => {
    await runNativeWorkerFixture(kind)
  },
  30_000,
)

test.skipIf(!enabled).each([
  { tool: 'bash', decision: 'allow' },
  { tool: 'bash', decision: 'deny' },
  { tool: 'bash', decision: 'cancel' },
  { tool: 'coding_command', decision: 'allow' },
  { tool: 'coding_command', decision: 'deny' },
  { tool: 'coding_command', decision: 'cancel' },
] as const)(
  'real native $tool approval $decision is turn-bound, one-use and precedes workspace effects',
  async (interactive) => {
    await runNativeWorkerFixture('configured', { interactive })
  },
  30_000,
)
