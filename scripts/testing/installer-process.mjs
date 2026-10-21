import { awaitDaemon, CleanupUnconfirmedError, ownedChild } from '../migration-upgrade-matrix.mjs'

function bounded(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// Fixture ownership only: leader/pipe close is not arbitrary-descendant cleanup proof.
// Real artifact trials still need caller-owned disposable outer containment.
export class InstallerProcesses {
  #owners = new Map()

  spawn(command, args, options = {}) {
    const owned = ownedChild(command, args, options)
    this.#owners.set(owned.child, { owned, command, args })
    return owned.child
  }

  #owner(child) {
    const item = this.#owners.get(child)
    if (!item) throw new CleanupUnconfirmedError('installer child ownership is unknown')
    return item.owned
  }

  async run(command, args, options = {}, timeoutMs = 120_000) {
    const child = this.spawn(command, args, options)
    const owned = this.#owner(child)
    const outcome = await bounded(owned.closed, timeoutMs)
    if (!outcome) {
      await owned.stop()
      throw new Error(`installer command deadline exceeded: ${command}`)
    }
    if (outcome.overflow) throw new Error(`installer command output bound exceeded: ${command}`)
    return { ...outcome, code: outcome.code ?? -1 }
  }

  async stop(child, { graceful = false } = {}) {
    if (!child) return
    const result = await this.#owner(child).stop()
    if (result.overflow) throw new Error('installer process output bound exceeded')
    if (graceful && (result.code !== 0 || result.signal || result.forced || result.spawnError))
      throw new Error('installer service did not close gracefully; retain fixture')
    return result
  }

  async healthy(child, url, timeoutMs = 60_000) {
    const owned = this.#owner(child)
    await awaitDaemon(owned, url, timeoutMs)
    const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' })
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new Error('installer health was not HTTP200')
    }
    const result = JSON.parse(await readBoundedText(response, 4096))
    if (result.ok !== true || owned.outcome())
      throw new Error('installer health did not remain HTTP200/ok:true on the owned service')
    return result
  }

  async closeAll() {
    const results = await Promise.allSettled(
      [...this.#owners.values()].map(({ owned }) => owned.stop()),
    )
    if (results.some((item) => item.status === 'rejected'))
      throw new CleanupUnconfirmedError('installer child/pipe closure unconfirmed; retain fixture')
    if (results.some((item) => item.value.overflow || item.value.forced || item.value.spawnError))
      throw new Error('installer abnormal process outcome; retain fixture for inspection')
  }

  facts() {
    return [...this.#owners.values()].map(({ command, args, owned }) => ({
      command,
      args,
      outcome: owned.outcome() ?? { cleanup: 'unconfirmed' },
    }))
  }
}

// Every earlier functional oracle and owned-close outcome must be accepted BEFORE
// uninstall can destroy the primary fixture evidence. Expected negative CLI exits
// remain governed by their individual functional oracles, not by exit-code guesses.
export async function runGuardedUninstall(processes, failures, uninstall) {
  if (failures.length) throw new Error('installer assertions failed; retain home before uninstall')
  await processes.closeAll()
  if (failures.length) throw new Error('installer assertions failed; retain home before uninstall')
  return uninstall()
}

export async function readBoundedText(response, limit) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > limit) throw new Error('installer HTTP body exceeded byte bound')
      chunks.push(Buffer.from(part.value))
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// Persist fail-closed evidence before removal, then the actual removal outcome.
// The caller keeps its exclusively-created evidence descriptor pinned across saves,
// including when the default evidence pathname is unlinked with the successful root.
export async function finalizeInstallerFixture(report, { writeEvidence, removeFixture }) {
  const eligible = report.passed
  report.passed = false
  report.fixtureRemoval = { status: eligible ? 'pending' : 'retained' }
  try {
    await writeEvidence(report)
  } catch (error) {
    report.fixtureRemoval = { status: 'retained' }
    report.cleanupErrors.push(`installer evidence write failed: ${error}`)
    return report
  }
  if (!eligible) return report
  try {
    await removeFixture()
    report.fixtureRemoval = { status: 'removed' }
    report.passed = true
  } catch (error) {
    report.fixtureRemoval = { status: 'failed', error: String(error) }
    report.cleanupErrors.push(`installer fixture removal failed: ${error}`)
  }
  try {
    await writeEvidence(report)
  } catch (error) {
    report.passed = false
    report.cleanupErrors.push(`installer final evidence write failed: ${error}`)
  }
  return report
}

// Admission is explicit; false/unknown dependencies and agent skills stay untouched.
export const INSTALLER_BUILD_ALLOWLIST = [
  '@playwright/browser-chromium',
  'better-sqlite3',
  'esbuild',
  'playwright',
  'sharp',
  'tree-sitter-go',
  'tree-sitter-javascript',
  'tree-sitter-python',
  'tree-sitter-rust',
  'tree-sitter-typescript',
]
