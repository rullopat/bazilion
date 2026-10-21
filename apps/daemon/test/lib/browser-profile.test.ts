// T03 — managed browser profile ownership and restart safety (BAZ-069 D1).
//
// These tests are filesystem-only: no browser is launched. They cover the
// refusal guarantees that keep a crashed daemon from attaching to, killing or
// deleting a profile it cannot prove it owns.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { type Paths, resolvePaths } from '../../src/core/paths.ts'
import {
  assessBrowserProfile,
  BROWSER_PROFILE_FORMAT_VERSION,
  type BrowserOwnerMarker,
  BrowserProfileError,
  browserUserDataDir,
  claimBrowserProfile,
  clearOwnerMarker,
  probeProcessPresence,
  readOwnerMarker,
  readProfileIdentity,
  removeBrowserProfile,
  writeOwnerMarker,
} from '../../src/lib/browser/profile.ts'

const homes: string[] = []
function makePaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-bprofile-'))
  homes.push(home)
  return resolvePaths(home)
}
afterEach(() => {
  while (homes.length) rmSync(homes.pop() as string, { recursive: true, force: true })
})

const ID = { agentId: 'agent-1', teamId: 'team-1' }
const OTHER = { agentId: 'agent-1', teamId: 'team-2' }

function marker(overrides: Partial<BrowserOwnerMarker> = {}): BrowserOwnerMarker {
  return {
    formatVersion: BROWSER_PROFILE_FORMAT_VERSION,
    agentId: ID.agentId,
    teamId: ID.teamId,
    launchNonce: 'nonce-1',
    daemonInstanceId: 'daemon-old',
    phase: 'running',
    startedAt: Date.now(),
    pid: 4321,
    processGroupId: 4321,
    ...overrides,
  }
}

const probe = (value: 'alive' | 'absent' | 'unknown') => () => value

test('a dead group leader does not authorize reuse while descendants remain or are unknown', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  writeOwnerMarker(paths.browserDir(ID.agentId), marker())
  for (const state of ['alive', 'unknown'] as const) {
    expect(
      assessBrowserProfile(paths, ID, {
        daemonInstanceId: 'new-daemon',
        probeProcess: probe('absent'),
        probeProcessGroup: probe(state),
      }).state,
    ).toBe('recovery_required')
  }
  expect(
    assessBrowserProfile(paths, ID, {
      daemonInstanceId: 'new-daemon',
      probeProcess: probe('absent'),
      probeProcessGroup: probe('absent'),
    }),
  ).toMatchObject({ state: 'ready', staleOwner: true })
})

test('claim creates owner-only slot and identity', () => {
  const paths = makePaths()
  const result = claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  expect(result.state).toBe('ready')
  expect(result.present).toBe(true)
  expect(statSync(paths.browsersDir).mode & 0o777).toBe(0o700)
  expect(statSync(paths.browserDir(ID.agentId)).mode & 0o777).toBe(0o700)

  const raw = JSON.parse(
    readFileSync(join(paths.browserDir(ID.agentId), 'profile.json'), 'utf8'),
  ) as Record<string, unknown>
  expect(raw).toMatchObject({ formatVersion: 1, agentId: 'agent-1', teamId: 'team-1' })
  expect(readProfileIdentity(paths.browserDir(ID.agentId))).toMatchObject(ID)
})

test('claim is idempotent for the same identity and leaves no temp files', () => {
  const paths = makePaths()
  for (let i = 0; i < 25; i++) claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  expect(readProfileIdentity(paths.browserDir(ID.agentId))).toMatchObject(ID)
  const leftovers = readdirSync(paths.browserDir(ID.agentId)).filter((f) => f.includes('.claim-'))
  expect(leftovers).toEqual([])
})

test('claim refuses a conflicting identity', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  expect(() => claimBrowserProfile(paths, OTHER, { daemonInstanceId: 'd1' })).toThrow(
    BrowserProfileError,
  )
})

test('slot symlink substitution is refused for claim, assess and remove', () => {
  const paths = makePaths()
  mkdirSync(paths.browsersDir, { recursive: true, mode: 0o700 })
  const external = mkdtempSync(join(tmpdir(), 'bazilion-external-'))
  homes.push(external)
  writeFileSync(join(external, 'keep.txt'), 'keep')
  symlinkSync(external, paths.browserDir(ID.agentId), 'dir')

  const assessed = assessBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  expect(assessed.state).toBe('recovery_required')
  expect(() => claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })).toThrow(/symlink/)
  expect(() => removeBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })).toThrow(
    /unknown|symlink/,
  )
  expect(existsSync(join(external, 'keep.txt'))).toBe(true)
})

test('browsers-root ancestor substitution is refused', () => {
  const paths = makePaths()
  const external = mkdtempSync(join(tmpdir(), 'bazilion-root-'))
  homes.push(external)
  symlinkSync(external, paths.browsersDir, 'dir')
  expect(() => claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })).toThrow(/symlink/)
})

test('Team mismatch blocks admission even without a marker', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  const assessed = assessBrowserProfile(paths, OTHER, { daemonInstanceId: 'd1' })
  expect(assessed.state).toBe('recovery_required')
  expect(assessed.detail).toMatch(/Team mismatch/)
})

test('malformed profile.json yields recovery_required', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  writeFileSync(join(paths.browserDir(ID.agentId), 'profile.json'), '{not json')
  expect(assessBrowserProfile(paths, ID, { daemonInstanceId: 'd1' }).state).toBe(
    'recovery_required',
  )
})

