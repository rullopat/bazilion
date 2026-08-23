import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import type {
  Attachment,
  BashApprovalMode,
  ReasoningLevel,
  ResolvedAgent,
} from '@bazilion/api-types'
import type { PromptSkill, ProtectedHomeDocuments } from '../session/prompt.ts'
import type { ProtectedDockerRuntime } from '../shell/docker.ts'
import type { InjectedMcpTool } from './ipc-protocol.ts'

export const REDACTED_VALUE = '[REDACTED]'

export interface OpenAICodexWorkerRuntime {
  providerName: 'openai-codex'
  modelId: string
  reasoningLevel: ReasoningLevel
  /** Current short-lived OAuth access token. The refresh credential never crosses this wire. */
  accessToken: string
}

export interface ProtectedWorkerPaths {
  agentDir: string
  teamDir: string
  memoryDir: string
  sessionDir: string
  uploadsDir?: string
  /** Prompt bodies and exact, daemon-resolved read-only Docker mount paths. */
  skills: PromptSkill[]
  /** Daemon-prepared fixed-file snapshot; protected workers never follow home-file symlinks. */
  homeDocuments: ProtectedHomeDocuments
}

export interface ConfiguredOperatorHttpWorkerSpec {
  kind: 'configured_operator_http'
  /** Pre-resolved agent record — the worker never queries the DB itself. */
  agent: ResolvedAgent
  message: string
  enabledProviders: string[]
  apiKey?: string
  browserEnabled?: boolean
  mcpTools?: InjectedMcpTool[]
  images?: Attachment[]
  turnId: string
  bashApprovalMode: BashApprovalMode
}

export interface ProtectedWorkerSpec {
  kind: 'protected'
  agent: ResolvedAgent
  message: string
  images?: Attachment[]
  turnId: string
  bashApprovalMode: 'auto_deny'
  runtime: OpenAICodexWorkerRuntime
  paths: ProtectedWorkerPaths
  docker: ProtectedDockerRuntime
  /** The only general web capability in the protected normal surface. */
  webFetchEnabled: true
}

export interface RestrictedReviewWorkerSpec {
  kind: 'restricted_review'
  agentId: string
  message: string
  turnId: string
  runtime: OpenAICodexWorkerRuntime
  review: {
    reviewId: string
    evidence: Array<{ sessionId: string; entryOrdinal: number }>
  }
}

export type WorkerTurnSpec = ConfiguredOperatorHttpWorkerSpec | ProtectedWorkerSpec

export interface MinimalWorkerScratch {
  root: string
  homeDir: string
  tempDir: string
  piAgentDir: string
  reviewCwd: string
  reviewSessionDir: string
}

export type WorkerInput =
  | (ConfiguredOperatorHttpWorkerSpec & { apiKeyRefreshEnabled: boolean })
  | (ProtectedWorkerSpec & {
      apiKeyRefreshEnabled: true
      scratch: MinimalWorkerScratch
    })
  | (RestrictedReviewWorkerSpec & {
      apiKeyRefreshEnabled: true
      scratch: MinimalWorkerScratch
    })

const REASONING_LEVELS = new Set<ReasoningLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
])

const CONFIGURED_KEYS = new Set([
  'kind',
  'agent',
  'message',
  'enabledProviders',
  'apiKey',
  'apiKeyRefreshEnabled',
  'browserEnabled',
  'mcpTools',
  'images',
  'turnId',
  'bashApprovalMode',
])
const CONFIGURED_REQUIRED_KEYS = new Set([
  'kind',
  'agent',
  'message',
  'enabledProviders',
  'apiKeyRefreshEnabled',
  'turnId',
  'bashApprovalMode',
])
const PROTECTED_KEYS = new Set([
  'kind',
  'agent',
  'message',
  'images',
  'turnId',
  'bashApprovalMode',
  'runtime',
  'paths',
  'docker',
  'webFetchEnabled',
  'apiKeyRefreshEnabled',
  'scratch',
])
const PROTECTED_REQUIRED_KEYS = new Set([...PROTECTED_KEYS].filter((key) => key !== 'images'))
const REVIEW_KEYS = new Set([
  'kind',
  'agentId',
  'message',
  'turnId',
  'runtime',
  'review',
  'apiKeyRefreshEnabled',
  'scratch',
])

