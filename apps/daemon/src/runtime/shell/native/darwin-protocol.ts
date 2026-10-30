import type { DarwinProcessMember } from '../../../lib/process/darwin.ts'
import type {
  DarwinCensusIdentity,
  DarwinCensusInventory,
  DarwinCensusUnknown,
  DarwinCensusView,
} from '../../../lib/process/darwin-census.ts'

/** Private daemon/helper protocol. Never a model tool or native wire-shape override. */
export const DARWIN_JOB_PROTOCOL = 1
export const DARWIN_JOB_MAX_FRAME_BYTES = 2 * 1024 * 1024
export const DARWIN_JOB_MAX_COMMAND_BYTES = 256 * 1024
export type DarwinJobRequest =
  | { readonly type: 'execute'; readonly id: number; readonly command: string }
  | { readonly type: 'signal'; readonly id: number; readonly signal: 'SIGTERM' | 'SIGKILL' }
  | { readonly type: 'seal'; readonly id: number }
  | { readonly type: 'scope'; readonly id: number; readonly inventory: DarwinCensusInventory }
  | { readonly type: 'exit'; readonly id: number; readonly scopeId: number }
export type DarwinJobResponse =
  | {
      readonly type: 'ready'
      readonly version: 1
      readonly nonce: string
      readonly owner: DarwinCensusIdentity
      readonly native: DarwinProcessMember
    }
  | { readonly type: 'started'; readonly id: number }
  | { readonly type: 'signal'; readonly id: number; readonly accepted: boolean }
  | { readonly type: 'output'; readonly stream: 'stdout' | 'stderr'; readonly data: string }
  | {
      readonly type: 'completed'
      readonly code: number | null
      readonly signal: NodeJS.Signals | null
      readonly naturalEOF: boolean
      readonly stdoutTruncated: boolean
      readonly stderrTruncated: boolean
    }
  | { readonly type: 'sealed'; readonly id: number }
  | {
      readonly type: 'view'
      readonly id: number
      readonly view: DarwinCensusView | DarwinCensusUnknown
    }
  | { readonly type: 'exiting'; readonly id: number }
  | { readonly type: 'fatal'; readonly error: 'native_job_unavailable' }
export type DarwinJobPhase = 'waiting' | 'running' | 'completed' | 'sealed' | 'closing'
function unavailable(): never {
  throw new Error('Native macOS job protocol unavailable')
}
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
function keys(value: Record<string, unknown>, names: readonly string[]) {
  if (
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    unavailable()
}
export function parseDarwinJobRequest(value: unknown): DarwinJobRequest {
  if (!record(value) || !id(value.id)) unavailable()
  switch (value.type) {
    case 'execute': {
      keys(value, ['type', 'id', 'command'])
      const command = value.command
      if (
        typeof command !== 'string' ||
        !command.trim() ||
        command.includes('\0') ||
        Buffer.byteLength(command) > DARWIN_JOB_MAX_COMMAND_BYTES ||
        Buffer.from(command, 'utf8').toString('utf8') !== command
      )
        unavailable()
      return Object.freeze({ type: 'execute', id: value.id, command })
    }
    case 'signal':
      keys(value, ['type', 'id', 'signal'])
      if (value.signal !== 'SIGTERM' && value.signal !== 'SIGKILL') unavailable()
      return Object.freeze({ type: 'signal', id: value.id, signal: value.signal })
    case 'seal':
      keys(value, ['type', 'id'])
      return Object.freeze({ type: 'seal', id: value.id })
    case 'scope': {
      keys(value, ['type', 'id', 'inventory'])
      const inventory = value.inventory
      if (!record(inventory)) unavailable()
      keys(inventory, ['kind', 'rows'])
      if (
        inventory.kind !== 'inventory' ||
        !Array.isArray(inventory.rows) ||
        inventory.rows.length === 0 ||
        inventory.rows.length > 16384
      )
        unavailable()
      // The shared closed reader validates every identity/layout/state. Invalid rows yield an
      // explicit unknown view, never a partial set or a PID adopted as signalling authority.
      return Object.freeze({
        type: 'scope',
        id: value.id,
        inventory: inventory as unknown as DarwinCensusInventory,
      })
    }
    case 'exit':
      keys(value, ['type', 'id', 'scopeId'])
      if (!id(value.scopeId)) unavailable()
      return Object.freeze({ type: 'exit', id: value.id, scopeId: value.scopeId })
    default:
      unavailable()
  }
}

/** One command and a permanent spawn fence, not a durable stages/retry engine. */
export function nextDarwinJobPhase(
  phase: DarwinJobPhase,
  request: DarwinJobRequest,
): DarwinJobPhase {
  switch (request.type) {
    case 'execute':
      if (phase === 'waiting') return 'running'
      break
    case 'signal':
      if (phase === 'running' || phase === 'completed') return phase
      break
    case 'seal':
      if (phase === 'waiting' || phase === 'completed') return 'sealed'
      break
    case 'scope':
      if (phase === 'sealed') return 'sealed'
      break
    case 'exit':
      if (phase === 'sealed') return 'closing'
      break
  }
  return unavailable()
}
