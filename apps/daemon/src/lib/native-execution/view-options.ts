import { codingRelativePath } from '../../core/coding-environment/config.ts'
import type { NativeInputsOptions } from './inputs.ts'
import { NativeLayoutError } from './layout.ts'

export interface NativeViewOptions extends NativeInputsOptions {
  readonly root: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}
/** Snapshot roles/config before the first await; do not adopt mutations to a caller's object. */
export function snapshotNativeViewOptions(input: NativeViewOptions): NativeViewOptions {
  if (
    !Array.isArray(input.readOnlyDirectories) ||
    !Array.isArray(input.readOnlyFiles) ||
    !Array.isArray(input.unavailable) ||
    !input.env ||
    typeof input.env !== 'object' ||
    Array.isArray(input.env)
  )
    throw new NativeLayoutError('unavailable')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.env)) {
    if (
      (key === 'CI' && ['true', 'false'].includes(value)) ||
      (key === 'NO_COLOR' && ['0', '1'].includes(value)) ||
      (key === 'TZ' && value === 'UTC')
    )
      env[key] = value
    else throw new NativeLayoutError('unavailable')
  }
  return Object.freeze({
    root: input.root,
    workspace: input.workspace,
    cwd: codingRelativePath(input.cwd),
    env: Object.freeze(env),
    readOnlyDirectories: Object.freeze([...input.readOnlyDirectories]),
    readOnlyFiles: Object.freeze(input.readOnlyFiles.map((value) => Object.freeze({ ...value }))),
    unavailable: Object.freeze(input.unavailable.map((value) => Object.freeze({ ...value }))),
    ...(input.signal ? { signal: input.signal } : {}),
  })
}
