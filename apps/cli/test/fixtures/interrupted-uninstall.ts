import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { acquireHomeRestoreLock } from '../../src/daemon-liveness.ts'

const home = process.argv[2]
if (!home) throw new Error('usage: interrupted-uninstall.ts <home>')
const interruption = process.argv[3] ?? 'partial-identity'

// Model an abrupt process exit after the reset has deleted the database but
// before it deletes the matching bootstrap credential or releases ownership.
// Intentionally do not call release(): the durable `uninstalling` record must
// survive for the daemon and restore paths to recognize the interrupted pair.
await acquireHomeRestoreLock(home, 'uninstalling')
if (interruption === 'full-home') {
  rmSync(home, { recursive: true, force: true })
} else if (interruption === 'symlink-full-home') {
  for (const entry of readdirSync(home)) {
    rmSync(join(home, entry), { recursive: true, force: true })
  }
} else {
  rmSync(join(home, 'bazilion.db'), { force: true })
}
process.exit(23)
