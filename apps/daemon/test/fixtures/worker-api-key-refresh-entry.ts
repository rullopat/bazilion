import type { ResolvedAgent } from '@bazilion/api-types'
import { createProcessIpcClient } from '../../src/runtime/worker/ipc-client.ts'

const EXPECTED_REFRESHED_TOKEN = 'end-to-end-refreshed-token-must-not-enter-frames'

interface FixtureInput {
  agent: ResolvedAgent
  hosts: string[]
}

async function readInput(): Promise<FixtureInput> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as FixtureInput
}

async function main(): Promise<void> {
  try {
    const input = await readInput()
    if (!input.hosts.includes('apiKeyRefreshHost')) throw new Error('refresh IPC was not enabled')

    const call = createProcessIpcClient()
    const token = await call('refreshApiKey', {
      providerName: input.agent.model.split(':', 1)[0] ?? '',
    })
    if (token !== EXPECTED_REFRESHED_TOKEN) throw new Error('unexpected refresh result')

    process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
  } finally {
    try {
      process.disconnect?.()
    } catch {}
  }
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })}\n`,
  )
  process.exitCode = 1
})
