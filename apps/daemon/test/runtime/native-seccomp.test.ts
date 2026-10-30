import { expect, test } from 'vitest'
import {
  compileLinuxSeccompFilter,
  type LinuxNativeArchitecture,
} from '../../src/runtime/shell/native/seccomp.ts'

const ALLOW = 0x7fff0000
const KILL = 0x80000000
const DENY = 0x50001
const ENOSYS = 0x50026
const ABI = {
  x64: { audit: 0xc000003e, socket: 41, socketpair: 53, clone: 56, ioctl: 16, prctl: 157 },
  arm64: { audit: 0xc00000b7, socket: 198, socketpair: 199, clone: 220, ioctl: 29, prctl: 167 },
} as const

// Independent tiny classic-BPF interpreter, not a kernel/enforcement qualification substitute.
function evaluate(program: Buffer, nr: number, audit: number, args: bigint[] = []): number {
  const data = Buffer.alloc(64)
  data.writeUInt32LE(nr >>> 0, 0)
  data.writeUInt32LE(audit >>> 0, 4)
  args.forEach((arg, index) => {
    data.writeBigUInt64LE(BigInt.asUintN(64, arg), 16 + index * 8)
  })
  let accumulator = 0
  for (let position = 0, steps = 0; steps < 4096; steps++) {
    const offset = position * 8
    if (offset < 0 || offset + 8 > program.length) throw new Error('invalid BPF branch')
    const code = program.readUInt16LE(offset)
    const yes = program.readUInt8(offset + 2)
    const no = program.readUInt8(offset + 3)
    const value = program.readUInt32LE(offset + 4)
    if (code === 0x20) {
      accumulator = data.readUInt32LE(value)
      position++
    } else if (code === 0x54) {
      accumulator = (accumulator & value) >>> 0
      position++
    } else if (code === 0x15) position += 1 + (accumulator === value ? yes : no)
    else if (code === 0x45) position += 1 + ((accumulator & value) !== 0 ? yes : no)
    else if (code === 0x06) return value
    else throw new Error(`unrecognized BPF opcode ${code}`)
  }
  throw new Error('BPF did not terminate')
}

for (const architecture of ['x64', 'arm64'] as const) {
  const abi = ABI[architecture]
  const program = compileLinuxSeccompFilter(architecture)
  const decision = (nr: number, args: bigint[] = []) => evaluate(program, nr, abi.audit, args)

  test(`${architecture}: deterministic bounded filter with valid forward branch targets`, () => {
    expect(compileLinuxSeccompFilter(architecture)).toEqual(program)
    expect(program.length % 8).toBe(0)
    expect(program.length / 8).toBeLessThanOrEqual(4096)
    for (let offset = 0; offset < program.length; offset += 8) {
      const code = program.readUInt16LE(offset)
      if (code === 0x15 || code === 0x45) {
        for (const field of [2, 3]) {
          const target = offset + 8 + program.readUInt8(offset + field) * 8
          expect(target).toBeGreaterThan(offset)
          expect(target).toBeLessThan(program.length)
        }
      }
    }
  })

  test(`${architecture}: incompatible audit ABI is killed rather than misinterpreted`, () => {
    for (const other of [0x40000003, 0xc00000f3, 0, abi.audit ^ 1]) {
      expect(evaluate(program, 0, other)).toBe(KILL)
    }
  })

  test(`${architecture}: ordinary file/process/thread calls and setsid remain possible`, () => {
    const calls =
      architecture === 'x64'
        ? [0, 1, 3, 9, 10, 11, 39, 59, 60, 112, 202, 257, 293, 318, 334, 437]
        : [63, 64, 57, 222, 226, 215, 172, 221, 93, 157, 98, 56, 59, 278, 293, 437]
    for (const nr of calls) expect(decision(nr)).toBe(ALLOW)
  })

  test(`${architecture}: all non-Unix socket families, including localhost IP, are denied`, () => {
    for (const nr of [abi.socket, abi.socketpair]) {
      for (const family of [0, 2, 10, 16, 17, 40, 255, -1]) {
        expect(decision(nr, [BigInt(family)])).toBe(DENY)
      }
      expect(decision(nr, [1n, 1n, 0n])).toBe(ALLOW)
      expect(decision(nr, [0x100000001n, 1n, 0n])).toBe(DENY)
    }
  })

  test(`${architecture}: normal clone flags pass but every namespace flag is denied`, () => {
    expect(decision(abi.clone, [17n])).toBe(ALLOW)
    expect(decision(abi.clone, [0x3d0f00n])).toBe(ALLOW)
    for (const flag of [
      0x80, 0x20000, 0x2000000, 0x4000000, 0x8000000, 0x10000000, 0x20000000, 0x40000000,
    ]) {
      expect(decision(abi.clone, [BigInt(flag | 17)])).toBe(DENY)
    }
    expect(decision(abi.clone, [0x100000011n])).toBe(DENY)
    expect(decision(435, [0n, 0n])).toBe(ENOSYS)
  })

  test(`${architecture}: terminal injection is denied even with a forged high ioctl word`, () => {
    for (const command of [0x5412n, 0x541cn, 0x541dn, 0xb701n, 0xb7ffn, 0xff01n, 0xffffn]) {
      expect(decision(abi.ioctl, [0n, command])).toBe(DENY)
      expect(decision(abi.ioctl, [0n, command | 0xffffffff00000000n])).toBe(DENY)
    }
    expect(decision(abi.ioctl, [0n, 0x5401n])).toBe(ALLOW)
  })

  test(`${architecture}: prctl preserves self metadata, not new privileges/debug/unknown options`, () => {
    for (const option of [1, 2, 3, 4, 15, 16, 21, 38, 39]) {
      expect(decision(abi.prctl, [BigInt(option)])).toBe(ALLOW)
    }
    for (const option of [8, 22, 28, 35, 47, 57, 59, 0x59616d61, 0x7fffffff]) {
      expect(decision(abi.prctl, [BigInt(option)])).toBe(DENY)
    }
    expect(decision(abi.prctl, [0x10000000fn])).toBe(DENY)
  })

  test(`${architecture}: namespace, mount, debug, io_uring, privileged and future calls default deny`, () => {
    const denied =
      architecture === 'x64'
        ? [
            101, 155, 165, 166, 169, 175, 176, 250, 272, 298, 300, 301, 303, 304, 308, 310, 311,
            321, 323,
          ]
        : [40, 39, 41, 97, 104, 105, 106, 117, 219, 241, 262, 264, 265, 268, 270, 271, 280, 282]
    for (const nr of [
      ...denied,
      425,
      426,
      427,
      428,
      429,
      430,
      431,
      432,
      438,
      440,
      442,
      460,
      467,
      470,
      472,
      9999,
    ]) {
      expect(decision(nr)).toBe(DENY)
    }
  })
}

test('x32 syscall bit cannot bypass the x86-64 rules', () => {
  const program = compileLinuxSeccompFilter('x64')
  for (const nr of [0, 41, 56, 101, 272, 308, 425]) {
    expect(evaluate(program, nr | 0x40000000, ABI.x64.audit)).toBe(KILL)
  }
})

test('unsupported architecture fails before producing a filter; buffers are not shared state', () => {
  expect(() => compileLinuxSeccompFilter('ia32' as LinuxNativeArchitecture)).toThrow('unavailable')
  const original = compileLinuxSeccompFilter('x64')
  const mutable = compileLinuxSeccompFilter('x64')
  mutable.fill(0)
  expect(compileLinuxSeccompFilter('x64')).toEqual(original)
})