/** Create the complete scratch tree used by one protected/review child. */
export function createMinimalWorkerScratch(parentDir = tmpdir()): MinimalWorkerScratch {
  const root = mkdtempSync(join(parentDir, 'bazilion-worker-'))
  const scratch: MinimalWorkerScratch = {
    root,
    homeDir: join(root, 'home'),
    tempDir: join(root, 'tmp'),
    piAgentDir: join(root, 'pi'),
    reviewCwd: join(root, 'review-work'),
    reviewSessionDir: join(root, 'review-session'),
  }
  try {
    for (const path of Object.values(scratch).slice(1)) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    return scratch
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

export function cleanupMinimalWorkerScratch(scratch: MinimalWorkerScratch): void {
  assertMinimalWorkerScratch(scratch)
  rmSync(scratch.root, { recursive: true, force: true })
}

/**
 * Construct the exact process environment for a protected/review child.
 * Docker/provider/tool configuration is deliberately not represented here.
 */
export function minimalWorkerProcessEnv(
  scratch: MinimalWorkerScratch,
  platform: NodeJS.Platform = process.platform,
  hostEnv: Readonly<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  assertMinimalWorkerScratch(scratch)
  if (platform === 'win32') {
    const systemRoot = requireCanonicalWindowsDirectory(
      hostEnv.SystemRoot ?? hostEnv.WINDIR,
      'SystemRoot',
    )
    const windir = requireCanonicalWindowsDirectory(hostEnv.WINDIR ?? systemRoot, 'WINDIR')
    const comSpec = requireCanonicalWindowsFile(hostEnv.ComSpec, 'ComSpec')
    const pathExt = hostEnv.PATHEXT
    if (!pathExt || pathExt.includes('\0') || pathExt.includes('\n') || pathExt.includes('\r')) {
      throw new Error('minimal worker bootstrap requires a valid PATHEXT on Windows')
    }
    return {
      USERPROFILE: scratch.homeDir,
      TMPDIR: scratch.tempDir,
      TMP: scratch.tempDir,
      TEMP: scratch.tempDir,
      SystemRoot: systemRoot,
      WINDIR: windir,
      ComSpec: comSpec,
      PATHEXT: pathExt,
    }
  }
  return {
    HOME: scratch.homeDir,
    TMPDIR: scratch.tempDir,
    TMP: scratch.tempDir,
    TEMP: scratch.tempDir,
    LANG: 'C',
    LC_ALL: 'C',
  }
}

export function validateMinimalWorkerProcessEnv(
  env: Readonly<NodeJS.ProcessEnv>,
  scratch: MinimalWorkerScratch,
  platform: NodeJS.Platform = process.platform,
): void {
  const expected = minimalWorkerProcessEnv(scratch, platform, env)
  const actualKeys = Object.keys(env).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`minimal worker environment has unexpected keys: ${actualKeys.join(', ')}`)
  }
  for (const key of expectedKeys) {
    if (env[key] !== expected[key]) {
      throw new Error(`minimal worker environment has an invalid ${key} value`)
    }
  }
}

