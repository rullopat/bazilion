import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VerificationBlocker, VerificationEnvironmentFacts } from '@bazilion/api-types'
import { validateCodingEnvironmentConfig } from '../../core/coding-environment/config.ts'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import { resolveTeamNativeCodingEnvironment } from '../coding-environment/resolve.ts'
import { workspaceIdentity } from '../coding-environment/workspace.ts'
import { requireTeam } from '../git-review/service.ts'
import { NativeCommandError } from '../native-execution/command.ts'
import {
  assertBoundNativeTurnForWorker,
  type NativeTurnExecution,
  type NativeWorkerBinding,
  prepareNativeTurn,
  revalidateBoundNativeTurnForWorker,
} from '../native-execution/turn.ts'
import { ContextDirectory } from '../repository-context/files.ts'
import {
  assertVerificationCommandSecrets,
  snapshotVerificationCaptureIntent,
  type VerificationCaptureIntent,
  validateVerificationCaptureInputs,
} from './capture-input.ts'
import { NativeVerificationPreparationError } from './native-error.ts'

/** Nominal observation of real readiness, never permission to execute or signal. */
export interface NativeVerificationCapture {
  readonly kind: 'native-verification-capture'
}
type NativeEnvironment = Extract<VerificationEnvironmentFacts, { sandbox: 'native' }>
interface Observation {
  db: BazilionDb
  paths: Paths
  intent: string
  environment: NativeEnvironment
  used: boolean
  validate(): void
}
const observations = new WeakMap<object, Observation>()
const digest = (intent: VerificationCaptureIntent) =>
  createHash('sha256').update(JSON.stringify(intent)).digest('hex')
const refusal = () => new Error('Native verification capture is not a genuine matching observation')
export function consumeNativeVerificationCapture(
  value: unknown,
  db: BazilionDb,
  paths: Paths,
  intent: VerificationCaptureIntent,
): NativeEnvironment {
  if (!value || typeof value !== 'object') throw refusal()
  const observed = observations.get(value)
  if (
    !observed ||
    observed.used ||
    observed.db !== db ||
    observed.paths !== paths ||
    observed.intent !== digest(intent)
  )
    throw refusal()
  observed.validate()
  observed.used = true
  return {
    ...observed.environment,
    native: { ...observed.environment.native },
    env: { ...observed.environment.env },
  }
}

export type PreparedNativeCaptureResult =
  | { kind: 'prepared'; capture: NativeVerificationCapture; intent: VerificationCaptureIntent }
  | { kind: 'blocked'; blocker: VerificationBlocker }

/** Freeze the owning coding turn's real admission; a worker cannot supply environment facts. */
export async function prepareNativeAgentVerificationCapture(input: {
  db: BazilionDb
  paths: Paths
  intent: VerificationCaptureIntent
  host: NativeTurnExecution
  binding: NativeWorkerBinding
  secrets: () => readonly string[]
}): Promise<PreparedNativeCaptureResult> {
  const options = Object.freeze({ ...input })
  const validation = validateVerificationCaptureInputs(options.db, options.paths, options.intent)
  if (validation.kind === 'blocked') return validation
  const intent = snapshotVerificationCaptureIntent(options.intent)
  const binding = Object.freeze({
    ...options.binding,
    admission: Object.freeze({
      cwd: options.binding.admission.cwd,
      facts: Object.freeze({ ...options.binding.admission.facts }),
    }),
  })
  const check = () => {
    if (
      intent.requesterKind !== 'agent' ||
      intent.requesterAgentId !== binding.agentId ||
      intent.teamId !== binding.teamId ||
      binding.registeredRoot !== requireTeam(options.db, options.paths, intent.teamId).path
    )
      throw refusal()
    assertBoundNativeTurnForWorker(options.host, binding)
    assertVerificationCommandSecrets(intent, options.secrets())
    const selected = resolveTeamNativeCodingEnvironment(options.db, intent.teamId)
    if (
      selected.cwd !== options.host.cwd ||
      (['CI', 'NO_COLOR', 'TZ'] as const).some((key) => selected.env[key] !== options.host.env[key])
    )
      throw refusal()
  }
  check()
  await revalidateBoundNativeTurnForWorker(options.host, binding)
  check()
  const values = validateCodingEnvironmentConfig({
    backend: 'native',
    cwd: options.host.cwd,
    env: options.host.env,
  })
  const capture: NativeVerificationCapture = Object.freeze({ kind: 'native-verification-capture' })
  observations.set(capture, {
    db: options.db,
    paths: options.paths,
    intent: digest(intent),
    used: false,
    environment: {
      sandbox: 'native',
      image: null,
      native: options.host.facts,
      cwd: options.host.cwd,
      env: { ...values.env },
      inputScope: 'team-memory',
    },
    validate: check,
  })
  return { kind: 'prepared', capture, intent }
}

