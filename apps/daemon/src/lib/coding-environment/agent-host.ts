import { createHash, randomUUID } from 'node:crypto'
import type {
  CodingCommandOutcome,
  CodingCommandReceipt,
  CodingEnvironmentSnapshot,
} from '@bazilion/api-types'
import { codingRelativePath, validateCodingCommand } from '../../core/coding-environment/config.ts'
import { agentRepo, type BazilionDb } from '../../core/index.ts'
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
import { CodingDiagnostics } from './diagnostics.ts'

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
        const diagnostic = new CodingDiagnostics(input.secrets)
        diagnostic.append(Buffer.from(value.diagnostic))
        const safe = diagnostic.finish()
        const reason = new CodingDiagnostics(input.secrets)
        reason.append(Buffer.from(value.reason ?? ''))
        Object.assign(receipt, {
          state: value.state,
          exitCode: value.exitCode,
          diagnostic: safe.diagnostic,
          truncated: safe.truncated || value.truncated,
          reason: reason.finish().diagnostic || null,
          finishedAt: Date.now(),
        })
        saveCodingCommand(input.db, receipt)
        active.delete(raw.id)
        return receipt
      }
      if (raw.action === 'read') {
        pruneCodingCommands(input.db, input.teamId)
        const receipt = getCodingCommand(input.db, raw.id)
        if (
          agentRepo.get(input.db, input.agentId)?.teamId !== input.teamId ||
          !receipt ||
          receipt.teamId !== input.teamId ||
          agentRepo.get(input.db, receipt.agentId)?.teamId !== input.teamId
        )
          throw new Error('Coding receipt unavailable')
        if (receipt.agentId !== input.agentId) {
          const message = deliverableInbox(input.db, input.agentId, false).find(
            (message) => message.id === raw.messageId,
          )
          if (
            !message ||
            message.fromAgentId !== receipt.agentId ||
            !message.payload.includes(`coding-receipt:${receipt.id}`) ||
            receipt.state === 'running'
          )
            throw new Error('Coding receipt requires an authorized producer message')
        }
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
      throw new Error('Unknown coding operation')
    },
  }
}
