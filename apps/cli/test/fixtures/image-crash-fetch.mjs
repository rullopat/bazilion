// Test-only barriers around a real daemon's image dispatch and committed IPC acknowledgement.
import childProcess from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const originalFetch = globalThis.fetch
const originalSpawn = childProcess.spawn
childProcess.spawn = function (...spawnArgs) {
  const child = originalSpawn.apply(this, spawnArgs)
  const originalSend = child.send
  if (originalSend)
    child.send = function (message, ...args) {
      if (
        process.env.BAZILION_IMAGE_CRASH_WINDOW === 'after_capture' &&
        message?.type === 'rpc-reply' &&
        message.ok &&
        message.result?.model === 'openai:gpt-image-2' &&
        message.result.files?.[0]?.result?.resultId
      ) {
        writeFileSync(
          process.env.BAZILION_IMAGE_CRASH_MARKER,
          JSON.stringify({ resultId: message.result.files[0].result.resultId }),
          { mode: 0o600 },
        )
        return true // Deliberately withhold the worker acknowledgement until the test kills the daemon.
      }
      return originalSend.call(this, message, ...args)
    }
  return child
}
syncBuiltinESMExports()
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!['api.openai.com', 'chatgpt.com', 'openrouter.ai', 'auth.openai.com'].includes(url.hostname))
    return originalFetch(input, init)
  if (
    url.href !== 'https://api.openai.com/v1/images/generations' ||
    new Headers(init?.headers).get('authorization') !== 'Bearer crash-fixture-key'
  )
    throw new Error('Unmocked provider request refused')
  const target = new URL(process.env.BAZILION_IMAGE_CRASH_UPSTREAM)
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:')
    throw new Error('Fixture must be loopback')
  return originalFetch(target, init)
}