test('malformed or partial owner marker yields recovery_required', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  const ownerPath = join(paths.browserDir(ID.agentId), 'owner.json')
  writeFileSync(ownerPath, '{oops')
  expect(assessBrowserProfile(paths, ID, { daemonInstanceId: 'd1' }).state).toBe(
    'recovery_required',
  )
  // A well-formed JSON object missing required fields is still refused.
  writeFileSync(ownerPath, JSON.stringify({ formatVersion: 1, agentId: 'agent-1' }))
  expect(assessBrowserProfile(paths, ID, { daemonInstanceId: 'd1' }).state).toBe(
    'recovery_required',
  )
})

test('a live orphan blocks admission and removal', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  writeOwnerMarker(paths.browserDir(ID.agentId), marker())
  const assessed = assessBrowserProfile(paths, ID, {
    daemonInstanceId: 'd-new',
    probeProcess: probe('alive'),
    probeProcessGroup: probe('alive'),
  })
  expect(assessed.state).toBe('recovery_required')
  expect(assessed.detail).toMatch(/still present/)
  expect(() =>
    removeBrowserProfile(paths, ID, {
      daemonInstanceId: 'd-new',
      probeProcess: probe('alive'),
      probeProcessGroup: probe('alive'),
    }),
  ).toThrow(/unknown|still present/)
})

test('a dead owner is stale evidence and reclaimable', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  const dir = paths.browserDir(ID.agentId)
  writeOwnerMarker(dir, marker())
  const assessed = assessBrowserProfile(paths, ID, {
    daemonInstanceId: 'd-new',
    probeProcess: probe('absent'),
    probeProcessGroup: probe('absent'),
  })
  expect(assessed.state).toBe('ready')
  expect(assessed.staleOwner).toBe(true)
  expect(assessed.owner?.launchNonce).toBe('nonce-1')
})

test('unknown process presence (PID reuse / EPERM) refuses', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  writeOwnerMarker(paths.browserDir(ID.agentId), marker())
  const assessed = assessBrowserProfile(paths, ID, {
    daemonInstanceId: 'd-new',
    probeProcess: probe('unknown'),
    probeProcessGroup: probe('unknown'),
  })
  expect(assessed.state).toBe('recovery_required')
  expect(assessed.detail).toMatch(/absent/)
})

test('a pre-spawn marker with no owned process requires manual recovery', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  const m = marker({ phase: 'starting' })
  delete m.pid
  delete m.processGroupId
  writeOwnerMarker(paths.browserDir(ID.agentId), m)
  const assessed = assessBrowserProfile(paths, ID, { daemonInstanceId: 'd-new' })
  expect(assessed.state).toBe('recovery_required')
})

test('a marker owned by the current instance is a leak, not a claim', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  writeOwnerMarker(paths.browserDir(ID.agentId), marker({ daemonInstanceId: 'd1' }))
  const assessed = assessBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  expect(assessed.state).toBe('recovery_required')
})

test('contents without an identity are an interrupted claim/deletion', () => {
  const paths = makePaths()
  const dir = paths.browserDir(ID.agentId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, 'stray.bin'), 'x')
  expect(assessBrowserProfile(paths, ID, { daemonInstanceId: 'd1' }).state).toBe(
    'recovery_required',
  )
})

test('an empty slot without an identity is claimable', () => {
  const paths = makePaths()
  mkdirSync(paths.browserDir(ID.agentId), { recursive: true, mode: 0o700 })
  expect(assessBrowserProfile(paths, ID, { daemonInstanceId: 'd1' }).state).toBe('ready')
  expect(claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' }).state).toBe('ready')
})

test('remove unlinks internal symlinks without touching their targets', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  const dir = paths.browserDir(ID.agentId)
  const external = mkdtempSync(join(tmpdir(), 'bazilion-target-'))
  homes.push(external)
  writeFileSync(join(external, 'secret.txt'), 'secret')
  mkdirSync(browserUserDataDir(dir), { recursive: true })
  symlinkSync(join(external, 'secret.txt'), join(browserUserDataDir(dir), 'link'), 'file')

  removeBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  expect(existsSync(dir)).toBe(false)
  expect(existsSync(join(external, 'secret.txt'))).toBe(true)
})

test('remove clears a proven-stale marker then deletes the slot', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  writeOwnerMarker(paths.browserDir(ID.agentId), marker())
  removeBrowserProfile(paths, ID, {
    daemonInstanceId: 'd-new',
    probeProcess: probe('absent'),
    probeProcessGroup: probe('absent'),
  })
  expect(existsSync(paths.browserDir(ID.agentId))).toBe(false)
})

test('owner marker round-trips and clears', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  const dir = paths.browserDir(ID.agentId)
  writeOwnerMarker(dir, marker())
  expect(readOwnerMarker(dir)).toMatchObject({ launchNonce: 'nonce-1', pid: 4321 })
  clearOwnerMarker(dir)
  expect(readOwnerMarker(dir)).toBeNull()
})

test('oversized metadata writes are refused', () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'd1' })
  const dir = paths.browserDir(ID.agentId)
  expect(() => writeOwnerMarker(dir, marker({ launchNonce: 'x'.repeat(5000) }))).toThrow(
    /exceeds bound/,
  )
})

test('invalid agent ids cannot escape the slot', () => {
  const paths = makePaths()
  for (const agentId of ['../evil', 'a/b', '', '..', '/abs']) {
    expect(() => claimBrowserProfile(paths, { agentId, teamId: 't' })).toThrow(BrowserProfileError)
  }
})

test('probeProcessPresence reports the live current process', () => {
  expect(probeProcessPresence(process.pid)).toBe('alive')
  expect(probeProcessPresence(0)).toBe('unknown')
})