export function parseWorkerInput(value: unknown): WorkerInput {
  const input = objectRecord(value, 'worker input')
  const kind = input.kind
  if (kind === 'configured_operator_http') {
    assertExactKeys(input, CONFIGURED_KEYS, 'configured worker input', CONFIGURED_REQUIRED_KEYS)
    if (!isResolvedAgent(input.agent)) throw new Error('worker: configured input requires an agent')
    requireString(input.message, 'message')
    if (!Array.isArray(input.enabledProviders) || !input.enabledProviders.every(isString)) {
      throw new Error('worker: configured input requires enabledProviders')
    }
    requireString(input.turnId, 'turnId')
    if (input.bashApprovalMode !== 'interactive' && input.bashApprovalMode !== 'auto_deny') {
      throw new Error('worker: configured input requires a valid bashApprovalMode')
    }
    if (typeof input.apiKeyRefreshEnabled !== 'boolean') {
      throw new Error('worker: configured input requires apiKeyRefreshEnabled')
    }
    if (input.apiKeyRefreshEnabled) {
      const providerName = input.agent.model.split(':', 1)[0] ?? ''
      if (providerName !== 'openai-codex' || !nonEmptyString(input.apiKey)) {
        throw new Error(
          'worker: API key refresh requires an openai-codex turn with an initial token',
        )
      }
    }
    return value as WorkerInput
  }

  if (kind === 'protected') {
    assertExactKeys(input, PROTECTED_KEYS, 'protected worker input', PROTECTED_REQUIRED_KEYS)
    if (!isResolvedAgent(input.agent)) throw new Error('worker: protected input requires an agent')
    requireString(input.message, 'message')
    requireString(input.turnId, 'turnId')
    if (input.bashApprovalMode !== 'auto_deny') {
      throw new Error('worker: protected input requires auto-deny shell approval')
    }
    if (input.webFetchEnabled !== true) {
      throw new Error('worker: protected input requires guarded web_fetch')
    }
    assertOpenAICodexRuntime(input.runtime)
    assertProtectedWorkerPaths(input.paths, input.agent)
    assertProtectedDockerRuntime(input.docker, input.paths as ProtectedWorkerPaths)
    if (input.apiKeyRefreshEnabled !== true) {
      throw new Error('worker: protected input requires bound API key refresh')
    }
    assertMinimalWorkerScratch(input.scratch)
    return value as WorkerInput
  }

  if (kind === 'restricted_review') {
    assertExactKeys(input, REVIEW_KEYS, 'restricted review worker input', REVIEW_KEYS)
    requireString(input.agentId, 'agentId')
    requireString(input.message, 'message')
    requireString(input.turnId, 'turnId')
    assertOpenAICodexRuntime(input.runtime)
    if (input.apiKeyRefreshEnabled !== true) {
      throw new Error('worker: restricted review requires bound API key refresh')
    }
    assertMinimalWorkerScratch(input.scratch)
    const review = objectRecord(input.review, 'review metadata')
    assertExactKeys(
      review,
      new Set(['reviewId', 'evidence']),
      'review metadata',
      new Set(['reviewId', 'evidence']),
    )
    requireString(review.reviewId, 'reviewId')
    if (!Array.isArray(review.evidence)) throw new Error('worker: review evidence must be an array')
    for (const item of review.evidence) {
      const evidence = objectRecord(item, 'review evidence')
      assertExactKeys(
        evidence,
        new Set(['sessionId', 'entryOrdinal']),
        'review evidence',
        new Set(['sessionId', 'entryOrdinal']),
      )
      requireString(evidence.sessionId, 'sessionId')
      if (!Number.isInteger(evidence.entryOrdinal) || Number(evidence.entryOrdinal) < 0) {
        throw new Error('worker: review evidence entryOrdinal must be a non-negative integer')
      }
    }
    return value as WorkerInput
  }

  throw new Error('worker: unknown or missing runtime kind')
}

export function assertOpenAICodexRuntime(
  value: unknown,
): asserts value is OpenAICodexWorkerRuntime {
  const runtime = objectRecord(value, 'OpenAI Codex runtime')
  assertExactKeys(
    runtime,
    new Set(['providerName', 'modelId', 'reasoningLevel', 'accessToken']),
    'OpenAI Codex runtime',
    new Set(['providerName', 'modelId', 'reasoningLevel', 'accessToken']),
  )
  if (runtime.providerName !== 'openai-codex') {
    throw new Error('protected execution supports only openai-codex')
  }
  if (!nonEmptyString(runtime.modelId)) throw new Error('OpenAI Codex runtime requires a model id')
  if (!REASONING_LEVELS.has(runtime.reasoningLevel as ReasoningLevel)) {
    throw new Error('OpenAI Codex runtime requires a valid reasoning level')
  }
  if (!nonEmptyString(runtime.accessToken)) {
    throw new Error('OpenAI Codex runtime requires a current access token')
  }
}

