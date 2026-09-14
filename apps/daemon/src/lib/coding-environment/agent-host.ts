import { createHash, randomUUID } from 'node:crypto'
import type {
  CodingCommandOutcome,
  CodingCommandReceipt,
  CodingEnvironmentSnapshot,
} from '@bazilion/api-types'
import { codingRelativePath, validateCodingCommand } from '../../core/coding-environment/config.ts'
import { agentRepo, type BazilionDb } from '../../core/index.ts'
import {
  pruneCodingCommandLogs,
  readCodingCommandLog,
  releaseCodingCommandLog,
  saveCodingCommandLog,
  searchCodingCommandLog,
} from '../../core/repos/coding-command-logs.ts'
import {
  getCodingCommand,
  pruneCodingCommands,
  saveCodingCommand,
} from '../../core/repos/coding-commands.ts'
import { resolveCodingDirectory } from '../../runtime/coding-directory.ts'
import type { CodingHost, CodingRequest } from '../../runtime/pi/coding-contract.ts'
import type { RepositoryContextHost } from '../../runtime/pi/repository-context.ts'
import { deliverableInbox } from '../communication.ts'
import { ContextDirectory } from '../repository-context/files.ts'
import { requireCompleteRepositoryContext } from '../repository-context/index.ts'
import {
  CODING_OUTPUT_BYTES,
  CODING_RETAINED_BYTES,
  CodingDiagnostics,
  diagnosticTail,
} from './diagnostics.ts'

