// What the daemon hands a worker on stdin, the learning-review worker's scratch tree and minimal
// environment, and the exact-value redaction used on everything a worker sends back.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Attachment,
  BashApprovalMode,
  ChatFrame,
  ConversationTarget,
  ReasoningLevel,
  ResolvedAgent,
} from '@bazilion/api-types'
import type { DockerTurn } from '../shell/tooling.ts'
import type { InjectedMcpTool, WorkerHostName } from './ipc-protocol.ts'

const REDACTED_VALUE = '[REDACTED]'

/** The one provider credential a learning review gets; unrelated daemon secrets never cross. */
export interface ReviewProviderRuntime {
  providerName: string
  modelId: string
  reasoningLevel: ReasoningLevel
  apiKey?: string
  baseUrl?: string
  /** Closed provider-specific fields installed in Pi's in-memory credential store, not process.env. */
  credentialEnv?: Array<{ name: string; value: string }>
  /** Explicit Google service-account/ADC JSON materialized only inside this review's scratch tree. */
  credentialFile?: { envName: 'GOOGLE_APPLICATION_CREDENTIALS'; content: string }
}

/** Workspace AGENTS.md files read by the daemon; paths are relative to the Team root. */
export type RepositoryInstructions = ReadonlyArray<{
  readonly path: string
  readonly content: string
}>

/** Every Agent turn, whatever its origin; BAZILION_BASH_SANDBOX alone decides host or Docker bash. */
export interface AgentTurnWorkerSpec {
  kind: 'agent_turn'
  /** Pre-resolved agent record — the worker never queries the DB itself. */
  agent: ResolvedAgent
  conversation: ConversationTarget
  message: string
  images?: Attachment[]
  /** The ChatGPT access token; other providers read their key from the environment. */
  apiKey?: string
  /** The turn's Docker settings; present exactly when BAZILION_BASH_SANDBOX is docker. */
  docker?: DockerTurn
  repositoryInstructions: RepositoryInstructions
  mcpTools?: InjectedMcpTool[]
  turnId: string
  bashApprovalMode: BashApprovalMode
}

/** A learning review: a digest of recent turns, answered only through `propose_lesson`. */
export interface RestrictedReviewWorkerSpec {
  kind: 'restricted_review'
  message: string
  runtime: ReviewProviderRuntime
  /** The transcript entries the digest shows; a proposal may cite only these. */
  evidence: Array<{ sessionId: string; entryOrdinal: number }>
}

export interface MinimalWorkerScratch {
  root: string
  homeDir: string
  tempDir: string
  piAgentDir: string
  reviewCwd: string
  reviewSessionDir: string
}

/** The spec plus the daemon hosts serving this worker, so it offers only tools that work. */
export type WorkerInput =
  | (AgentTurnWorkerSpec & { hosts: WorkerHostName[] })
  | (RestrictedReviewWorkerSpec & { hosts: WorkerHostName[]; scratch: MinimalWorkerScratch })

export interface ReviewWorkerProposal {
  scope: 'private' | 'shared'
  text: string
  evidenceEntryIds: Array<{ sessionId: string; entryOrdinal: number }>
}

/** A worker's stdout line: a chat frame, or a learning review's proposals. */
export type WorkerFrame = ChatFrame | { kind: 'review_result'; proposals: ReviewWorkerProposal[] }

/** The daemon wrote the input itself; the worker checks only that it is one it knows. */
export function parseWorkerInput(value: unknown): WorkerInput {
  const kind = (value as { kind?: unknown } | null)?.kind
  if (kind !== 'agent_turn' && kind !== 'restricted_review') {
    throw new Error('worker: unknown or missing input kind')
  }
  return value as WorkerInput
}

/** Create the scratch tree of one learning-review worker: its home, tmp and Pi state. */
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
  rmSync(scratch.root, { recursive: true, force: true })
}

/** The whole environment of a learning-review worker: no daemon variable reaches it. */
export function minimalWorkerProcessEnv(scratch: MinimalWorkerScratch): NodeJS.ProcessEnv {
  return {
    HOME: scratch.homeDir,
    TMPDIR: scratch.tempDir,
    TMP: scratch.tempDir,
    TEMP: scratch.tempDir,
    LANG: 'C',
    LC_ALL: 'C',
  }
}

export function reviewRuntimeSecrets(runtime: ReviewProviderRuntime): string[] {
  return [
    runtime.apiKey,
    ...(runtime.credentialEnv ?? []).map((field) => field.value),
    runtime.credentialFile?.content,
  ].filter((value): value is string => Boolean(value))
}

export function redactExactValues(text: string, values: readonly string[]): string {
  let redacted = text
  for (const value of [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.replaceAll(value, REDACTED_VALUE)
  }
  return redacted
}

/**
 * A `_`-separated part of a variable name that ends in a credential word (`OPENAI_API_KEY`,
 * `OPENAI_APIKEY`, `PGPASSWORD`, `MCP_TOKEN_<id>`, `GOOGLE_VERTEX_CREDENTIALS_JSON`), so
 * `GIT_AUTHOR_NAME`, `SSH_AUTH_SOCK` or `GNOME_KEYRING_CONTROL` are not mistaken for one.
 */
const CREDENTIAL_NAME = /(^|_)[A-Z0-9]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|OAUTH)(_|$)/i

/** A field of a JSON credential (`private_key`, `refresh`, `accessToken`), not `token_uri`. */
function isCredentialField(field: string): boolean {
  const words = field.replace(/([a-z\d])([A-Z])/g, '$1_$2')
  return /(^|_)(key|token|secret|password|refresh|access)$/i.test(words)
}

/**
 * Credential values from a merged env, for exact-value redaction: every value of a
 * credential-named variable plus the credential fields inside structured (JSON) credentials,
 * never their keys. Values shorter than 8 characters are skipped: they are too common in ordinary
 * output (`1`, `true`, a colour) to redact without destroying it, and are not real credentials.
 */
export function envSecretValues(env: NodeJS.ProcessEnv): string[] {
  const values = new Set<string>()
  function collect(value: unknown, depth = 0) {
    if (depth > 8 || !value || typeof value !== 'object') return
    for (const [field, entry] of Object.entries(value)) {
      if (typeof entry !== 'string') collect(entry, depth + 1)
      else if (entry.length >= 8 && isCredentialField(field)) values.add(entry)
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (!value || !CREDENTIAL_NAME.test(key)) continue
    if (value.length >= 8) values.add(value)
    try {
      collect(JSON.parse(value))
    } catch {
      /* Ordinary string credential. */
    }
  }
  return [...values]
}

/** Exact-value redactor that safely handles matches split across stream chunks. */
export class ExactValueStreamRedactor {
  readonly #values: string[] = []
  #pending = ''

  constructor(values: readonly string[]) {
    for (const value of values) this.add(value)
  }

  add(value: string): void {
    if (value && !this.#values.includes(value)) this.#values.push(value)
  }

  push(chunk: string): string {
    const data = this.#pending + chunk
    const maxLength = Math.max(1, ...this.#values.map((value) => value.length))
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

export function redactJsonValue<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value
  if (typeof value === 'string') return redactExactValues(value, secrets) as T
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, secrets)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonValue(item, secrets)]),
    ) as T
  }
  return value
}