export function redactExactValue(text: string, value: string | undefined): string {
  return value ? text.replaceAll(value, REDACTED_VALUE) : text
}

export function redactExactValues(text: string, values: readonly string[]): string {
  let redacted = text
  for (const value of [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.replaceAll(value, REDACTED_VALUE)
  }
  return redacted
}

/** Exact-value redactor that safely handles matches split across stream chunks. */
export class ExactValueStreamRedactor {
  readonly #values: string[] = []
  #pending = ''

  constructor(value: string | readonly string[]) {
    const values = typeof value === 'string' ? [value] : value
    for (const item of values) this.add(item)
  }

  add(value: string): void {
    if (!value) throw new Error('stream redactor requires a non-empty value')
    if (!this.#values.includes(value)) this.#values.push(value)
  }

  push(chunk: string): string {
    const data = this.#pending + chunk
    const maxLength = Math.max(...this.#values.map((value) => value.length))
    const cutoff = Math.max(0, data.length - (maxLength - 1))
    let output = ''
    let cursor = 0
    while (cursor < cutoff) {
      const match = this.#nextMatch(data, cursor)
      if (!match || match.index >= cutoff) {
        output += data.slice(cursor, cutoff)
        cursor = cutoff
        break
      }
      output += data.slice(cursor, match.index) + REDACTED_VALUE
      cursor = match.index + match.value.length
    }
    this.#pending = data.slice(cursor)
    return output
  }

  flush(): string {
    const output = redactExactValues(this.#pending, this.#values)
    this.#pending = ''
    return output
  }

  #nextMatch(data: string, cursor: number): { index: number; value: string } | null {
    let next: { index: number; value: string } | null = null
    for (const value of this.#values) {
      const index = data.indexOf(value, cursor)
      if (index < 0) continue
      if (
        !next ||
        index < next.index ||
        (index === next.index && value.length > next.value.length)
      ) {
        next = { index, value }
      }
    }
    return next
  }
}

export function redactJsonValue<T>(value: T, secrets: string | readonly string[] | undefined): T {
  if (!secrets || (Array.isArray(secrets) && secrets.length === 0)) return value
  const values = typeof secrets === 'string' ? [secrets] : secrets
  if (typeof value === 'string') return redactExactValues(value, values) as T
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, values)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonValue(item, values)]),
    ) as T
  }
  return value
}

function assertProtectedWorkerPaths(value: unknown, agent: ResolvedAgent): void {
  const paths = objectRecord(value, 'protected worker paths')
  assertExactKeys(
    paths,
    new Set([
      'agentDir',
      'teamDir',
      'memoryDir',
      'sessionDir',
      'uploadsDir',
      'skills',
      'homeDocuments',
    ]),
    'protected worker paths',
    new Set(['agentDir', 'teamDir', 'memoryDir', 'sessionDir', 'skills', 'homeDocuments']),
  )
  for (const key of ['agentDir', 'teamDir', 'memoryDir', 'sessionDir'] as const) {
    requireAbsolutePath(paths[key], key)
  }
  if (paths.uploadsDir !== undefined) requireAbsolutePath(paths.uploadsDir, 'uploadsDir')
  if (paths.agentDir !== agent.agent.dir || paths.teamDir !== agent.team.path) {
    throw new Error('worker: protected paths do not match the resolved Agent')
  }
  const canonicalAgentDir = requireCanonicalRealDirectory(
    paths.agentDir as string,
    'Agent directory',
  )
  const canonicalTeamDir = resolveCanonicalDirectory(paths.teamDir as string, 'Team directory')
  requireCanonicalContainedDirectory(
    canonicalAgentDir,
    paths.sessionDir as string,
    'session directory',
  )
  if (paths.uploadsDir !== undefined) {
    requireCanonicalContainedDirectory(
      canonicalAgentDir,
      paths.uploadsDir as string,
      'uploads directory',
    )
  }
  requireCanonicalContainedDirectory(
    canonicalTeamDir,
    paths.memoryDir as string,
    'memory directory',
  )
  if (!Array.isArray(paths.skills)) throw new Error('worker: protected skills must be an array')
  for (const item of paths.skills) {
    const skill = objectRecord(item, 'protected skill')
    assertExactKeys(
      skill,
      new Set(['name', 'description', 'body', 'hostDir', 'sandboxDir']),
      'protected skill',
    )
    requireString(skill.name, 'skill name')
    requireString(skill.description, 'skill description')
    requireString(skill.body, 'skill body')
    requireAbsolutePath(skill.hostDir, 'skill hostDir')
    requireCanonicalRealDirectory(skill.hostDir, 'skill hostDir')
    if (typeof skill.sandboxDir !== 'string' || !skill.sandboxDir.startsWith('/skills/')) {
      throw new Error('worker: protected skill sandbox path must be under /skills')
    }
  }
  const homeDocuments = objectRecord(paths.homeDocuments, 'protected home documents')
  const homeDocumentKeys = new Set([
    'AGENTS.md',
    'SOUL.md',
    'TOOLS.md',
    'IDENTITY.md',
    'BOOTSTRAP.md',
  ])
  assertExactKeys(homeDocuments, homeDocumentKeys, 'protected home documents', homeDocumentKeys)
  for (const [name, contents] of Object.entries(homeDocuments)) {
    if (contents !== null && typeof contents !== 'string') {
      throw new Error(`worker: protected home document ${name} must be text or null`)
    }
  }
}

