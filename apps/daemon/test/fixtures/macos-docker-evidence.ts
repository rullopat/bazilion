// Read-only actual-VM evidence, never process-signalling authority or a product admission path.
import { realpathSync } from 'node:fs'
import { ownedDarwinBrowserProcesses } from './browser-managed-darwin.ts'

if (
  process.platform !== 'darwin' ||
  process.arch !== 'arm64' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
)
  throw new Error('local ARM VM evidence requires actual disposable hosted Apple Silicon macOS')
const home = process.env.COLIMA_HOME
const executable = process.argv[2]
if (!home || !executable) throw new Error('owned VM scope and QEMU executable are required')
const expected = realpathSync(executable)
// The reader binds argv to exact native birth/uid observations around the copy. Profile scope
// here is the private Colima home referenced by the VM disk args, not a broad process-name match.
const processes = ownedDarwinBrowserProcesses(home).filter((p) => p.exe === expected)
if (processes.length !== 1)
  throw new Error('expected one exact-executable VM in the owned Colima scope')
const argv = processes[0]?.argv ?? []
const value = (name: string) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const machine = value('-machine')
const cpu = value('-cpu')
const smp = value('-smp')
if (
  !machine ||
  !/^virt,accel=(tcg|hvf)(,|$)/.test(machine) ||
  !cpu ||
  !smp ||
  !/^(?:cpus=)?[1-9][0-9]*(?:,|$)/.test(smp)
)
  throw new Error('actual native ARM VM accelerator/CPU evidence is unavailable')
console.log(
  JSON.stringify({
    host: { platform: process.platform, arch: process.arch, node: process.version },
    vm: { architecture: 'aarch64', machine, cpu, smp },
    note: 'Local full-system ARM Docker VM; TCG is real CPU emulation, not synthetic Docker responses. No Intel/Rosetta qualification.',
  }),
)
