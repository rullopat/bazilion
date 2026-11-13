import type { HealthReport } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { runtimeDoctorLines } from '../src/commands/doctor.ts'

const hostShell = {
  ok: true,
  sandboxMode: 'off',
  approvalMode: 'dangerous',
  sandboxImage: 'debian:bookworm-slim',
  hostCodingTools: true,
  network: 'host',
  docker: null,
} satisfies HealthReport['shellSecurity']

test('doctor states one runtime rule for every turn origin', () => {
  const output = runtimeDoctorLines({ shellSecurity: hostShell }).join('\n')

  expect(output).toContain('agent runtime (every turn: chat, Telegram, schedules, inbox)')
  expect(output).toContain('sandbox: off — bash and file tools run on the host, unisolated')
  expect(output).toContain('set BAZILION_BASH_SANDBOX=docker to sandbox bash')
  expect(output).toContain(
    'dangerous-command approval: on — chat can allow once; unattended turns auto-deny',
  )
  expect(output).not.toContain('Docker ready')
})

test('doctor shows Docker readiness and remediation only when the sandbox is docker', () => {
  const unavailable = runtimeDoctorLines({
    shellSecurity: {
      ...hostShell,
      sandboxMode: 'docker',
      approvalMode: 'off',
      hostCodingTools: false,
      network: 'none',
      docker: {
        ready: false,
        image: 'debian:bookworm-slim',
        reason: 'Docker executable is unavailable',
        remediation: 'Install Docker locally and ensure the Bazilion daemon can execute it.',
      },
    },
  }).join('\n')
  expect(unavailable).toContain('sandbox: docker (debian:bookworm-slim)')
  expect(unavailable).toContain(
    '✗ Docker ready (debian:bookworm-slim) — Docker executable is unavailable',
  )
  expect(unavailable).toContain(
    'remediation: Install Docker locally and ensure the Bazilion daemon can execute it.',
  )
  expect(unavailable).toContain('dangerous-command approval: off')

  const ready = runtimeDoctorLines({
    shellSecurity: {
      ...hostShell,
      sandboxMode: 'docker',
      hostCodingTools: false,
      network: 'none',
      docker: { ready: true, image: 'debian:bookworm-slim', reason: null, remediation: null },
    },
  }).join('\n')
  expect(ready).toContain('✓ Docker ready (debian:bookworm-slim)')
  expect(ready).not.toContain('remediation:')
})

test('doctor reports an invalid shell-security configuration', () => {
  const output = runtimeDoctorLines({
    shellSecurity: { ok: false, error: 'Sandbox mode must be "off" or "docker".' },
  }).join('\n')
  expect(output).toContain(
    '✗ valid shell-security configuration — Sandbox mode must be "off" or "docker".',
  )
})