function assertProtectedDockerRuntime(
  value: unknown,
  paths: ProtectedWorkerPaths,
): asserts value is ProtectedDockerRuntime {
  const runtime = objectRecord(value, 'protected Docker runtime')
  assertExactKeys(
    runtime,
    new Set([
      'dockerPath',
      'executableIdentity',
      'endpoint',
      'image',
      'imageId',
      'uid',
      'gid',
      'workspace',
      'readOnlyMounts',
      'containerEnv',
    ]),
    'protected Docker runtime',
    new Set([
      'dockerPath',
      'executableIdentity',
      'endpoint',
      'image',
      'imageId',
      'uid',
      'gid',
      'workspace',
      'readOnlyMounts',
      'containerEnv',
    ]),
  )
  requireAbsolutePath(runtime.dockerPath, 'Docker executable')
  const executableIdentity = objectRecord(
    runtime.executableIdentity,
    'protected Docker executable identity',
  )
  const executableIdentityKeys = new Set([
    'device',
    'inode',
    'mode',
    'size',
    'modifiedTimeNs',
    'changedTimeNs',
  ])
  assertExactKeys(
    executableIdentity,
    executableIdentityKeys,
    'protected Docker executable identity',
    executableIdentityKeys,
  )
  for (const [name, field] of Object.entries(executableIdentity)) {
    if (typeof field !== 'string' || !/^\d+$/.test(field)) {
      throw new Error(`worker: protected Docker executable identity has invalid ${name}`)
    }
  }
  if (
    typeof runtime.endpoint !== 'string' ||
    !runtime.endpoint.startsWith('unix://') ||
    !isAbsolute(runtime.endpoint.slice('unix://'.length)) ||
    containsUnsafeDockerArgument(runtime.endpoint)
  ) {
    throw new Error('worker: protected Docker endpoint must be a local Unix socket')
  }
  if (
    !nonEmptyString(runtime.image) ||
    runtime.image.startsWith('-') ||
    runtime.image.includes('\0') ||
    runtime.image.includes('\n') ||
    runtime.image.includes('\r')
  ) {
    throw new Error('worker: protected Docker image is required')
  }
  if (typeof runtime.imageId !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(runtime.imageId)) {
    throw new Error('worker: protected Docker runtime requires an immutable image id')
  }
  if (!Number.isSafeInteger(runtime.uid) || !Number.isSafeInteger(runtime.gid)) {
    throw new Error('worker: protected Docker runtime requires a numeric host identity')
  }
  if (Number(runtime.uid) < 0 || Number(runtime.gid) < 0) {
    throw new Error('worker: protected Docker runtime requires a non-negative host identity')
  }
  const workspace = objectRecord(runtime.workspace, 'protected Docker workspace')
  assertExactKeys(
    workspace,
    new Set(['source', 'target', 'sourceRoot']),
    'protected Docker workspace',
    new Set(['source', 'target', 'sourceRoot']),
  )
  requireAbsolutePath(workspace.source, 'Docker workspace source')
  requireAbsolutePath(workspace.sourceRoot, 'Docker workspace root')
  assertSafeDockerHostPath(workspace.source, 'Docker workspace source')
  assertSafeDockerHostPath(workspace.sourceRoot, 'Docker workspace root')
  if (workspace.target !== '/workspace') {
    throw new Error('worker: protected Docker workspace target must be /workspace')
  }
  const canonicalTeamDir = resolveCanonicalDirectory(paths.teamDir, 'Team directory')
  if (workspace.source !== canonicalTeamDir || workspace.sourceRoot !== canonicalTeamDir) {
    throw new Error('worker: protected Docker workspace does not match the canonical Team root')
  }
  if (!Array.isArray(runtime.readOnlyMounts)) {
    throw new Error('worker: protected Docker read-only mounts must be an array')
  }
  const mountTargets = new Set(['/workspace', '/tmp'])
  for (const item of runtime.readOnlyMounts) {
    const mount = objectRecord(item, 'protected Docker read-only mount')
    assertExactKeys(
      mount,
      new Set(['source', 'target', 'sourceRoot']),
      'protected Docker read-only mount',
      new Set(['source', 'target', 'sourceRoot']),
    )
    requireAbsolutePath(mount.source, 'Docker read-only mount source')
    requireAbsolutePath(mount.sourceRoot, 'Docker read-only mount root')
    assertSafeDockerHostPath(mount.source, 'Docker read-only mount source')
    assertSafeDockerHostPath(mount.sourceRoot, 'Docker read-only mount root')
    if (
      typeof mount.target !== 'string' ||
      !mount.target.startsWith('/') ||
      containsUnsafeDockerArgument(mount.target) ||
      mount.target.split('/').includes('..') ||
      (!mount.target.startsWith('/skills/') &&
        mount.target !== '/inputs' &&
        mount.target !== '/workspace/memory')
    ) {
      throw new Error('worker: protected Docker read-only mount target is not permitted')
    }
    if (!lexicallyWithin(mount.sourceRoot, mount.source)) {
      throw new Error('worker: protected Docker read-only mount escaped its root')
    }
    if (mountTargets.has(mount.target)) {
      throw new Error('worker: protected Docker mount target is duplicated')
    }
    mountTargets.add(mount.target)
  }
  assertExactProtectedDockerMounts(
    runtime.readOnlyMounts as ProtectedDockerRuntime['readOnlyMounts'],
    paths,
  )
  const containerEnv = objectRecord(runtime.containerEnv, 'protected Docker container environment')
  const expectedContainerEnv = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    SHELL: '/bin/bash',
    TMPDIR: '/tmp',
  }
  const expectedKeys = new Set(Object.keys(expectedContainerEnv))
  assertExactKeys(
    containerEnv,
    expectedKeys,
    'protected Docker container environment',
    expectedKeys,
  )
  for (const [key, expected] of Object.entries(expectedContainerEnv)) {
    if (containerEnv[key] !== expected) {
      throw new Error(`worker: protected Docker container environment has invalid ${key}`)
    }
  }
}

