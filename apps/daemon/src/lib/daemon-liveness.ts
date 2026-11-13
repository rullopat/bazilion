import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** `<home>/daemon.pid` holds the PID of the daemon that owns the home. */
export const DAEMON_PID_FILE = 'daemon.pid'

/**
 * PID of the daemon running on `home`, or null. A pidfile naming a dead process, or this process
 * (its PID reused, e.g. after a reboot), is stale.
 */
export function runningDaemonPid(home: string): number | null {
  let pid: number
  try {
    pid = Number.parseInt(readFileSync(join(home, DAEMON_PID_FILE), 'utf8'), 10)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return null
  try {
    process.kill(pid, 0)
    return pid
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM' ? pid : null
  }
}

/** Offline commands (backup restore, uninstall) and a second daemon refuse a home in use. */
export function assertDaemonStopped(home: string): void {
  const pid = runningDaemonPid(home)
  if (pid !== null) {
    throw new Error(
      `a bazilion daemon (pid ${pid}) is running on ${home}; stop it first ` +
        `(if none is running, delete ${join(home, DAEMON_PID_FILE)})`,
    )
  }
}

/** Claim `home` before bootstrap opens SQLite. Returns the function that releases it. */
export function claimDaemonPidFile(home: string): () => void {
  const path = join(home, DAEMON_PID_FILE)
  const content = `${process.pid}\n`
  mkdirSync(home, { recursive: true })
  try {
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    assertDaemonStopped(home)
    rmSync(path, { force: true })
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
  }
  return () => {
    // Only this daemon's own pidfile: another daemon may have written its own since.
    try {
      if (readFileSync(path, 'utf8') === content) rmSync(path)
    } catch {
      // Already gone.
    }
  }
}