/** Actual operator readiness. Public callers additionally bind selection and shutdown admission. */
export async function prepareNativeOperatorVerificationCapture(input: {
  db: BazilionDb
  paths: Paths
  intent: VerificationCaptureIntent
  signal?: AbortSignal
  assertSelection?: () => void
  secrets: () => readonly string[]
}): Promise<PreparedNativeCaptureResult> {
  const options = Object.freeze({ ...input })
  const { db, paths } = options
  const validation = validateVerificationCaptureInputs(db, paths, options.intent)
  if (validation.kind === 'blocked') return validation
  if (options.intent.requesterKind !== 'operator')
    return {
      kind: 'blocked',
      blocker: {
        reason: 'unsupported',
        detail: 'Operator native capture cannot impersonate an Agent turn.',
      },
    }
  const intent = snapshotVerificationCaptureIntent(options.intent)
  assertVerificationCommandSecrets(intent, options.secrets())
  const lifecycle = workspaceLifecycle(db),
    team = requireTeam(db, paths, validation.teamId)
  const selection = resolveTeamNativeCodingEnvironment(db, team.id)
  options.signal?.throwIfAborted()
  options.assertSelection?.()
  const lease = await lifecycle.claim(team.id, team.path, 'mutation')
  let root: string | undefined
  let preparing = false
  let host: NativeTurnExecution | undefined, guard: ContextDirectory | undefined
  let environment: NativeEnvironment | undefined
  const assertSelection = () => {
    options.signal?.throwIfAborted()
    options.assertSelection?.()
    assertVerificationCommandSecrets(intent, options.secrets())
    const current = requireTeam(db, paths, team.id)
    if (
      current.path !== team.path ||
      JSON.stringify(resolveTeamNativeCodingEnvironment(db, team.id)) !== JSON.stringify(selection)
    )
      throw refusal()
  }
  try {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-capture-')))
    guard = new ContextDirectory(root)
    preparing = true
    host = await prepareNativeTurn({
      root,
      lifecycle,
      lease,
      cwd: selection.cwd,
      env: { ...selection.env },
      readOnlyDirectories: [],
      readOnlyFiles: [],
      unavailable: [],
      signal: options.signal,
      assertActive() {
        assertSelection()
        lifecycle.coordinator.assertActiveLease(
          lease,
          team.id,
          requireTeam(db, paths, team.id).path,
        )
      },
    })
    assertSelection()
    environment = {
      sandbox: 'native',
      image: null,
      native: host.facts,
      inputScope: 'team-memory',
      cwd: host.cwd,
      env: { ...selection.env },
    }
    if (!(await host.close())) throw new NativeCommandError('recovery_required', false)
    guard.close()
    guard = undefined
  } catch (error) {
    let confirmed = host
      ? await host.close().catch(() => false)
      : !preparing || (error instanceof NativeCommandError && error.cleanupConfirmed)
    try {
      if (!host && confirmed && guard && root) {
        guard.validateIdentity()
        guard.close()
        guard = undefined
        rmSync(root, { recursive: true })
      }
      guard?.close()
    } catch {
      confirmed = false
    }
    await lifecycle.release(lease)
    // Only template retirement may be requested again after canonical positive loan release.
    if (host) await host.close().catch(() => false)
    throw new NativeVerificationPreparationError(
      confirmed ? 'unavailable' : 'recovery_required',
      confirmed,
      error instanceof NativeCommandError ? error.observation : undefined,
    )
  }
  await lifecycle.release(lease)
  if (
    db.raw
      .query<{ id: string }, [string]>('SELECT id FROM workspace_writers WHERE id=?')
      .get(lease.writer.id)
  )
    throw new NativeVerificationPreparationError('recovery_required', false)
  assertSelection()
  const observed: Observation = {
    db,
    paths,
    intent: digest(intent),
    environment,
    used: false,
    validate() {
      assertSelection()
      if (
        workspaceIdentity(requireTeam(db, paths, team.id).path).rootIdentity !==
        lease.writer.rootIdentity
      )
        throw refusal()
    },
  }
  const capture: NativeVerificationCapture = Object.freeze({ kind: 'native-verification-capture' })
  observations.set(capture, observed)
  return { kind: 'prepared', capture, intent }
}