function assertExactProtectedDockerMounts(
  mounts: ProtectedDockerRuntime['readOnlyMounts'],
  paths: ProtectedWorkerPaths,
): void {
  const expected = new Map<string, string>([
    ['/workspace/memory', paths.memoryDir],
    ...((paths.uploadsDir ? [['/inputs', paths.uploadsDir]] : []) as Array<[string, string]>),
    ...paths.skills.map((skill) => [skill.sandboxDir, skill.hostDir] as [string, string]),
  ])
  if (mounts.length !== expected.size) {
    throw new Error('worker: protected Docker read-only mount set is incomplete')
  }
  for (const mount of mounts) {
    const source = expected.get(mount.target)
    if (!source || mount.source !== source) {
      throw new Error('worker: protected Docker read-only mount set does not match protected paths')
    }
  }
}

function assertSafeDockerHostPath(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || containsUnsafeDockerArgument(value)) {
    throw new Error(`worker: ${name} cannot be represented safely`)
  }
}

function containsUnsafeDockerArgument(value: string): boolean {
  return value.includes('\0') || value.includes(',') || value.includes('\n') || value.includes('\r')
}

function requireCanonicalRealDirectory(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`worker: ${name} must be a path`)
  try {
    const entry = lstatSync(value)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error('unsafe entry')
    }
    const canonical = realpathSync(value)
    if (canonical !== value) throw new Error('non-canonical entry')
    return canonical
  } catch {
    throw new Error(`worker: ${name} must be a real directory`)
  }
}

