import { createRequire } from 'node:module'

export type DarwinGuiAvailability = 'available' | 'unavailable' | 'unsupported'
export interface DarwinGuiSessionFacts {
  uid: number
  onConsole: boolean
  loginDone: boolean
}

/** Unknown/malformed evidence is distinct from a positively absent Quartz GUI session. */
export function classifyDarwinGuiSession(session: unknown, uid: number): DarwinGuiAvailability {
  if (session === null) return 'unavailable'
  if (!session || typeof session !== 'object') return 'unsupported'
  const facts = session as Partial<DarwinGuiSessionFacts>
  if (
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    !Number.isSafeInteger(facts.uid) ||
    (facts.uid ?? -1) < 0 ||
    (facts.uid ?? Infinity) > 0xffffffff ||
    typeof facts.onConsole !== 'boolean' ||
    typeof facts.loginDone !== 'boolean'
  )
    return 'unsupported'
  return facts.uid === uid && facts.onConsole && facts.loginDone ? 'available' : 'unavailable'
}

let readSession: (() => DarwinGuiSessionFacts | null) | undefined

/**
 * Daemon-only public CoreGraphics/CoreFoundation APIs, not environment/TTY guesses or private SPI.
 * CGSession.h (available since 10.3) defines these exact keys and says NULL means the caller is
 * outside a Quartz GUI session or WindowServer is disabled. No username, window or screen is read.
 */
function nativeSessionReader(): () => DarwinGuiSessionFacts | null {
  const require = createRequire(import.meta.url)
  const ffi = require('koffi') as typeof import('koffi')
  if (ffi.version !== '3.3.3') throw new Error('unsupported native binding')
  const cg = ffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = ffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const copySession = cg.func('void *CGSessionCopyCurrentDictionary(void)')
  const release = cf.func('void CFRelease(void *)')
  const typeId = cf.func('ulong CFGetTypeID(void *)')
  const dictionaryType = cf.func('ulong CFDictionaryGetTypeID(void)')
  const booleanType = cf.func('ulong CFBooleanGetTypeID(void)')
  const numberType = cf.func('ulong CFNumberGetTypeID(void)')
  const string = cf.func('void *CFStringCreateWithCString(void *, const char *, uint32_t)')
  const value = cf.func('void *CFDictionaryGetValue(void *, void *)')
  const boolean = cf.func('uint8_t CFBooleanGetValue(void *)')
  const number = cf.func('uint8_t CFNumberGetValue(void *, long, void *)')
  return () => {
    const session = copySession()
    if (session === null) return null
    const keys: unknown[] = []
    try {
      if (typeId(session) !== dictionaryType()) throw new Error('invalid GUI dictionary')
      const get = (name: string) => {
        // kCFStringEncodingUTF8; all names are fixed public CGSession.h constants below.
        const key = string(null, name, 0x08000100)
        if (key === null) throw new Error('GUI key allocation failed')
        keys.push(key)
        const result = value(session, key)
        if (result === null) throw new Error('missing GUI fact')
        return result
      }
      const bool = (name: string): boolean => {
        const ref = get(name)
        if (typeId(ref) !== booleanType()) throw new Error('invalid GUI boolean')
        const result = boolean(ref)
        if (result !== 0 && result !== 1) throw new Error('invalid GUI boolean value')
        return result === 1
      }
      const user = get('kCGSSessionUserIDKey')
      if (typeId(user) !== numberType()) throw new Error('invalid GUI user')
      const buffer = Buffer.alloc(8)
      // kCFNumberSInt64Type = 4: read the documented uint32 uid without signed truncation.
      if (number(user, 4, buffer) !== 1) throw new Error('unreadable GUI user')
      const uid = buffer.readBigInt64LE()
      if (uid < 0n || uid > 0xffffffffn) throw new Error('invalid GUI user value')
      return {
        uid: Number(uid),
        onConsole: bool('kCGSSessionOnConsoleKey'),
        loginDone: bool('kCGSessionLoginDoneKey'),
      }
    } finally {
      for (const key of keys) release(key)
      release(session)
    }
  }
}

export function probeDarwinGuiSession(): DarwinGuiAvailability {
  if (process.platform !== 'darwin') return 'unsupported'
  try {
    readSession ??= nativeSessionReader()
    return classifyDarwinGuiSession(readSession(), process.geteuid?.() ?? -1)
  } catch {
    // A missing binding, denied API or malformed dictionary is not proof of no desktop.
    return 'unsupported'
  }
}
