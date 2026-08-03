import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { acquireHomeRestoreLock } from '../../src/daemon-liveness.ts'

const [home, barrier] = process.argv.slice(2)
if (!home || !barrier) throw new Error('usage: restore-lock-contender <home> <barrier>')

while (!existsSync(barrier)) await delay(5)

try {
  const lock = await acquireHomeRestoreLock(home)
  console.log('acquired')
  await delay(500)
  lock.release()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 2
}