export function createCodingHost(input: {
  db: BazilionDb
  agentId: string
  teamId: string
  turnId: string
  root: string
  posture: CodingEnvironmentSnapshot['posture']
  imageId: string | null
  values: unknown
  context: RepositoryContextHost
  assertActive: () => void
  secrets: readonly string[]
}): CodingHost {
  const active = new Set<string>()
  const calls = new Set<string>()
  let starting = false
  /**
   * Shared receipt/log authorization. A producing Agent may read its own evidence; any
   * other Team member must present the exact policy-authorized message that carried
   * `coding-receipt:<id>`. Authorization to read a peer's evidence is itself the egress
   * decision, so a successful peer read releases the captured bytes for disclosure.
   */
  function authorizeEvidence(
    id: string,
    messageId: string | undefined,
  ): { receipt: CodingCommandReceipt; producer: boolean } {
    const receipt = getCodingCommand(input.db, id)
    if (
      agentRepo.get(input.db, input.agentId)?.teamId !== input.teamId ||
      !receipt ||
      receipt.teamId !== input.teamId ||
      agentRepo.get(input.db, receipt.agentId)?.teamId !== input.teamId
    )
      throw new Error('Coding receipt unavailable')
    if (receipt.agentId === input.agentId) return { receipt, producer: true }
    const message = deliverableInbox(input.db, input.agentId, false).find(
      (candidate) => candidate.id === messageId,
    )
    if (
      !message ||
      message.fromAgentId !== receipt.agentId ||
      !message.payload.includes(`coding-receipt:${receipt.id}`) ||
      receipt.state === 'running'
    )
      throw new Error('Coding receipt requires an authorized producer message')
    return { receipt, producer: false }
  }
  async function snapshot(target: string): Promise<CodingEnvironmentSnapshot> {
    input.assertActive()
    codingRelativePath(target)
    resolveCodingDirectory(input.root, target)
    const report = await input.context(target)
    requireCompleteRepositoryContext(report)
    let fingerprint: string | null = null
    const dir = new ContextDirectory(input.root)
    try {
      const sources: unknown[] = [
        report.instructions.files.map((file) => [file.path, file.sha256]),
        report.commands.sources,
        input.values,
      ]
      let current = dir
      let bytes = 0
      for (const part of ['', ...(target === '.' ? [] : target.split('/'))]) {
        if (part) current = current.directory(part)
        for (const name of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']) {
          const value = current.read(name, 4 * 1024 * 1024 - bytes)
          bytes += value?.length ?? 0
          sources.push([
            current.label,
            name,
            value ? createHash('sha256').update(value).digest('hex') : null,
          ])
        }
      }
      dir.validate()
      fingerprint = createHash('sha256').update(JSON.stringify(sources)).digest('hex')
    } catch {
      /* Incomplete input evidence does not prohibit otherwise permitted execution. */
    } finally {
      dir.close()
    }
    input.assertActive()
    return {
      posture: input.posture,
      imageId: input.imageId,
      cwd: target,
      rootIdentity: report.rootIdentity ?? 'unavailable',
      inputFingerprint: fingerprint,
      capturedAt: Date.now(),
      restrictions:
        input.posture === 'host'
          ? [
              'Host execution under existing shell policy; not isolated.',
              'Resolve new scopes before editing.',
            ]
          : [
              'No network. Missing downloads require operator provision; do not switch to host.',
              'Fresh container per command; only workspace dependencies persist. Read-only root and Team memory; bounded temporary storage.',
              'No ambient credentials or host package caches.',
            ],
    }
  }
  return {
    async invoke(raw: CodingRequest) {
      input.assertActive()
      if (!raw || typeof raw !== 'object') throw new Error('Invalid coding request')
      if (raw.action === 'environment') return snapshot(raw.target)
      if (raw.action === 'start') {
        if (starting || active.size || calls.size >= 64)
          throw new Error('Coding operation already active or turn operation limit reached')
        if (
          typeof raw.toolCallId !== 'string' ||
          !raw.toolCallId ||
          raw.toolCallId.length > 256 ||
          calls.has(raw.toolCallId)
        )
          throw new Error('Invalid or repeated coding tool call')
        const command = validateCodingCommand(raw.input)
        if (input.secrets.some((secret) => secret && command.command.includes(secret)))
          throw new Error('Command contains protected credential material')
        starting = true
        try {
          const environment = await snapshot(command.cwd)
          const receipt: CodingCommandReceipt = {
            id: randomUUID(),
            agentId: input.agentId,
            teamId: input.teamId,
            turnId: input.turnId,
            toolCallId: raw.toolCallId,
            input: command,
            environment,
            startedAt: Date.now(),
            finishedAt: null,
            state: 'running',
            exitCode: null,
            diagnostic: '',
            truncated: false,
            reason: null,
          }
          saveCodingCommand(input.db, receipt)
          active.add(receipt.id)
          calls.add(raw.toolCallId)
          return receipt
        } finally {
          starting = false
        }
      }
      if (raw.action === 'finish') {
        const receipt = getCodingCommand(input.db, raw.id)
        if (
          !receipt ||
          !active.has(raw.id) ||
          receipt.turnId !== input.turnId ||
          receipt.agentId !== input.agentId
        )
          throw new Error('Coding operation does not belong to this active turn')
        const value: CodingCommandOutcome = raw.outcome
        if (
          !value ||
          !['succeeded', 'failed', 'blocked', 'timed_out', 'cancelled', 'interrupted'].includes(
            value.state,
          ) ||
          typeof value.diagnostic !== 'string' ||
          Buffer.byteLength(value.diagnostic) > 256 * 1024 ||
          (value.exitCode !== null && !Number.isSafeInteger(value.exitCode)) ||
          (value.reason !== null &&
            (typeof value.reason !== 'string' || value.reason.length > 4096)) ||
          typeof value.truncated !== 'boolean' ||
          (value.state === 'succeeded' && value.exitCode !== 0) ||
          (value.state === 'failed' && (value.exitCode === null || value.exitCode === 0))
        )
          throw new Error('Invalid coding terminal evidence')
        // Retain up to the BAZ-041 window, but keep the receipt's established 64 KiB tail.
        const diagnostic = new CodingDiagnostics(input.secrets, CODING_RETAINED_BYTES)
        diagnostic.append(Buffer.from(value.diagnostic))
        const retained = diagnostic.finish()
        const tail = diagnosticTail(retained.diagnostic, CODING_OUTPUT_BYTES)
        const reason = new CodingDiagnostics(input.secrets)
        reason.append(Buffer.from(value.reason ?? ''))
        Object.assign(receipt, {
          state: value.state,
          exitCode: value.exitCode,
          diagnostic: tail.text,
          truncated: tail.truncated || value.truncated,
          reason: reason.finish().diagnostic || null,
          finishedAt: Date.now(),
        })
        saveCodingCommand(input.db, receipt)
        // Retention is best-effort evidence maintenance. A persistence failure must not
        // turn a completed command into a failed one; the log simply reads unavailable.
        try {
          saveCodingCommandLog(input.db, {
            commandId: receipt.id,
            teamId: input.teamId,
            agentId: input.agentId,
            turnId: input.turnId,
            toolCallId: receipt.toolCallId,
            diagnostic: retained.diagnostic,
            observedBytes: retained.observedBytes,
            redacted: retained.redacted,
            truncated: retained.truncated || value.truncated,
          })
        } catch {
          /* Missing evidence must not appear complete; the log reads unavailable. */
        }
        active.delete(raw.id)
        return receipt
      }
      if (raw.action === 'read') {
        pruneCodingCommands(input.db, input.teamId)
        pruneCodingCommandLogs(input.db)
        const { receipt } = authorizeEvidence(raw.id, raw.messageId)
        let current: CodingEnvironmentSnapshot
        try {
          current = await snapshot(receipt.input.cwd)
        } catch {
          input.assertActive()
          return { receipt, applicability: 'unknown' }
        }
        const applicability =
          !current.inputFingerprint || !receipt.environment.inputFingerprint
            ? 'unknown'
            : receipt.state === 'interrupted' ||
                Date.now() - receipt.startedAt > 15 * 60000 ||
                Date.now() < receipt.startedAt ||
                current.rootIdentity !== receipt.environment.rootIdentity ||
                current.posture !== receipt.environment.posture ||
                current.imageId !== receipt.environment.imageId ||
                current.inputFingerprint !== receipt.environment.inputFingerprint
              ? 'stale'
              : 'fresh'
        return { receipt, applicability }
      }
      if (raw.action === 'log') {
        pruneCodingCommandLogs(input.db)
        const { producer } = authorizeEvidence(raw.id, raw.messageId)
        if (!producer) releaseCodingCommandLog(input.db, raw.id)
        const page = readCodingCommandLog(input.db, raw.id, {
          audience: producer ? 'producer' : 'disclosure',
          ...(raw.offset !== undefined ? { offset: raw.offset } : {}),
          ...(raw.limit !== undefined ? { limit: raw.limit } : {}),
        })
        if (!page) throw new Error('Coding log unavailable')
        return page
      }
      if (raw.action === 'log-search') {
        pruneCodingCommandLogs(input.db)
        const { producer } = authorizeEvidence(raw.id, raw.messageId)
        if (!producer) releaseCodingCommandLog(input.db, raw.id)
        const result = searchCodingCommandLog(input.db, raw.id, raw.query, {
          audience: producer ? 'producer' : 'disclosure',
        })
        if (!result) throw new Error('Coding log unavailable')
        return result
      }
      throw new Error('Unknown coding operation')
    },
  }
}
