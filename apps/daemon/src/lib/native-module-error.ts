const NODE_MODULE_ABI_MISMATCH =
  /was compiled against a different Node\.js version using\s+NODE_MODULE_VERSION\s+(\d+)[\s\S]*?requires\s+NODE_MODULE_VERSION\s+(\d+)/i

export interface NativeModuleErrorOptions {
  subject?: string
}

/**
 * Return a stable, user-safe recovery message for Node native-addon ABI
 * mismatches. The original diagnostic can contain absolute checkout paths, so
 * callers must only retain it in an explicitly internal diagnostic sink.
 */
export function formatNativeModuleAbiMismatch(
  diagnostic: string,
  options: NativeModuleErrorOptions = {},
): string | undefined {
  const mismatch = NODE_MODULE_ABI_MISMATCH.exec(diagnostic)
  if (!mismatch) return undefined

  const builtAbi = mismatch[1]
  const requiredAbi = mismatch[2]
  const rebuildCommand = /better_sqlite3\.node|better-sqlite3/i.test(diagnostic)
    ? '`pnpm rebuild better-sqlite3`'
    : '`pnpm rebuild`'
  const subject = options.subject ?? 'Bazilion'
  return (
    `${subject} could not load a native dependency built for Node module ABI ${builtAbi}; ` +
    `the current ${process.version} runtime requires ABI ${requiredAbi}. ` +
    'Reinstall Bazilion with this same Node.js version, then restart it. ' +
    `From the repository root of a source checkout, run ${rebuildCommand} ` +
    '(or `pnpm install --force`).'
  )
}

export class NativeModuleAbiMismatchError extends Error {
  readonly code = 'native_module_abi_mismatch'

  constructor(message: string) {
    super(message)
    this.name = 'NativeModuleAbiMismatchError'
  }
}

/**
 * Replace an ABI-mismatch error with a safe public error. Raw diagnostics are
 * intentionally not attached as a cause: callers such as the worker launcher
 * may send them to an explicit internal sink before using this helper, but an
 * ordinary logged error must not reveal a checkout path. Non-ABI errors
 * preserve their original identity and message.
 */
export function sanitizeNativeModuleError(
  error: unknown,
  options: NativeModuleErrorOptions = {},
): unknown {
  const diagnostic = error instanceof Error ? error.message : String(error)
  const formatted = formatNativeModuleAbiMismatch(diagnostic, options)
  if (!formatted) return error
  return new NativeModuleAbiMismatchError(formatted)
}

export async function withNativeModuleErrorBoundary<T>(
  operation: () => T | Promise<T>,
  options: NativeModuleErrorOptions = {},
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw sanitizeNativeModuleError(error, options)
  }
}
