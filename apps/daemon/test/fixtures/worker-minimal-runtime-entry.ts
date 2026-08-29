import { fstatSync } from 'node:fs'
import type { ProviderMessage } from '@bazilion/api-types'
import { createIpcApiKeyRefresher } from '../../src/runtime/worker/api-key-refresh.ts'
import { createIpcClient } from '../../src/runtime/worker/ipc-client.ts'

interface FixtureInput {
  kind: 'protected'
  agent: { agent: { id: string } }
  message: string
  turnId: string
  runtime: { providerName: 'openai-codex'; apiKey: string }
  scratch: { root: string }
  apiKeyRefreshEnabled: true
}

const FORBIDDEN_MINIMAL_INPUT_SENTINELS = [
  'telegram-secret-sentinel',
  'bootstrap-secret-sentinel',
  'oauth-refresh-secret-sentinel',
  'unrelated-provider-secret-sentinel',
  'unrelated-tool-secret-sentinel',
]

async function readInput(): Promise<{ input: FixtureInput; raw: string }> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return { input: JSON.parse(raw) as FixtureInput, raw }
}

async function main(): Promise<void> {
  const { input, raw } = await readInput()
  if (!input.apiKeyRefreshEnabled) throw new Error('refresh IPC was not enabled')
  if (input.message === 'native-abi-mismatch') {
    await new Promise<void>((resolve, reject) => {
      process.stderr.write(
        "The module '/private/checkout/node_modules/better_sqlite3.node'\n" +
          'was compiled against a different Node.js version using NODE_MODULE_VERSION 141. ' +
          'This version of Node.js requires NODE_MODULE_VERSION 147. Please try re-compiling.\n',
        (error) => (error ? reject(error) : resolve()),
      )
    })
    process.exitCode = 1
    return
  }
  if (input.message === 'native-abi-frame') {
    process.stdout.write(
      `${JSON.stringify({
        kind: 'fatal',
        error:
          "The module '/private/checkout/node_modules/better_sqlite3.node' was compiled " +
          'against a different Node.js version using NODE_MODULE_VERSION 141. ' +
          'This version of Node.js requires NODE_MODULE_VERSION 147.',
      })}\n`,
    )
    process.exitCode = 1
    return
  }
  const call = createIpcClient({
    send: process.send
      ? (message, done) => process.send?.(message, undefined, undefined, done)
      : undefined,
    onMessage: (listener) => process.on('message', listener),
    onDisconnect: (listener) => process.on('disconnect', listener),
  })
  const refresh = createIpcApiKeyRefresher(call, {
    providerName: input.runtime.providerName,
    agentId: input.agent.agent.id,
    turnId: input.turnId,
  })
  const rotated = await refresh('openai-codex')
  if (input.message === 'oversized-frame') {
    process.stdout.write('x'.repeat(4_096))
    return
  }

  process.stderr.write('x'.repeat(20_000))
  const initialSplit = Math.max(1, Math.floor(input.runtime.apiKey.length / 2))
  process.stderr.write(`initial=${input.runtime.apiKey.slice(0, initialSplit)}`)
  process.stderr.write(`${input.runtime.apiKey.slice(initialSplit)}\nrotated=${rotated}\n`)

  const messages: ProviderMessage[] = [
    {
      role: 'assistant',
      content: JSON.stringify({
        environment: process.env,
        argv: process.argv,
        scratchRoot: input.scratch.root,
        stdinEnded: process.stdin.readableEnded,
        stdioAreRegularFiles: [0, 1, 2].map((fd) => fstatSync(fd).isFile()),
        ipcConnected: process.connected,
        selectedTokenInputOccurrences: raw.split(input.runtime.apiKey).length - 1,
        forbiddenInputOccurrences: Object.fromEntries(
          FORBIDDEN_MINIMAL_INPUT_SENTINELS.map((sentinel) => [
            sentinel,
            raw.split(sentinel).length - 1,
          ]),
        ),
        initial: input.runtime.apiKey,
        rotated,
      }),
    },
  ]
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages })}\n`)
  if (input.message === 'hang-after-frame') {
    await new Promise<void>(() => setInterval(() => undefined, 1_000))
  }
}

main()
  .catch((error) => {
    process.stdout.write(
      `${JSON.stringify({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })}\n`,
    )
    process.exitCode = 1
  })
  .finally(() => {
    try {
      process.disconnect?.()
    } catch {}
  })