function resolveCanonicalDirectory(value: string, name: string): string {
  try {
    const entry = statSync(value)
    if (!entry.isDirectory()) throw new Error('not a directory')
    return realpathSync(value)
  } catch {
    throw new Error(`worker: ${name} is unavailable or unsafe`)
  }
}

function requireCanonicalContainedDirectory(root: string, value: string, name: string): string {
  const canonical = requireCanonicalRealDirectory(value, name)
  if (!lexicallyWithin(root, canonical)) throw new Error(`worker: ${name} escaped its root`)
  return canonical
}

function assertMinimalWorkerScratch(value: unknown): asserts value is MinimalWorkerScratch {
  const scratch = objectRecord(value, 'minimal worker scratch')
  assertExactKeys(
    scratch,
    new Set(['root', 'homeDir', 'tempDir', 'piAgentDir', 'reviewCwd', 'reviewSessionDir']),
    'minimal worker scratch',
    new Set(['root', 'homeDir', 'tempDir', 'piAgentDir', 'reviewCwd', 'reviewSessionDir']),
  )
  requireAbsolutePath(scratch.root, 'scratch root')
  for (const key of [
    'homeDir',
    'tempDir',
    'piAgentDir',
    'reviewCwd',
    'reviewSessionDir',
  ] as const) {
    requireAbsolutePath(scratch[key], key)
    if (!lexicallyWithin(scratch.root as string, scratch[key] as string)) {
      throw new Error(`worker: ${key} escaped the scratch root`)
    }
  }
}

function requireCanonicalWindowsDirectory(value: string | undefined, name: string): string {
  if (!value || !isAbsolute(value) || !existsSync(value) || !statSync(value).isDirectory()) {
    throw new Error(`minimal worker bootstrap requires a valid ${name} directory`)
  }
  return realpathSync(value)
}

function requireCanonicalWindowsFile(value: string | undefined, name: string): string {
  if (!value || !isAbsolute(value) || !existsSync(value) || !statSync(value).isFile()) {
    throw new Error(`minimal worker bootstrap requires a valid ${name} executable`)
  }
  return realpathSync(value)
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`worker: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
  required: ReadonlySet<string> = allowed,
) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (unexpected.length > 0) {
    throw new Error(`worker: ${label} contains unexpected fields: ${unexpected.sort().join(', ')}`)
  }
  const missing = [...required].filter((key) => !(key in value))
  if (missing.length > 0) {
    throw new Error(`worker: ${label} is missing required fields: ${missing.sort().join(', ')}`)
  }
}

function isResolvedAgent(value: unknown): value is ResolvedAgent {
  if (!value || typeof value !== 'object') return false
  const resolved = value as Partial<ResolvedAgent>
  return Boolean(
    resolved.agent &&
      typeof resolved.agent.id === 'string' &&
      typeof resolved.agent.dir === 'string' &&
      resolved.team &&
      typeof resolved.team.id === 'string' &&
      typeof resolved.team.path === 'string' &&
      typeof resolved.model === 'string',
  )
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`worker: ${name} must be a string`)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function requireAbsolutePath(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
    throw new Error(`worker: ${name} must be an absolute path`)
  }
}

function lexicallyWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Test/preflight helper for checking that every scratch directory is accessible. */
export async function checkMinimalWorkerScratch(scratch: MinimalWorkerScratch): Promise<void> {
  assertMinimalWorkerScratch(scratch)
  for (const path of Object.values(scratch)) await access(path, constants.R_OK | constants.W_OK)
}
